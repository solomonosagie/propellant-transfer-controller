/*
 * ============================================================================
 *  Simulated Spacecraft Propellant Transfer Controller
 *  Author : Solomon Osagie
 *  Target : SparkFun Pro Micro (ATmega32U4, 5 V / 16 MHz)
 *  Link   : USB CDC serial, 115200 baud, newline-terminated JSON out,
 *           plain-text commands in.
 * ============================================================================
 *
 *  Hardware (fixed):
 *    A0  - Potentiometer wiper -> simulated tank pressure (0-1023 -> 0-300 kPa)
 *    D4  - Push button to GND (internal pull-up) -> simulated tank temperature
 *    D8  - Continuous rotation servo signal (the "fuel valve")
 *    D9  - Red LED    (fault)
 *    D10 - Yellow LED (valve moving = blinking, pressure/temperature warning = solid)
 *    D16 - Green LED  (transfer active)
 *
 *  TEMPERATURE BUTTON
 *  ------------------
 *  Tank temperature starts at TEMP_START_C. Each press moves it by
 *  TEMP_STEP_C: upwards until TEMP_MAX_C, then downwards until TEMP_MIN_C,
 *  then upwards again (ping-pong). Leaving the safe propellant band
 *  (TEMP_SAFE_MIN_C..TEMP_SAFE_MAX_C) is a thermal fault: OVERTEMP above it,
 *  UNDERTEMP below it. The valve is safed exactly like an overpressure, and
 *  RESET is refused until the temperature is back inside the band.
 *  Hydrazine freezes at ~2 C, hence the 10 C lower safe limit.
 *
 *  FLOW PROFILE
 *  ------------
 *  AUTO (default): soft start, then cruise, then taper. Each transfer starts at
 *  FLOW_AUTO_START_PCTS and ramps up to FLOW_AUTO_CRUISE_PCTS (slew-limited).
 *  Once Tank A drops below FLOW_TAPER_START_PCT the rate tapers down in
 *  proportion to the fuel left, never below FLOW_AUTO_END_PCTS.
 *  MANUAL: only after "OVERRIDE ON". SET_FLOW is then accepted and used as-is.
 *  "OVERRIDE OFF" (or any fault) returns to AUTO.
 *
 *  Note: on the 32U4 the Servo library uses Timer1, which disables
 *  analogWrite() on D9/D10. The LEDs only use digitalWrite(), so that's fine.
 *
 *  STATE MACHINE
 *  -------------
 *
 *     +------+  START   +---------+ valve fully open +----------+
 *     | IDLE | -------> | OPENING | ---------------> | TRANSFER |
 *     +------+          +---------+                  +----------+
 *        ^                   |  STOP / fault             |  STOP / tank A empty /
 *        |                   v                           v  fault (overpressure, link loss,
 *        |              +-----------------------------------+       overtemp, undertemp)
 *        +------------- |              CLOSING              |
 *        (normal close) +-----------------------------------+
 *                                         | (closing because of a fault)
 *     +-------+  RESET (pressure < 150    v
 *     | IDLE  | <---------------------- FAULT  (red LED blinks 2 Hz, START refused)
 *     +-------+   and temp in safe band)
 *
 *  - Faults are never latched with the valve open: if the valve is open or
 *    moving, we first drive it closed (state CLOSING, red LED solid), and
 *    only enter FAULT once it is confirmed closed (by software tracking).
 *  - An overpressure in IDLE (valve already closed) goes straight to FAULT.
 *  - The valve is a continuous servo, so its position is tracked in software
 *    as "milliseconds of travel" (0 = closed, VALVE_TRAVEL_MS = open). This
 *    lets an interrupted OPENING be reversed for exactly the time it ran.
 *    The valve is assumed CLOSED at power-up.
 * ============================================================================
 */

#include <Arduino.h>
#include <Servo.h>
#include <avr/wdt.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

// ============================================================================
//  CONFIGURATION CONSTANTS
// ============================================================================

#define FW_NAME    "PTC-SIM"
#define FW_VERSION "1.3.0"

// ---- Pins (do not change) --------------------------------------------------
const uint8_t PIN_PRESSURE   = A0;
const uint8_t PIN_TEMP_BTN   = 4;
const uint8_t PIN_SERVO      = 8;
const uint8_t PIN_LED_RED    = 9;
const uint8_t PIN_LED_YELLOW = 10;
const uint8_t PIN_LED_GREEN  = 16;

