// Message shapes for the device protocol and the backend's own messages.
// Fields added in later firmware versions are optional, so the dashboard still
// works (with reduced features) against an older board.

export type DeviceState = "IDLE" | "OPENING" | "TRANSFER" | "CLOSING" | "FAULT";
export type EventLevel = "INFO" | "WARN" | "FAULT";
export type Mode = "serial" | "sim";

// `rx` is the host receive time (epoch ms) stamped by the backend.

export interface Telemetry {
  type: "tlm";
  t: number;
  state: DeviceState;
  pressure: number;
  tankA: number;
  tankB: number;
  valve: string; // OPEN | CLOSED | OPENING | CLOSING | PARTIAL
  flow: number; // actual rate, 0 unless transferring (firmware >= 1.2.0)
  flowSet?: number; // manual setpoint used when flowMode is MANUAL
  flowMode?: "AUTO" | "MANUAL";
  temp?: number; // °C, from the D4 button (firmware >= 1.1.0)
  tempDir?: "UP" | "DOWN"; // direction of the next button press
  fault: string | null;
  uptime: number;
  seq: number;
  rx: number;
}

export interface DeviceEvent {
  type: "evt";
  t?: number;
  level: EventLevel;
  msg: string;
  rx: number;
}

export interface Ack {
  type: "ack";
  cmd: string;
  ok: boolean;
  reason: string;
  rx: number;
  local?: boolean;
}

export interface Hello {
  type: "hello";
  fw?: string;
  version?: string;
  board?: string;
  rx: number;
}

export interface LinkMsg {
  type: "link";
  connected: boolean;
  port: string | null;
  error: string | null;
  mode: Mode;
  rx: number;
}

export interface ParseError {
  type: "parse_error";
  error: string;
  line: string;
  rx: number;
}

export interface CmdSent {
  type: "cmd_sent";
  cmd: string;
  rx: number;
}

export interface Status {
  type: "status";
  mode: Mode;
  link: { connected: boolean; port: string | null; requested_port: string | null; error: string | null };
  logging: { enabled: boolean; file: string | null; rows: number };
  stats: { rx_lines: number; parse_errors: number; clients: number };
  hello: Hello | null;
  rx: number;
}

export interface History {
  type: "history";
  items: ServerMsg[];
}

export type ServerMsg = Telemetry | DeviceEvent | Ack | Hello | LinkMsg | ParseError | CmdSent | Status | History;

export type LogLevel = EventLevel | "CMD" | "SYS";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: "DEVICE" | "GROUND";
  msg: string;
}

export interface Toast {
  id: number;
  ok: boolean;
  title: string;
  detail: string;
}

export interface Sample {
  x: number;
  pressure: number;
  tankA: number;
  tankB: number;
  flow: number;
  temp: number | null;
}

export type StepStatus = "pending" | "active" | "done" | "aborted" | "error";

export interface MissionStep {
  key: "standby" | "valve" | "transfer" | "complete";
  label: string;
  status: StepStatus;
  ts?: number;
}

export interface Mission {
  steps: MissionStep[];
  startedAt?: number;
  endedAt?: number;
}

export interface PacketStats {
  rate: number;
  received: number;
  dropped: number;
  parseErrors: number;
}

export interface SerialPortInfo {
  device: string;
  description: string;
  vid: string | null;
  pid: string | null;
  likely: boolean;
}

export interface LogFile {
  name: string;
  size: number;
  modified: number;
  active: boolean;
}
