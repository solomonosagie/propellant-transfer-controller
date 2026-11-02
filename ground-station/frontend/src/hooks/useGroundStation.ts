import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "../lib/api";
import { HISTORY_MS, NO_SIGNAL_MS } from "../lib/limits";
import { initialMission, missionOnEvent, missionOnState } from "../lib/mission";
import type {
  DeviceState,
  Hello,
  LogEntry,
  Mission,
  PacketStats,
  Sample,
  ServerMsg,
  Status,
  Telemetry,
  Toast,
} from "../types";

// Single source of truth for the dashboard. Owns the WebSocket to the backend
// and turns the raw message stream into React state: latest telemetry, a 60 s
// rolling history for the charts, the event log, toasts and link-quality stats.
//
// Telemetry arrives at 5 Hz, so per-packet bookkeeping (sequence tracking,
// receive timestamps, counters) lives in refs. Only the 4 Hz ticker publishes
// those numbers, which keeps re-renders bounded no matter how fast data comes in.

const MAX_LOG = 500;
const RATE_WINDOW_MS = 5_000;
const TOAST_MS = 4_000;

export interface GroundStation {
  wsOpen: boolean;
  status: Status | null;
  linkUp: boolean;
  tlm: Telemetry | null;
  history: Sample[];
  log: LogEntry[];
  toasts: Toast[];
  stats: PacketStats;
  hello: Hello | null;
  mission: Mission;
  stateSince: number | null;
  lastTlmAt: number | null;
  now: number;
  noSignal: boolean;
  sendCommand: (cmd: string) => boolean;
  dismissToast: (id: number) => void;
  clearLog: () => void;
}

/** Converts a server message into an event-log line, or null if it isn't loggable. */
function toLogEntry(m: ServerMsg): Omit<LogEntry, "id"> | null {
  switch (m.type) {
    case "evt":
      return { ts: m.rx, level: m.level, source: "DEVICE", msg: m.msg };
    case "ack":
      if (m.cmd === "PING" && m.ok) return null;
      return {
        ts: m.rx,
        level: m.ok ? "INFO" : "WARN",
        source: m.local ? "GROUND" : "DEVICE",
        msg: m.ok ? `ACK ${m.cmd} accepted` : `ACK ${m.cmd} rejected: ${m.reason || "no reason"}`,
      };
    case "cmd_sent":
      return { ts: m.rx, level: "CMD", source: "GROUND", msg: `> ${m.cmd}` };
    case "link":
      return {
        ts: m.rx,
        level: m.connected ? "SYS" : "WARN",
        source: "GROUND",
        msg: m.connected ? `Device link UP on ${m.port}` : `Device link DOWN${m.error ? ` (${m.error})` : ""}`,
      };
    case "parse_error":
      return { ts: m.rx, level: "WARN", source: "GROUND", msg: `Malformed line dropped, ${m.error}: ${m.line}` };
    case "hello":
      return {
        ts: m.rx,
        level: "SYS",
        source: "DEVICE",
        msg: `HELLO ${m.fw ?? "?"} v${m.version ?? "?"}${m.board ? ` (${m.board})` : ""}`,
      };
    default:
      return null;
  }
}