// ---- Valve (continuous rotation servo) --------------------------------------
// Servo.write() values: 90 = stop, further from 90 = faster. If your servo
// creeps at "stop", trim SERVO_STOP (e.g. 88..92) or adjust its trim pot.
const uint8_t  SERVO_STOP        = 90;
const uint8_t  SERVO_OPEN_SPEED  = 120;   // > 90: spin one way
const uint8_t  SERVO_CLOSE_SPEED = 60;    // < 90: spin the other way
const uint16_t VALVE_TRAVEL_MS   = 600;   // time to go fully closed <-> open

// ---- Pressure ---------------------------------------------------------------
const float    PRESSURE_FULL_SCALE_KPA = 300.0f;  // ADC 1023
const float    PRESSURE_WARN_KPA       = 220.0f;  // yellow LED on
const float    PRESSURE_WARN_CLEAR_KPA = 215.0f;  // hysteresis for warning
const float    PRESSURE_FAULT_KPA      = 250.0f;  // fault threshold
const float    PRESSURE_RESET_MAX_KPA  = 150.0f;  // RESET only below this
const uint16_t PRESSURE_SAMPLE_MS      = 20;
const float    PRESSURE_FILTER_ALPHA   = 0.3f;    // EMA smoothing (0..1)

// ---- Tanks / flow -----------------------------------------------------------
const float    TANK_FULL_PCT     = 100.0f;
const float    FLOW_DEFAULT_PCTS = 2.0f;   // % of tank per second
const float    FLOW_MIN_PCTS     = 0.1f;
const float    FLOW_MAX_PCTS     = 20.0f;
const uint16_t TANK_UPDATE_MS    = 50;     // fuel integration step

// ---- Automatic flow profile -------------------------------------------------
const float FLOW_AUTO_START_PCTS  = 0.5f;  // rate when the valve first opens
const float FLOW_AUTO_CRUISE_PCTS = 4.0f;  // steady-state rate
const float FLOW_AUTO_END_PCTS    = 0.5f;  // floor during the end taper
const float FLOW_TAPER_START_PCT  = 20.0f; // Tank A level where tapering begins
const float FLOW_SLEW_UP_PCTS2    = 0.8f;  // max ramp-up   (%/s per second)
const float FLOW_SLEW_DOWN_PCTS2  = 2.0f;  // max ramp-down (%/s per second)

// ---- Temperature (D4 button) ------------------------------------------------
const int16_t  TEMP_START_C      = 20;   // nominal propellant storage temperature
const int16_t  TEMP_STEP_C       = 10;   // change per button press
const int16_t  TEMP_MAX_C        = 60;   // turn-around point, then presses cool
const int16_t  TEMP_MIN_C        = -20;  // turn-around point, then presses heat
const int16_t  TEMP_SAFE_MIN_C   = 10;   // below: UNDERTEMP fault (freezing risk)
const int16_t  TEMP_SAFE_MAX_C   = 40;   // above: OVERTEMP fault (overheating)
const uint8_t  BUTTON_DEBOUNCE_MS = 30;

// ---- Timing -----------------------------------------------------------------
const uint16_t TLM_PERIOD_MS       = 200;
const uint32_t LINK_TIMEOUT_MS     = 10000UL;  // software link watchdog
const uint16_t FAULT_BLINK_HALF_MS = 250;      // 2 Hz red blink
const uint16_t MOVE_BLINK_HALF_MS  = 100;      // yellow blink while valve moves
const uint16_t USB_WAIT_MS         = 4000;     // max wait for host at boot

// ---- Command input ----------------------------------------------------------
const uint8_t CMD_BUF_SIZE    = 48;  // longest accepted line (incl. '\0')
const uint8_t MAX_RX_PER_LOOP = 64;  // bound serial work per loop pass

// Test hook: "DEBUG_HANG" spins forever so the AVR watchdog reset can be
// verified. Set to 0 to remove the command entirely.
#define ENABLE_DEBUG_HANG 1

// ============================================================================
//  TYPES & GLOBAL STATE
// ============================================================================

enum State : uint8_t { ST_IDLE, ST_OPENING, ST_TRANSFER, ST_CLOSING, ST_FAULT };

// Why the valve is being closed; decides where CLOSING ends up.
enum CloseReason : uint8_t { CLOSE_NONE, CLOSE_STOP, CLOSE_COMPLETE, CLOSE_FAULT };

Servo valveServo;

