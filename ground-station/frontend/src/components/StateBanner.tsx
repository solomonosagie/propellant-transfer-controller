import { CircleCheck, Pause, RefreshCw, ShieldAlert, Thermometer, Zap } from "lucide-react";
import { fmtDuration, num } from "../lib/format";
import { isThermalFault, TEMP_SAFE_MAX, TEMP_SAFE_MIN } from "../lib/limits";
import type { DeviceState, Telemetry } from "../types";

const STYLE: Record<DeviceState, { box: string; text: string; label: string; desc: string; icon: typeof Zap }> = {
  IDLE: {
    box: "border-slate-400/30 bg-slate-500/10",
    text: "text-slate-200",
    label: "IDLE",
    desc: "Valve closed. Ready for transfer.",
    icon: Pause,
  },
  OPENING: {
    box: "border-amber-400/50 bg-amber-500/10",
    text: "text-amber-300",
    label: "OPENING",
    desc: "Valve actuating open.",
    icon: RefreshCw,
  },
  TRANSFER: {
    box: "border-emerald-400/50 bg-emerald-500/10 shadow-[0_0_30px_-10px_rgba(52,211,153,0.7)]",
    text: "text-emerald-300",
    label: "TRANSFER",
    desc: "Propellant flowing Tank A → Tank B.",
    icon: Zap,
  },
  CLOSING: {
    box: "border-amber-400/50 bg-amber-500/10",
    text: "text-amber-300",
    label: "CLOSING",
    desc: "Valve actuating closed.",
    icon: RefreshCw,
  },
  FAULT: {
    box: "fault-flash",
    text: "text-red-200",
    label: "FAULT",
    desc: "Transfer inhibited. Valve safed closed.",
    icon: ShieldAlert,
  },
};

interface Props {
  tlm: Telemetry | null;
  stateSince: number | null;
  now: number;
}

const THERMAL_STYLE = {
  box: "thermal-flash",
  text: "text-orange-200",
  icon: Thermometer,
};

export function StateBanner({ tlm, stateSince, now }: Props) {
  const state = tlm?.state ?? "IDLE";
  const thermal = state === "FAULT" && isThermalFault(tlm?.fault);
  const s = thermal
    ? {
        ...THERMAL_STYLE,
        label: "THERMAL FAULT",
        desc:
          tlm?.fault === "OVERTEMP"
            ? `Propellant above ${TEMP_SAFE_MAX} °C. Valve safed closed.`
            : `Propellant below ${TEMP_SAFE_MIN} °C (freeze risk). Valve safed closed.`,
      }
    : (STYLE[state] ?? STYLE.IDLE);
  const Icon = s.icon;
  const moving = state === "OPENING" || state === "CLOSING";

  return (
    <section id="overview" className="panel scroll-mt-4 p-4">
      <div className="flex flex-wrap items-stretch gap-4">
        <div className={`flex min-w-[280px] flex-1 items-center gap-4 rounded-xl border px-5 py-4 ${s.box}`}>
          <Icon className={`h-10 w-10 shrink-0 ${s.text} ${moving ? "animate-spin [animation-duration:1.5s]" : ""}`} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-sky-300/60">Spacecraft state</div>
            <div className={`num text-4xl font-bold tracking-[0.12em] ${s.text}`}>{tlm ? s.label : "UNKNOWN"}</div>
            <div className="text-sm text-sky-200/70">{tlm ? s.desc : "Awaiting telemetry…"}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300/50">In state</div>
            <div className="num text-lg text-sky-50">{stateSince ? fmtDuration((now - stateSince) / 1000) : "--:--:--"}</div>
          </div>
        </div>

        <div
          className={`flex min-w-[240px] items-center gap-3 rounded-xl border px-5 py-4 ${
            tlm?.fault ? "border-red-400/60 bg-red-500/15" : "border-emerald-400/20 bg-emerald-500/5"
          }`}
        >
          {tlm?.fault ? (
            <ShieldAlert className="h-7 w-7 text-red-300" />
          ) : (
            <CircleCheck className="h-7 w-7 text-emerald-300" />
          )}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300/50">Fault reason</div>
            <div className={`num text-xl font-semibold ${tlm?.fault ? "text-red-200" : "text-emerald-200"}`}>
              {tlm?.fault ?? "NOMINAL"}
            </div>
          </div>
        </div>

        <div className="grid min-w-[360px] grid-cols-5 gap-4 rounded-xl border border-sky-400/10 bg-space-800/40 px-5 py-4">
          <Readout label="Valve" value={tlm?.valve ?? "--"} />
          <Readout label={`Flow · ${tlm?.flowMode === "MANUAL" ? "MAN" : "AUTO"}`} value={`${num(tlm?.flow, 2)}`} unit="%/s" />
          <Readout label="Tank A" value={num(tlm?.tankA)} unit="%" />
          <Readout label="Tank B" value={num(tlm?.tankB)} unit="%" />
          <Readout label="Temp" value={num(tlm?.temp, 0)} unit="°C" />
        </div>
      </div>
    </section>
  );
}

function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-sky-300/50">{label}</div>
      <div className="num text-lg text-cyan-100">
        {value}
        {unit && <span className="ml-1 text-xs text-sky-300/50">{unit}</span>}
      </div>
    </div>
  );
}