export function useGroundStation(): GroundStation {
  const [wsOpen, setWsOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [linkUp, setLinkUp] = useState(false);
  const [tlm, setTlm] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hello, setHello] = useState<Hello | null>(null);
  const [mission, setMission] = useState<Mission>(initialMission);
  const [stateSince, setStateSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stats, setStats] = useState<PacketStats>({ rate: 0, received: 0, dropped: 0, parseErrors: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);
  const lastSeq = useRef<number | null>(null);
  const lastState = useRef<DeviceState | null>(null);
  const lastTlmAt = useRef(0);
  const rxTimes = useRef<number[]>([]);
  const counters = useRef({ received: 0, dropped: 0, parseErrors: 0 });

  const nextId = () => ++idRef.current;

  const pushLog = useCallback((entries: Omit<LogEntry, "id">[]) => {
    if (!entries.length) return;
    setLog((prev) => {
      const next = prev.concat(entries.map((e) => ({ ...e, id: nextId() })));
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId();
      setToasts((t) => [...t.slice(-4), { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  const handleTelemetry = useCallback(
    (m: Telemetry) => {
      const rx = Date.now();
      lastTlmAt.current = rx;
      rxTimes.current.push(rx);
      counters.current.received += 1;

      // The firmware increments seq on every frame, so a gap means frames were
      // lost on the wire. A seq that goes backwards means the board restarted
      // (power cycle or watchdog reset), which is worth calling out in the log.
      const prevSeq = lastSeq.current;
      if (prevSeq !== null) {
        if (m.seq > prevSeq + 1) counters.current.dropped += m.seq - prevSeq - 1;
        else if (m.seq < prevSeq) {
          pushLog([{ ts: rx, level: "SYS", source: "GROUND", msg: "Sequence restarted: device reboot detected" }]);
        }
      }
      lastSeq.current = m.seq;

      if (m.state !== lastState.current) {
        const prev = lastState.current;
        setMission((ms) => missionOnState(ms, prev, m.state, rx));
        setStateSince(rx);
        lastState.current = m.state;
      }

      setTlm(m);
      // Samples are appended in time order, so expired ones are always at the front.
      setHistory((h) => {
        const cutoff = rx - HISTORY_MS;
        let start = 0;
        while (start < h.length && h[start].x < cutoff) start++;
        const next = start ? h.slice(start) : h.slice();
        next.push({ x: rx, pressure: m.pressure, tankA: m.tankA, tankB: m.tankB, flow: m.flow, temp: m.temp ?? null });
        return next;
      });
    },
    [pushLog],
  );

  const handleMessage = useCallback(
    (m: ServerMsg) => {
      switch (m.type) {
        case "tlm":
          handleTelemetry(m);
          return;
        case "status":
          setStatus(m);
          setLinkUp(m.link.connected);
          if (m.hello) setHello(m.hello);
          return;
        case "history":
          pushLog(m.items.map(toLogEntry).filter((e): e is Omit<LogEntry, "id"> => e !== null));
          return;
        case "link":
          setLinkUp(m.connected);
          break;
        case "hello":
          setHello(m);
          break;
        case "parse_error":
          counters.current.parseErrors += 1;
          break;
        case "evt":
          setMission((ms) => missionOnEvent(ms, m.msg, Date.now()));
          break;
        case "ack":
          if (m.cmd !== "PING") {
            pushToast({
              ok: m.ok,
              title: `${m.cmd} ${m.ok ? "ACCEPTED" : "REJECTED"}`,
              detail: m.ok ? "Command acknowledged by device" : m.reason || "Rejected",
            });
          }
          break;
      }
      const entry = toLogEntry(m);
      if (entry) pushLog([entry]);
    },
    [handleTelemetry, pushLog, pushToast],
  );

  // Reconnect every second for as long as the page is open, so restarting the
  // backend never needs a browser refresh.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setWsOpen(true);
        setLog([]); // the backend replays its history on connect
      };
      ws.onclose = () => {
        setWsOpen(false);
        setLinkUp(false);
        if (!stopped) timer = window.setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        let msg: unknown;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg && typeof msg === "object" && "type" in msg) handleMessage(msg as ServerMsg);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [handleMessage]);

  // 4 Hz ticker: clock, packet rate, no-signal detection.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      rxTimes.current = rxTimes.current.filter((x) => t - x <= RATE_WINDOW_MS);
      setNow(t);
      setStats({ rate: rxTimes.current.length / (RATE_WINDOW_MS / 1000), ...counters.current });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const sendCommand = useCallback((cmd: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "cmd", cmd }));
    return true;
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

  // "No signal" is judged on telemetry freshness, not just socket state: the
  // backend can be up with the USB link alive while the device has stopped talking.
  const lastTlm = lastTlmAt.current || null;
  const noSignal = !wsOpen || lastTlm === null || now - lastTlm > NO_SIGNAL_MS;

  return {
    wsOpen,
    status,
    linkUp: wsOpen && linkUp,
    tlm,
    history,
    log,
    toasts,
    stats,
    hello,
    mission,
    stateSince,
    lastTlmAt: lastTlm,
    now,
    noSignal,
    sendCommand,
    dismissToast,
    clearLog,
  };
}