State       state       = ST_IDLE;
CloseReason closeReason = CLOSE_NONE;
const char* faultReason = nullptr;   // nullptr -> "fault":null

// Valve tracking (software position, see header)
int8_t   valveDir    = 0;   // +1 opening, -1 closing, 0 stopped
uint16_t valvePosMs  = 0;   // 0 = closed, VALVE_TRAVEL_MS = open
uint32_t valveLastMs = 0;

// Simulation
float pressureKpa  = 0.0f;
bool  pressureWarn = false;
float tankA        = TANK_FULL_PCT;
float tankB        = 0.0f;
float flowRate     = 0.0f;               // actual rate (0 unless transferring)
float flowSet      = FLOW_DEFAULT_PCTS;  // manual setpoint, used with override
bool  flowOverride = false;              // false = AUTO profile

// Temperature (button driven)
int16_t tempC       = TEMP_START_C;
int8_t  tempDir     = +1;     // +1 next press heats, -1 next press cools
int8_t  tempWarn    = 0;      // -1 too cold, 0 nominal, +1 too hot
bool    btnStable   = HIGH;   // debounced level (HIGH = released with pull-up)
bool    btnLastRaw  = HIGH;
uint32_t btnChangedMs = 0;

// Timers
uint32_t lastLinkMs     = 0;
uint32_t lastPressureMs = 0;
uint32_t lastTankMs     = 0;
uint32_t nextTlmMs      = 0;
uint32_t tlmSeq         = 0;

// Command line buffer (no String objects)
char    cmdBuf[CMD_BUF_SIZE];
uint8_t cmdLen      = 0;
bool    cmdOverflow = false;

// ============================================================================
//  OUTPUT HELPERS (JSON, one object per line, '\n' terminated)
// ============================================================================

const char* stateName(State s) {
  switch (s) {
    case ST_IDLE:     return "IDLE";
    case ST_OPENING:  return "OPENING";
    case ST_TRANSFER: return "TRANSFER";
    case ST_CLOSING:  return "CLOSING";
    case ST_FAULT:    return "FAULT";
  }
  return "UNKNOWN";
}

const char* valveName() {
  if (valveDir > 0) return "OPENING";
  if (valveDir < 0) return "CLOSING";
  if (valvePosMs == 0) return "CLOSED";
  if (valvePosMs >= VALVE_TRAVEL_MS) return "OPEN";
  return "PARTIAL";
}

void endLine() { Serial.write('\n'); }

// Prints a quoted JSON string, escaping anything unsafe (used for echoing
// untrusted command text back to the PC).
void printJsonString(const char* s) {
  Serial.write('"');
  for (; *s; ++s) {
    char c = *s;
    if (c == '"' || c == '\\') { Serial.write('\\'); Serial.write(c); }
    else if ((uint8_t)c < 0x20 || (uint8_t)c > 0x7E) Serial.write('?');
    else Serial.write(c);
  }
  Serial.write('"');
}

// {"type":"evt","t":<millis>,"level":"INFO|WARN|FAULT","msg":"..."}
void sendEvent(const char* level, const char* msg) {
  Serial.print(F("{\"type\":\"evt\",\"t\":"));
  Serial.print(millis());
  Serial.print(F(",\"level\":\""));
  Serial.print(level);
  Serial.print(F("\",\"msg\":\""));
  Serial.print(msg);
  Serial.print(F("\"}"));
  endLine();
}

// {"type":"ack","cmd":"START","ok":true,"reason":""}
void sendAck(const char* cmd, bool ok, const char* reason) {
  Serial.print(F("{\"type\":\"ack\",\"cmd\":"));
  printJsonString(cmd);
  Serial.print(F(",\"ok\":"));
  Serial.print(ok ? F("true") : F("false"));
  Serial.print(F(",\"reason\":\""));
  Serial.print(reason);
  Serial.print(F("\"}"));
  endLine();
}

