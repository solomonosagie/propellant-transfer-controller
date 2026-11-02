import { RefreshCw, Satellite, Usb } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FaultAlarm } from "../hooks/useFaultAlarm";
import { AlarmControl } from "./AlarmControl";
import { api } from "../lib/api";
import { fmtDuration, fmtUtcClock } from "../lib/format";
import type { PacketStats, SerialPortInfo, Status, Telemetry } from "../types";

interface Props {
  linkUp: boolean;
  status: Status | null;
  tlm: Telemetry | null;
  stats: PacketStats;
  now: number;
  alarm: FaultAlarm;
}

export function TopBar({ linkUp, status, tlm, stats, now, alarm }: Props) {
  const sim = status?.mode === "sim";

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-sky-400/10 bg-space-900/70 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <Satellite className="h-5 w-5 text-cyan-300" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-sky-300/50">Mission Control</div>
          <div className="num text-base font-bold tracking-wider text-white">PROP-XFER-01</div>
        </div>
        {sim && (
          <span className="rounded border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-violet-200">
            SIM
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full pulse-dot ${linkUp ? "bg-emerald-400 text-emerald-400" : "bg-red-500 text-red-500"}`}
        />
        <span className={`num text-sm font-semibold tracking-widest ${linkUp ? "text-emerald-300" : "text-red-300"}`}>
          {linkUp ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>

      <Item label="UTC" value={fmtUtcClock(now)} />
      <Item label="Device uptime" value={tlm ? fmtDuration(tlm.uptime) : "--:--:--"} />
      <Item label="Packet rate" value={`${stats.rate.toFixed(1)} Hz`} />
      <Item label="Dropped" value={String(stats.dropped)} tone={stats.dropped ? "text-amber-300" : undefined} />
      <Item label="Malformed" value={String(stats.parseErrors)} tone={stats.parseErrors ? "text-amber-300" : undefined} />

      <div className="ml-auto flex items-center gap-4">
        <AlarmControl alarm={alarm} />
        {sim ? <SimBadge /> : <PortPicker status={status} />}
      </div>
    </header>
  );
}

function Item({ label, value, tone = "text-sky-50" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-[0.16em] text-sky-300/50">{label}</div>
      <div className={`num text-sm ${tone}`}>{value}</div>
    </div>
  );
}

function SimBadge() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200">
      <Usb className="h-3.5 w-3.5" /> Simulated device
    </div>
  );
}

function PortPicker({ status }: { status: Status | null }) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const requested = status?.link.requested_port ?? "";

  const refresh = useCallback(async () => {
    try {
      setPorts((await api.ports()).ports);
    } catch {
      setPorts([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choose = async (value: string) => {
    setBusy(true);
    try {
      await api.setPort(value || null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <Usb className="h-4 w-4 text-cyan-300" />
      <select
        value={requested}
        disabled={busy}
        onChange={(e) => void choose(e.target.value)}
        onFocus={() => void refresh()}
        className="num rounded-md border border-sky-400/20 bg-space-800 px-2 py-1.5 text-sky-100 outline-none focus:border-cyan-400/60"
        title={status?.link.error ?? undefined}
      >
        <option value="">AUTO ({status?.link.port ?? "searching"})</option>
        {ports.map((p) => (
          <option key={p.device} value={p.device}>
            {p.device} · {p.description}
            {p.likely ? " ★" : ""}
          </option>
        ))}
      </select>
      <button
        onClick={() => void refresh()}
        className="rounded-md border border-sky-400/20 p-1.5 text-sky-300 hover:border-cyan-400/50 hover:text-white"
        title="Rescan serial ports"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
