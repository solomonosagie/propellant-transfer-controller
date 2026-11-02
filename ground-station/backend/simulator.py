"""Software model of the Pro Micro firmware for --sim mode.

Speaks exactly the same line protocol as the real device (same states,
events, ack reasons and timings), so the frontend can't tell the
difference. It also adds a few demo hooks: pressure spikes, USB dropouts,
the odd dropped packet and the odd malformed line.
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import time
from typing import Any, Callable

VALVE_TRAVEL_S = 0.6
TLM_PERIOD_S = 0.2
TICK_S = 0.02
LINK_TIMEOUT_S = 10.0
PRESSURE_WARN = 220.0
PRESSURE_WARN_CLEAR = 215.0
PRESSURE_FAULT = 250.0
PRESSURE_RESET_MAX = 150.0
FLOW_MIN, FLOW_MAX = 0.1, 20.0
FLOW_AUTO_START, FLOW_AUTO_CRUISE, FLOW_AUTO_END = 0.5, 4.0, 0.5
FLOW_TAPER_START_PCT = 20.0
FLOW_SLEW_UP, FLOW_SLEW_DOWN = 0.8, 2.0
TEMP_START, TEMP_STEP = 20, 10
TEMP_MIN, TEMP_MAX = -20, 60
TEMP_SAFE_MIN, TEMP_SAFE_MAX = 10, 40

DROP_PACKET_P = 0.004
MALFORMED_P = 0.002


class Simulator:
    mode = "sim"

    def __init__(self, on_line: Callable[[bytes], None], on_status: Callable[[bool, "str | None", "str | None"], None]) -> None:
        self._on_line = on_line
        self._on_status = on_status
        self.connected = False
        self.port: str | None = "SIMULATOR"
        self.requested_port: str | None = None
        self.error: str | None = None
        self._task: asyncio.Task | None = None
        self._rx: list[str] = []

        self.t0 = time.monotonic()
        self.state = "IDLE"
        self.close_reason: str | None = None  # STOP | COMPLETE | FAULT
        self.fault: str | None = None
        self.valve_dir = 0
        self.valve_pos = 0.0  # seconds of travel, 0 = closed
        self.tank_a = 100.0
        self.tank_b = 0.0
        self.flow = 0.0  # actual rate
        self.flow_set = 2.0  # manual setpoint
        self.override = False
        self.pressure = 110.0
        self.warn = False
        self.temp = TEMP_START
        self.temp_dir = 1
        self.temp_warn = 0
        self.seq = 0
        self.last_link = self.t0
        self.spike_until = 0.0
        self.dropout_until = 0.0

    # ---- link interface ------------------------------------------------------
    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def send(self, line: str) -> bool:
        if not self.connected:
            return False
        self._rx.append(line)
        return True

    def set_port(self, port: str | None) -> None:
        pass

    # ---- demo hooks -----------------------------------------------------------
    def spike(self, seconds: float = 5.0) -> None:
        self.spike_until = time.monotonic() + seconds

    def dropout(self, seconds: float = 5.0) -> None:
        self.dropout_until = time.monotonic() + seconds

    def press_temp_button(self) -> None:
        """Same ping-pong behaviour as the D4 button on the real board."""
        self.temp += self.temp_dir * TEMP_STEP
        if self.temp >= TEMP_MAX:
            self.temp, self.temp_dir = TEMP_MAX, -1
            self._evt("INFO", "TEMP_MAX_REACHED")
        elif self.temp <= TEMP_MIN:
            self.temp, self.temp_dir = TEMP_MIN, 1
            self._evt("INFO", "TEMP_MIN_REACHED")
        warn = -1 if self.temp < TEMP_SAFE_MIN else (1 if self.temp > TEMP_SAFE_MAX else 0)
        if warn != self.temp_warn:
            self.temp_warn = warn
            self._evt(*{1: ("WARN", "TEMP_HIGH"), -1: ("WARN", "TEMP_LOW"), 0: ("INFO", "TEMP_NORMAL")}[warn])

    # ---- output ----------------------------------------------------------------
    def _millis(self) -> int:
        return int((time.monotonic() - self.t0) * 1000)

    def _emit(self, obj: dict[str, Any]) -> None:
        if self.connected:
            self._on_line(json.dumps(obj, separators=(",", ":")).encode())

    def _evt(self, level: str, msg: str) -> None:
        self._emit({"type": "evt", "t": self._millis(), "level": level, "msg": msg})

    def _ack(self, cmd: str, ok: bool, reason: str = "") -> None:
        self._emit({"type": "ack", "cmd": cmd, "ok": ok, "reason": reason})

    def _valve_name(self) -> str:
        if self.valve_dir > 0:
            return "OPENING"
        if self.valve_dir < 0:
            return "CLOSING"
        if self.valve_pos <= 0:
            return "CLOSED"
        if self.valve_pos >= VALVE_TRAVEL_S:
            return "OPEN"
        return "PARTIAL"

    def _telemetry(self) -> None:
        msg = {
            "type": "tlm",
            "t": self._millis(),
            "state": self.state,
            "pressure": round(self.pressure, 1),
            "tankA": round(self.tank_a, 1),
            "tankB": round(self.tank_b, 1),
            "valve": self._valve_name(),
            "flow": round(self.flow, 2),
            "flowSet": round(self.flow_set, 2),
            "flowMode": "MANUAL" if self.override else "AUTO",
            "temp": self.temp,
            "tempDir": "UP" if self.temp_dir > 0 else "DOWN",
            "fault": self.fault,
            "uptime": self._millis() // 1000,
            "seq": self.seq,
        }
        self.seq += 1
        roll = random.random()
        if roll < DROP_PACKET_P:
            return  # lost on the wire -> shows up as a seq gap
        if roll < DROP_PACKET_P + MALFORMED_P:
            if self.connected:
                self._on_line(json.dumps(msg).encode()[:37])  # truncated line
            return
        self._emit(msg)

    # ---- state machine (mirrors the firmware) ------------------------------------
    def _set_connected(self, connected: bool) -> None:
        self.connected = connected
        self.error = None if connected else "Simulated USB dropout"
        self._on_status(connected, self.port, self.error)

    def _begin_close(self, reason: str) -> None:
        self.close_reason = reason
        self.valve_dir = -1
        self.flow = 0.0
        self.state = "CLOSING"
        self._evt("INFO", "VALVE_CLOSING")

    def _trigger_fault(self, reason: str) -> None:
        if self.state == "FAULT" or self.close_reason == "FAULT":
            return
        self.fault = reason
        self._evt("FAULT", reason)
        if self.override:
            self.override = False
            self._evt("INFO", "FLOW_AUTO")
        if self.valve_dir == 0 and self.valve_pos <= 0:
            self.close_reason = None
            self.state = "FAULT"
        else:
            self._begin_close("FAULT")

    def _handle(self, line: str, now: float) -> None:
        parts = line.strip().split(None, 1)
        if not parts:
            return
        self.last_link = now
        cmd = parts[0].upper()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd in ("PING", "START", "STOP", "RESET", "REFILL") and arg:
            self._ack(cmd, False, "UNEXPECTED_ARGUMENT")
        elif cmd == "PING":
            self._ack(cmd, True)
        elif cmd == "START":
            if self.state == "FAULT":
                self._ack(cmd, False, "IN_FAULT")
            elif self.state != "IDLE":
                self._ack(cmd, False, "NOT_IDLE")
            elif self.tank_a <= 0:
                self._ack(cmd, False, "TANK_A_EMPTY")
            elif self.warn:
                self._ack(cmd, False, "PRESSURE_HIGH")
            else:
                self._ack(cmd, True)
                self.close_reason = None
                self.valve_dir = 1
                self.state = "OPENING"
                self._evt("INFO", "VALVE_OPENING")
        elif cmd == "STOP":
            if self.state == "FAULT":
                self._ack(cmd, False, "IN_FAULT")
            elif self.state == "CLOSING":
                self._ack(cmd, False, "ALREADY_CLOSING")
            elif self.state == "IDLE":
                self._ack(cmd, False, "NOT_ACTIVE")
            else:
                self._ack(cmd, True)
                self._begin_close("STOP")
        elif cmd == "RESET":
            if self.close_reason == "FAULT":
                self._ack(cmd, False, "SAFING_IN_PROGRESS")
            elif self.state != "FAULT":
                self._ack(cmd, False, "NO_FAULT")
            elif self.pressure >= PRESSURE_RESET_MAX:
                self._ack(cmd, False, "PRESSURE_TOO_HIGH")
            elif self.temp_warn != 0:
                self._ack(cmd, False, "TEMP_OUT_OF_RANGE")
            else:
                self.fault = None
                self.close_reason = None
                self.state = "IDLE"
                self._ack(cmd, True)
                self._evt("INFO", "FAULT_CLEARED")
        elif cmd == "OVERRIDE":
            mode = arg.upper()
            if not arg:
                self._ack(cmd, False, "MISSING_VALUE")
            elif mode == "ON":
                if self.state == "FAULT":
                    self._ack(cmd, False, "IN_FAULT")
                elif self.override:
                    self._ack(cmd, False, "ALREADY_MANUAL")
                else:
                    if self.state == "TRANSFER" and self.flow >= FLOW_MIN:
                        self.flow_set = self.flow
                    self.override = True
                    self._ack(cmd, True)
                    self._evt("WARN", "FLOW_OVERRIDE_ON")
            elif mode == "OFF":
                if not self.override:
                    self._ack(cmd, False, "ALREADY_AUTO")
                else:
                    self.override = False
                    self._ack(cmd, True)
                    self._evt("INFO", "FLOW_AUTO")
            else:
                self._ack(cmd, False, "BAD_VALUE")
        elif cmd == "SET_FLOW":
            if self.state == "FAULT":
                self._ack(cmd, False, "IN_FAULT")
            elif not self.override:
                self._ack(cmd, False, "OVERRIDE_REQUIRED")
            elif not arg:
                self._ack(cmd, False, "MISSING_VALUE")
            else:
                try:
                    value = float(arg)
                except ValueError:
                    self._ack(cmd, False, "BAD_VALUE")
                    return
                if not (FLOW_MIN <= value <= FLOW_MAX):
                    self._ack(cmd, False, "OUT_OF_RANGE")
                else:
                    self.flow_set = value
                    self._ack(cmd, True)
        elif cmd == "REFILL":
            if self.state != "IDLE":
                self._ack(cmd, False, "NOT_IDLE")
            else:
                self.tank_a, self.tank_b = 100.0, 0.0
                self._ack(cmd, True)
                self._evt("INFO", "TANKS_REFILLED")
        else:
            self._ack(cmd[:40], False, "UNKNOWN_COMMAND")

    def _update_flow(self, dt: float) -> None:
        """AUTO: soft start -> cruise -> taper (slew-limited). MANUAL: setpoint."""
        if self.override:
            self.flow = self.flow_set
            return
        target = FLOW_AUTO_CRUISE
        if self.tank_a < FLOW_TAPER_START_PCT:
            target = max(FLOW_AUTO_END, FLOW_AUTO_CRUISE * self.tank_a / FLOW_TAPER_START_PCT)
        delta = max(-FLOW_SLEW_DOWN * dt, min(FLOW_SLEW_UP * dt, target - self.flow))
        self.flow += delta

    def _step(self, now: float, dt: float) -> None:
        # There's no potentiometer here, so pressure is synthesized: a slow
        # sinusoidal drift, a bump while fuel is moving, and a spike on demand.
        target = 115 + 20 * math.sin(now / 15) + (35 if self.state == "TRANSFER" else 0)
        if now < self.spike_until:
            target = 285
        self.pressure += (target - self.pressure) * min(1.0, dt * 1.5) + random.gauss(0, 0.5)
        self.pressure = max(0.0, min(300.0, self.pressure))

        if not self.warn and self.pressure >= PRESSURE_WARN:
            self.warn = True
            self._evt("WARN", "PRESSURE_HIGH")
        elif self.warn and self.pressure < PRESSURE_WARN_CLEAR:
            self.warn = False
            self._evt("INFO", "PRESSURE_NORMAL")

        arrived = False
        if self.valve_dir:
            self.valve_pos = max(0.0, min(VALVE_TRAVEL_S, self.valve_pos + self.valve_dir * dt))
            if (self.valve_dir > 0 and self.valve_pos >= VALVE_TRAVEL_S) or (self.valve_dir < 0 and self.valve_pos <= 0):
                self.valve_dir = 0
                arrived = True

        if self.state == "OPENING" and arrived:
            self.state = "TRANSFER"
            self.flow = self.flow_set if self.override else FLOW_AUTO_START
            self._evt("INFO", "VALVE_OPEN")
            self._evt("INFO", "TRANSFER_STARTED")
        elif self.state == "TRANSFER":
            self._update_flow(dt)
            moved = min(self.tank_a, self.flow * dt)
            self.tank_a -= moved
            self.tank_b += moved
            if self.tank_a <= 0:
                self.tank_a, self.tank_b = 0.0, 100.0
                self._evt("INFO", "TANK_A_EMPTY")
                self._begin_close("COMPLETE")
            elif now - self.last_link > LINK_TIMEOUT_S:
                self._trigger_fault("LINK_LOSS")
        elif self.state == "CLOSING" and arrived:
            self._evt("INFO", "VALVE_CLOSED")
            if self.close_reason == "FAULT":
                self.state = "FAULT"
            else:
                self.state = "IDLE"
                self._evt("INFO", "TRANSFER_COMPLETE" if self.close_reason == "COMPLETE" else "TRANSFER_STOPPED")
            self.close_reason = None

        if self.pressure >= PRESSURE_FAULT:
            self._trigger_fault("OVERPRESSURE")
        if self.temp > TEMP_SAFE_MAX:
            self._trigger_fault("OVERTEMP")
        elif self.temp < TEMP_SAFE_MIN:
            self._trigger_fault("UNDERTEMP")

    async def _run(self) -> None:
        self._set_connected(True)
        self._evt("INFO", "BOOT")
        self._emit(
            {
                "type": "hello",
                "fw": "PTC-SIM",
                "version": "1.3.0-sim",
                "board": "Simulated Pro Micro",
                "baud": 115200,
                "pins": {"pressure": "A0", "temp_button": "D4", "servo": "D8", "led_red": "D9", "led_yellow": "D10", "led_green": "D16"},
            }
        )
        last = time.monotonic()
        next_tlm = last + TLM_PERIOD_S
        while True:
            await asyncio.sleep(TICK_S)
            now = time.monotonic()
            dt, last = now - last, now

            online = now >= self.dropout_until
            if online != self.connected:
                self._set_connected(online)

            pending, self._rx = self._rx, []
            if online:
                for line in pending:
                    self._handle(line, now)

            self._step(now, dt)

            if now >= next_tlm:
                self._telemetry()
                next_tlm += TLM_PERIOD_S
                if now >= next_tlm:
                    next_tlm = now + TLM_PERIOD_S