void sendHello() {
  Serial.print(F("{\"type\":\"hello\",\"fw\":\"" FW_NAME "\",\"version\":\"" FW_VERSION "\""
                 ",\"board\":\"SparkFun Pro Micro ATmega32U4 5V/16MHz\",\"baud\":115200"
                 ",\"pins\":{\"pressure\":\"A0\",\"temp_button\":\"D4\",\"servo\":\"D8\",\"led_red\":\"D9\""
                 ",\"led_yellow\":\"D10\",\"led_green\":\"D16\"}"));
  Serial.print(F(",\"tlm_ms\":"));          Serial.print(TLM_PERIOD_MS);
  Serial.print(F(",\"warn_kpa\":"));        Serial.print(PRESSURE_WARN_KPA, 1);
  Serial.print(F(",\"fault_kpa\":"));       Serial.print(PRESSURE_FAULT_KPA, 1);
  Serial.print(F(",\"reset_kpa\":"));       Serial.print(PRESSURE_RESET_MAX_KPA, 1);
  Serial.print(F(",\"link_timeout_ms\":")); Serial.print(LINK_TIMEOUT_MS);
  Serial.print(F(",\"valve_travel_ms\":")); Serial.print(VALVE_TRAVEL_MS);
  Serial.print(F(",\"flow_auto_start\":")); Serial.print(FLOW_AUTO_START_PCTS, 2);
  Serial.print(F(",\"flow_auto_cruise\":"));Serial.print(FLOW_AUTO_CRUISE_PCTS, 2);
  Serial.print(F(",\"flow_taper_pct\":"));  Serial.print(FLOW_TAPER_START_PCT, 1);
  Serial.print(F(",\"temp_min\":"));        Serial.print(TEMP_MIN_C);
  Serial.print(F(",\"temp_max\":"));        Serial.print(TEMP_MAX_C);
  Serial.print(F(",\"temp_safe_min\":"));   Serial.print(TEMP_SAFE_MIN_C);
  Serial.print(F(",\"temp_safe_max\":"));   Serial.print(TEMP_SAFE_MAX_C);
  Serial.print(F("}"));
  endLine();
}

void sendTelemetry(uint32_t now) {
  Serial.print(F("{\"type\":\"tlm\",\"t\":"));
  Serial.print(now);
  Serial.print(F(",\"state\":\""));   Serial.print(stateName(state));
  Serial.print(F("\",\"pressure\":")); Serial.print(pressureKpa, 1);
  Serial.print(F(",\"tankA\":"));      Serial.print(tankA, 1);
  Serial.print(F(",\"tankB\":"));      Serial.print(tankB, 1);
  Serial.print(F(",\"valve\":\""));    Serial.print(valveName());
  Serial.print(F("\",\"flow\":"));     Serial.print(flowRate, 2);
  Serial.print(F(",\"flowSet\":"));    Serial.print(flowSet, 2);
  Serial.print(F(",\"flowMode\":\"")); Serial.print(flowOverride ? F("MANUAL") : F("AUTO"));
  Serial.print(F("\",\"temp\":"));       Serial.print(tempC);
  Serial.print(F(",\"tempDir\":\""));  Serial.print(tempDir > 0 ? F("UP") : F("DOWN"));
  Serial.print(F("\",\"fault\":"));
  if (faultReason) { Serial.write('"'); Serial.print(faultReason); Serial.write('"'); }
  else             { Serial.print(F("null")); }
  Serial.print(F(",\"uptime\":"));     Serial.print(now / 1000UL);
  Serial.print(F(",\"seq\":"));        Serial.print(tlmSeq++);
  Serial.print(F("}"));
  endLine();
}

// ============================================================================
//  VALVE (continuous servo + software position tracking)
// ============================================================================

// Advance the software position by the time spent moving since last call.
void valveIntegrate(uint32_t now) {
  uint32_t dt = now - valveLastMs;
  valveLastMs = now;
  if (valveDir == 0) return;

  int32_t pos = (int32_t)valvePosMs + (valveDir > 0 ? (int32_t)dt : -(int32_t)dt);
  if (pos > (int32_t)VALVE_TRAVEL_MS) pos = VALVE_TRAVEL_MS;
  if (pos < 0) pos = 0;
  valvePosMs = (uint16_t)pos;
}

// dir: +1 open, -1 close, 0 stop
void valveDrive(int8_t dir, uint32_t now) {
  valveIntegrate(now);  // account for motion up to this instant before changing
  valveDir = dir;
  valveServo.write(dir > 0 ? SERVO_OPEN_SPEED : (dir < 0 ? SERVO_CLOSE_SPEED : SERVO_STOP));
}

// Returns true on the pass where the valve reaches its end stop (and stops it).
bool valveUpdate(uint32_t now) {
  if (valveDir == 0) return false;
  valveIntegrate(now);
  bool arrived = (valveDir > 0) ? (valvePosMs >= VALVE_TRAVEL_MS) : (valvePosMs == 0);
  if (arrived) valveDrive(0, now);
  return arrived;
}

bool valveIsClosed() { return valveDir == 0 && valvePosMs == 0; }

// ============================================================================
//  STATE TRANSITIONS
// ============================================================================

void startTransfer(uint32_t now) {
  closeReason = CLOSE_NONE;
  valveDrive(+1, now);
  state = ST_OPENING;
  sendEvent("INFO", "VALVE_OPENING");
}

// Drive the valve closed; where we end up depends on `reason`.
void beginClose(CloseReason reason, uint32_t now) {
  closeReason = reason;
  valveDrive(-1, now);
  flowRate = 0.0f;
  state = ST_CLOSING;
  sendEvent("INFO", "VALVE_CLOSING");
}

// Called once the valve is confirmed closed at the end of CLOSING.
void finishClose() {
  sendEvent("INFO", "VALVE_CLOSED");
  switch (closeReason) {
    case CLOSE_FAULT:
      state = ST_FAULT;           // valve is now safe; latch the fault
      break;
    case CLOSE_COMPLETE:
      state = ST_IDLE;
      sendEvent("INFO", "TRANSFER_COMPLETE");
      break;
    case CLOSE_STOP:
    case CLOSE_NONE:
      state = ST_IDLE;
      sendEvent("INFO", "TRANSFER_STOPPED");
      break;
  }
  closeReason = CLOSE_NONE;
}

// Raise a fault. Safe to call repeatedly; only the first reason is kept.
void triggerFault(const char* reason, uint32_t now) {
  if (state == ST_FAULT || closeReason == CLOSE_FAULT) return;

  faultReason = reason;
  sendEvent("FAULT", reason);

  if (flowOverride) {            // a fault always hands flow back to AUTO
    flowOverride = false;
    sendEvent("INFO", "FLOW_AUTO");
  }

  if (valveIsClosed()) {
    closeReason = CLOSE_NONE;
    state = ST_FAULT;
  } else {
    beginClose(CLOSE_FAULT, now);  // safe the valve first, FAULT afterwards
  }
}

// ============================================================================
//  PRESSURE SENSING
// ============================================================================

float readPressureRaw() {
  return analogRead(PIN_PRESSURE) * (PRESSURE_FULL_SCALE_KPA / 1023.0f);
}

void samplePressure(uint32_t now) {
  if (now - lastPressureMs < PRESSURE_SAMPLE_MS) return;
  lastPressureMs = now;

  pressureKpa += PRESSURE_FILTER_ALPHA * (readPressureRaw() - pressureKpa);

  if (!pressureWarn && pressureKpa >= PRESSURE_WARN_KPA) {
    pressureWarn = true;
    sendEvent("WARN", "PRESSURE_HIGH");
  } else if (pressureWarn && pressureKpa < PRESSURE_WARN_CLEAR_KPA) {
    pressureWarn = false;
    sendEvent("INFO", "PRESSURE_NORMAL");
  }
}

// ============================================================================
//  TEMPERATURE BUTTON (D4)
// ============================================================================

void updateTempWarning() {
  int8_t w = (tempC < TEMP_SAFE_MIN_C) ? -1 : (tempC > TEMP_SAFE_MAX_C ? +1 : 0);
  if (w == tempWarn) return;
  tempWarn = w;
  if (w > 0)      sendEvent("WARN", "TEMP_HIGH");
  else if (w < 0) sendEvent("WARN", "TEMP_LOW");
  else            sendEvent("INFO", "TEMP_NORMAL");
}

void onTempButton() {
  tempC += tempDir * TEMP_STEP_C;
  if (tempC >= TEMP_MAX_C) {
    tempC = TEMP_MAX_C;
    tempDir = -1;
    sendEvent("INFO", "TEMP_MAX_REACHED");
  } else if (tempC <= TEMP_MIN_C) {
    tempC = TEMP_MIN_C;
    tempDir = +1;
    sendEvent("INFO", "TEMP_MIN_REACHED");
  }
  updateTempWarning();
}

// Non-blocking debounce; fires once per press (on the falling edge).
void readTempButton(uint32_t now) {
  bool raw = digitalRead(PIN_TEMP_BTN);
  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnChangedMs = now;
  }
  if (raw != btnStable && (now - btnChangedMs) >= BUTTON_DEBOUNCE_MS) {
    btnStable = raw;
    if (btnStable == LOW) onTempButton();
  }
}

// ============================================================================
//  FLOW PROFILE
// ============================================================================

// AUTO target: cruise, tapering in proportion to the fuel left near the end.
float autoFlowTarget() {
  if (tankA >= FLOW_TAPER_START_PCT) return FLOW_AUTO_CRUISE_PCTS;
  float t = FLOW_AUTO_CRUISE_PCTS * tankA / FLOW_TAPER_START_PCT;
  return t < FLOW_AUTO_END_PCTS ? FLOW_AUTO_END_PCTS : t;
}

void updateFlowRate(float dt) {
  if (flowOverride) {
    flowRate = flowSet;
    return;
  }
  float delta = autoFlowTarget() - flowRate;  // slew-limited -> smooth ramps
  float up = FLOW_SLEW_UP_PCTS2 * dt;
  float down = FLOW_SLEW_DOWN_PCTS2 * dt;
  if (delta > up) delta = up;
  if (delta < -down) delta = -down;
  flowRate += delta;
}

// ============================================================================
//  STATE MACHINE
// ============================================================================

void runStateMachine(uint32_t now, bool valveArrived) {
  switch (state) {
    case ST_IDLE:
      // Valve closed, waiting for START.
      break;

    case ST_OPENING:
      // Servo spinning open; transfer starts once travel time has elapsed.
      if (valveArrived) {
        state = ST_TRANSFER;
        lastTankMs = now;
        flowRate = flowOverride ? flowSet : FLOW_AUTO_START_PCTS;
        sendEvent("INFO", "VALVE_OPEN");
        sendEvent("INFO", "TRANSFER_STARTED");
      }
      break;

    case ST_TRANSFER: {
      // Move fuel A -> B in fixed steps at the AUTO-profile or manual rate.
      if (now - lastTankMs >= TANK_UPDATE_MS) {
        float dt = (float)(now - lastTankMs) / 1000.0f;
        lastTankMs = now;
        updateFlowRate(dt);
        float moved = flowRate * dt;
        if (moved > tankA) moved = tankA;
        tankA -= moved;
        tankB += moved;
      }

      if (tankA <= 0.0f) {
        tankA = 0.0f;
        tankB = TANK_FULL_PCT;
        sendEvent("INFO", "TANK_A_EMPTY");
        beginClose(CLOSE_COMPLETE, now);
      } else if (now - lastLinkMs > LINK_TIMEOUT_MS) {
        // Software link watchdog: ground station went quiet mid-transfer.
        triggerFault("LINK_LOSS", now);
      }
      break;
    }

    case ST_CLOSING:
      // Servo spinning closed; destination decided by closeReason.
      if (valveArrived) finishClose();
      break;

    case ST_FAULT:
      // Valve closed. Waiting for RESET with pressure < PRESSURE_RESET_MAX_KPA.
      break;
  }

  // Limits are checked in every state (no-op if already faulting).
  if (pressureKpa >= PRESSURE_FAULT_KPA) triggerFault("OVERPRESSURE", now);
  if (tempC > TEMP_SAFE_MAX_C)           triggerFault("OVERTEMP", now);
  else if (tempC < TEMP_SAFE_MIN_C)      triggerFault("UNDERTEMP", now);
}

// ============================================================================
//  LEDS
// ============================================================================

void updateLeds(uint32_t now) {
  bool red;
  if (state == ST_FAULT)              red = ((now / FAULT_BLINK_HALF_MS) & 1) == 0;  // 2 Hz
  else if (closeReason == CLOSE_FAULT) red = true;  // safing valve before FAULT
  else                                 red = false;

  bool moving = (valveDir != 0) && (((now / MOVE_BLINK_HALF_MS) & 1) == 0);
  bool yellow = pressureWarn || tempWarn != 0 || moving;  // warning = solid, moving = blink

  bool green = (state == ST_TRANSFER);

  digitalWrite(PIN_LED_RED,    red    ? HIGH : LOW);
  digitalWrite(PIN_LED_YELLOW, yellow ? HIGH : LOW);
  digitalWrite(PIN_LED_GREEN,  green  ? HIGH : LOW);
}

// ============================================================================
//  COMMAND HANDLING
// ============================================================================

bool isBlank(char c) { return c == ' ' || c == '\t'; }

void handleStart(bool hasArg, uint32_t now) {
  const char* cmd = "START";
  if (hasArg)                                { sendAck(cmd, false, "UNEXPECTED_ARGUMENT"); return; }
  if (state == ST_FAULT)                     { sendAck(cmd, false, "IN_FAULT"); return; }
  if (state != ST_IDLE)                      { sendAck(cmd, false, "NOT_IDLE"); return; }
  if (tankA <= 0.0f)                         { sendAck(cmd, false, "TANK_A_EMPTY"); return; }
  if (pressureWarn)                          { sendAck(cmd, false, "PRESSURE_HIGH"); return; }
  sendAck(cmd, true, "");
  startTransfer(now);
}

void handleStop(bool hasArg, uint32_t now) {
  const char* cmd = "STOP";
  if (hasArg)                { sendAck(cmd, false, "UNEXPECTED_ARGUMENT"); return; }
  if (state == ST_FAULT)     { sendAck(cmd, false, "IN_FAULT"); return; }
  if (state == ST_CLOSING)   { sendAck(cmd, false, "ALREADY_CLOSING"); return; }
  if (state == ST_IDLE)      { sendAck(cmd, false, "NOT_ACTIVE"); return; }
  sendAck(cmd, true, "");
  beginClose(CLOSE_STOP, now);   // OPENING or TRANSFER
}

void handleReset(bool hasArg) {
  const char* cmd = "RESET";
  if (hasArg)                    { sendAck(cmd, false, "UNEXPECTED_ARGUMENT"); return; }
  if (closeReason == CLOSE_FAULT) { sendAck(cmd, false, "SAFING_IN_PROGRESS"); return; }
  if (state != ST_FAULT)         { sendAck(cmd, false, "NO_FAULT"); return; }
  if (pressureKpa >= PRESSURE_RESET_MAX_KPA) { sendAck(cmd, false, "PRESSURE_TOO_HIGH"); return; }
  if (tempWarn != 0)             { sendAck(cmd, false, "TEMP_OUT_OF_RANGE"); return; }
  faultReason = nullptr;
  closeReason = CLOSE_NONE;
  state = ST_IDLE;
  sendAck(cmd, true, "");
  sendEvent("INFO", "FAULT_CLEARED");
}

void handleSetFlow(const char* arg, bool hasArg) {
  const char* cmd = "SET_FLOW";
  if (state == ST_FAULT) { sendAck(cmd, false, "IN_FAULT"); return; }
  if (!flowOverride)     { sendAck(cmd, false, "OVERRIDE_REQUIRED"); return; }
  if (!hasArg)           { sendAck(cmd, false, "MISSING_VALUE"); return; }

  char* endp = nullptr;
  double v = strtod(arg, &endp);
  if (endp == arg || *endp != '\0') { sendAck(cmd, false, "BAD_VALUE"); return; }
  if (!(v >= FLOW_MIN_PCTS && v <= FLOW_MAX_PCTS)) { sendAck(cmd, false, "OUT_OF_RANGE"); return; }

  flowSet = (float)v;
  sendAck(cmd, true, "");
}

// OVERRIDE ON  -> manual flow (SET_FLOW allowed)
// OVERRIDE OFF -> back to the AUTO profile
void handleOverride(const char* arg, bool hasArg) {
  const char* cmd = "OVERRIDE";
  if (!hasArg) { sendAck(cmd, false, "MISSING_VALUE"); return; }

  if (strcasecmp(arg, "ON") == 0) {
    if (state == ST_FAULT) { sendAck(cmd, false, "IN_FAULT"); return; }
    if (flowOverride)      { sendAck(cmd, false, "ALREADY_MANUAL"); return; }
    // Take over from the current rate so the flow doesn't jump.
    if (state == ST_TRANSFER && flowRate >= FLOW_MIN_PCTS) flowSet = flowRate;
    flowOverride = true;
    sendAck(cmd, true, "");
    sendEvent("WARN", "FLOW_OVERRIDE_ON");
  } else if (strcasecmp(arg, "OFF") == 0) {
    if (!flowOverride) { sendAck(cmd, false, "ALREADY_AUTO"); return; }
    flowOverride = false;
    sendAck(cmd, true, "");
    sendEvent("INFO", "FLOW_AUTO");
  } else {
    sendAck(cmd, false, "BAD_VALUE");
  }
}

void handleRefill(bool hasArg) {
  const char* cmd = "REFILL";
  if (hasArg)            { sendAck(cmd, false, "UNEXPECTED_ARGUMENT"); return; }
  if (state != ST_IDLE)  { sendAck(cmd, false, "NOT_IDLE"); return; }
  tankA = TANK_FULL_PCT;
  tankB = 0.0f;
  sendAck(cmd, true, "");
  sendEvent("INFO", "TANKS_REFILLED");
}

// Parse one complete line in place: "<CMD> [arg]".
void handleLine(char* line, uint32_t now) {
  while (isBlank(*line)) line++;
  char* end = line + strlen(line);
  while (end > line && isBlank(end[-1])) *--end = '\0';
  if (*line == '\0') return;  // ignore empty lines

  lastLinkMs = now;           // any non-empty line proves the link is alive

  // Uppercase the command word and split off the argument.
  char* arg = line;
  while (*arg && !isBlank(*arg)) { *arg = (char)toupper((unsigned char)*arg); arg++; }
  if (*arg) {
    *arg++ = '\0';
    while (isBlank(*arg)) arg++;
  }
  const char* cmd = line;
  bool hasArg = (*arg != '\0');

  if      (strcmp(cmd, "PING") == 0)     sendAck("PING", !hasArg, hasArg ? "UNEXPECTED_ARGUMENT" : "");
  else if (strcmp(cmd, "START") == 0)    handleStart(hasArg, now);
  else if (strcmp(cmd, "STOP") == 0)     handleStop(hasArg, now);
  else if (strcmp(cmd, "RESET") == 0)    handleReset(hasArg);
  else if (strcmp(cmd, "SET_FLOW") == 0) handleSetFlow(arg, hasArg);
  else if (strcmp(cmd, "OVERRIDE") == 0) handleOverride(arg, hasArg);
  else if (strcmp(cmd, "REFILL") == 0)   handleRefill(hasArg);
#if ENABLE_DEBUG_HANG
  else if (strcmp(cmd, "DEBUG_HANG") == 0) {
    sendAck("DEBUG_HANG", true, "");
    sendEvent("WARN", "HANGING_FOR_WDT_TEST");
    Serial.flush();
    for (;;) { }  // no wdt_reset() -> hardware watchdog resets the board in ~2 s
  }
#endif
  else sendAck(cmd, false, "UNKNOWN_COMMAND");
}

// Non-blocking line reader into a fixed buffer.
void readSerial(uint32_t now) {
  uint8_t budget = MAX_RX_PER_LOOP;
  while (budget-- && Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;

    if (c == '\n') {
      if (cmdOverflow) {
        lastLinkMs = now;
        sendAck("?", false, "LINE_TOO_LONG");
      } else {
        cmdBuf[cmdLen] = '\0';
        handleLine(cmdBuf, now);
      }
      cmdLen = 0;
      cmdOverflow = false;
      continue;
    }

    if (cmdOverflow) continue;  // discard until end of line
    if (cmdLen < CMD_BUF_SIZE - 1) cmdBuf[cmdLen++] = c;
    else cmdOverflow = true;
  }
}

// ============================================================================
//  SETUP & LOOP
// ============================================================================

void setup() {
  wdt_disable();

  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  pinMode(PIN_TEMP_BTN, INPUT_PULLUP);
  btnStable = btnLastRaw = digitalRead(PIN_TEMP_BTN);  // no phantom press at boot

  valveServo.write(SERVO_STOP);   // set pulse before attaching -> no twitch
  valveServo.attach(PIN_SERVO);
  valveServo.write(SERVO_STOP);

  Serial.begin(115200);
  wdt_enable(WDTO_2S);

  // The 32U4 has native USB: opening the port does NOT reset the board, so
  // give the host a moment to connect so it sees BOOT/hello. Bounded wait.
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < USB_WAIT_MS) {
    wdt_reset();
  }

  pressureKpa = readPressureRaw();  // seed the filter

  uint32_t now = millis();
  valveLastMs    = now;
  lastLinkMs     = now;
  lastPressureMs = now;
  lastTankMs     = now;
  nextTlmMs      = now + TLM_PERIOD_MS;

  sendEvent("INFO", "BOOT");
  sendHello();
}

void loop() {
  wdt_reset();
  uint32_t now = millis();

  readSerial(now);
  samplePressure(now);
  readTempButton(now);
  bool valveArrived = valveUpdate(now);
  runStateMachine(now, valveArrived);
  updateLeds(now);

  if ((int32_t)(now - nextTlmMs) >= 0) {
    sendTelemetry(now);
    nextTlmMs += TLM_PERIOD_MS;
    if ((int32_t)(now - nextTlmMs) >= 0) nextTlmMs = now + TLM_PERIOD_MS;  // resync if we fell behind
  }
}
