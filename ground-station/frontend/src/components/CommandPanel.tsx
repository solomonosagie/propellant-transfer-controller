import {
  Droplets,
  FlaskConical,
  Lock,
  LockOpen,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  SquareTerminal,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import {
  FLOW_AUTO_CRUISE,
  FLOW_MAX,
  FLOW_MIN,
  FLOW_TAPER_PCT,
  PRESSURE_RESET_MAX,
  PRESSURE_WARN,
  TEMP_SAFE_MAX,
  TEMP_SAFE_MIN,
  tempInBand,
} from "../lib/limits";
import type { Telemetry } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Panel } from "./Panel";

interface Props {
  tlm: Telemetry | null;
  linkUp: boolean;
  noSignal: boolean;
  sim: boolean;
  sendCommand: (cmd: string) => boolean;
}

/**
 * Why each command is unavailable right now, or null if it can be sent.
 * Mirrors the firmware's own checks so the operator sees the reason on hover
 * instead of sending a command just to have it rejected. The device remains
 * the authority: if this ever disagrees, its ack wins.
 */
function blockers(tlm: Telemetry | null, live: boolean) {
  if (!live || !tlm) {
    const reason = "No live telemetry";
    return { start: reason, stop: reason, reset: reason, refill: reason, flow: reason, overrideOn: reason, overrideOff: reason };
  }
  const s = tlm.state;
  const manual = tlm.flowMode === "MANUAL";
  return {
    start:
      s === "FAULT"
        ? "Device in FAULT, reset first"
        : s !== "IDLE"
          ? "Only available in IDLE"
          : tlm.tankA <= 0
            ? "Tank A empty, REFILL first"
            : tlm.pressure >= PRESSURE_WARN
              ? `Pressure must be below ${PRESSURE_WARN} kPa`
              : null,
    stop: s === "OPENING" || s === "TRANSFER" ? null : "Only during OPENING or TRANSFER",
    reset:
      s !== "FAULT"
        ? "No active fault"
        : tlm.pressure >= PRESSURE_RESET_MAX
          ? `Pressure must be below ${PRESSURE_RESET_MAX} kPa`
          : !tempInBand(tlm.temp)
            ? `Bring temperature back to ${TEMP_SAFE_MIN}…${TEMP_SAFE_MAX} °C (press D4)`
            : null,
    refill: s === "IDLE" ? null : "Only available in IDLE",
    flow: s === "FAULT" ? "Unavailable in FAULT" : !manual ? "Enable MANUAL OVERRIDE first" : null,
    overrideOn: tlm.flowMode === undefined ? "Firmware v1.2.0 required" : s === "FAULT" ? "Unavailable in FAULT" : manual ? "Already in MANUAL" : null,
    overrideOff: manual ? null : "Already in AUTO",
  };
}

type Phase = "STANDBY" | "RAMP-UP" | "CRUISE" | "TAPER" | "MANUAL";

// The firmware doesn't report which part of the AUTO profile it's in, so the
// phase is inferred from tank level and how close the rate is to cruise.
function flowPhase(tlm: Telemetry | null): Phase {
  if (!tlm || tlm.state !== "TRANSFER") return tlm?.flowMode === "MANUAL" ? "MANUAL" : "STANDBY";
  if (tlm.flowMode === "MANUAL") return "MANUAL";
  if (tlm.tankA < FLOW_TAPER_PCT) return "TAPER";
  return tlm.flow < FLOW_AUTO_CRUISE - 0.05 ? "RAMP-UP" : "CRUISE";
}

export function CommandPanel({ tlm, linkUp, noSignal, sim, sendCommand }: Props) {
  const live = linkUp && !noSignal;
  const block = blockers(tlm, live);
  const [confirmReset, setConfirmReset] = useState(false);
  const [flow, setFlow] = useState(2);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pendingTimer = useRef<number | undefined>(undefined);

  const manual = tlm?.flowMode === "MANUAL";
  const phase = flowPhase(tlm);

  // Follow the device's manual setpoint unless the operator is editing.
  useEffect(() => {
    if (!dirty && tlm) setFlow(tlm.flowSet ?? tlm.flow);
  }, [tlm, dirty]);

  // Briefly marks the button as busy so a double-click doesn't send the command twice.
  const send = (cmd: string) => {
    if (!sendCommand(cmd)) return;
    setPending(cmd.split(" ")[0]);
    window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => setPending(null), 800);
  };

  const applyFlow = () => {
    send(`SET_FLOW ${flow.toFixed(1)}`);
    setDirty(false);
  };

  return (
    <Panel id="commands" title="Command Uplink" icon={<SquareTerminal className="h-3.5 w-3.5" />}>
      <div className="grid grid-cols-2 gap-3">
        <CmdButton label="START" icon={<Play className="h-4 w-4" />} tone="emerald" blocked={block.start} busy={pending === "START"} onClick={() => send("START")} />
        <CmdButton label="STOP" icon={<Square className="h-4 w-4" />} tone="amber" blocked={block.stop} busy={pending === "STOP"} onClick={() => send("STOP")} />
        <CmdButton label="RESET" icon={<RotateCcw className="h-4 w-4" />} tone="red" blocked={block.reset} busy={pending === "RESET"} onClick={() => setConfirmReset(true)} />
        <CmdButton label="REFILL" icon={<Droplets className="h-4 w-4" />} tone="cyan" blocked={block.refill} busy={pending === "REFILL"} onClick={() => send("REFILL")} />
      </div>

      <div className={`mt-5 rounded-lg border p-3 ${manual ? "border-amber-400/40 bg-amber-500/5" : "border-sky-400/10 bg-space-800/40"}`}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-sky-200/80">
            <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-300" /> Flow control
          </span>
          <span
            className={`num rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-widest ${
              manual ? "border-amber-400/60 bg-amber-500/20 text-amber-200" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
            }`}
          >
            {manual ? "MANUAL OVERRIDE" : "AUTO PROFILE"}
          </span>
        </div>

        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300/50">Actual flow</div>
            <div className="num text-2xl text-cyan-100">
              {tlm ? tlm.flow.toFixed(2) : "--"} <span className="text-xs text-sky-300/50">%/s</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300/50">Phase</div>
            <div className={`num text-sm font-semibold ${phase === "MANUAL" ? "text-amber-300" : phase === "STANDBY" ? "text-slate-400" : "text-emerald-300"}`}>
              {phase}
            </div>
          </div>
        </div>

        {!manual && <ProfileDiagram phase={phase} />}

        {manual ? (
          <button
            onClick={() => send("OVERRIDE OFF")}
            disabled={!!block.overrideOff}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-cyan-400/50 bg-cyan-500/10 py-2 text-xs font-semibold tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-35"
          >
            <Lock className="h-3.5 w-3.5" /> RETURN TO AUTO PROFILE
          </button>
        ) : (
          <button
            onClick={() => send("OVERRIDE ON")}
            disabled={!!block.overrideOn}
            title={block.overrideOn ?? "Take manual control of the flow rate"}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-amber-400/60 bg-amber-500/15 py-2 text-xs font-semibold tracking-widest text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <LockOpen className="h-3.5 w-3.5" /> MANUAL OVERRIDE
          </button>
        )}

        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-sky-300/60">Manual setpoint</span>
          <span className="num text-base text-cyan-100">
            {flow.toFixed(1)} <span className="text-xs text-sky-300/50">%/s</span>
          </span>
        </div>
        <input
          type="range"
          min={FLOW_MIN}
          max={FLOW_MAX}
          step={0.1}
          value={flow}
          disabled={!!block.flow}
          onChange={(e) => {
            setFlow(Number(e.target.value));
            setDirty(true);
          }}
          className="w-full accent-cyan-400 disabled:opacity-40"
        />
        <div className="num flex justify-between text-[10px] text-sky-300/40">
          <span>{FLOW_MIN}</span>
          <span>{manual ? `device setpoint: ${tlm?.flowSet?.toFixed(2) ?? "--"}` : "locked: override required"}</span>
          <span>{FLOW_MAX}</span>
        </div>
        <button
          disabled={!!block.flow || !dirty}
          onClick={applyFlow}
          title={block.flow ?? undefined}
          className="mt-2 w-full rounded-md border border-cyan-400/40 bg-cyan-500/10 py-1.5 text-xs font-semibold tracking-widest text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-35"
        >
          SET_FLOW {flow.toFixed(1)}
        </button>
      </div>

      {sim && (
        <div className="mt-4 rounded-lg border border-violet-400/20 bg-violet-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-violet-200/80">
            <FlaskConical className="h-3.5 w-3.5" /> Simulator injections
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void api.sim("spike")}
              className="flex items-center justify-center gap-1.5 rounded-md border border-violet-400/30 py-1.5 text-xs text-violet-100 hover:bg-violet-500/15"
            >
              <TriangleAlert className="h-3.5 w-3.5" /> Pressure spike
            </button>
            <button
              onClick={() => void api.sim("dropout")}
              className="flex items-center justify-center gap-1.5 rounded-md border border-violet-400/30 py-1.5 text-xs text-violet-100 hover:bg-violet-500/15"
            >
              <Unplug className="h-3.5 w-3.5" /> USB dropout
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Confirm fault reset"
        message={`Clear fault "${tlm?.fault ?? "UNKNOWN"}" and return the controller to IDLE? Make sure the cause has been resolved. Tank pressure is ${
          tlm ? tlm.pressure.toFixed(1) : "--"
        } kPa.`}
        confirmLabel="RESET FAULT"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          send("RESET");
        }}
      />
    </Panel>
  );
}

/** Trapezoid sketch of the AUTO profile with the active phase highlighted. */
function ProfileDiagram({ phase }: { phase: Phase }) {
  const seg = (p: Phase) => (phase === p ? "#34d399" : "#335173");
  return (
    <div className="mb-3">
      <svg viewBox="0 0 220 56" className="w-full">
        <line x1={4} y1={48} x2={216} y2={48} stroke="#1e3a5f" />
        <path d="M 8 44 L 60 12" stroke={seg("RAMP-UP")} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d="M 60 12 L 150 12" stroke={seg("CRUISE")} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d="M 150 12 Q 185 20 212 42" stroke={seg("TAPER")} strokeWidth={3} fill="none" strokeLinecap="round" />
        <text x={30} y={56} fontSize={8} fill="#7dd3fc" fillOpacity={0.6} textAnchor="middle">soft start</text>
        <text x={105} y={8} fontSize={8} fill="#7dd3fc" fillOpacity={0.6} textAnchor="middle">
          cruise {FLOW_AUTO_CRUISE} %/s
        </text>
        <text x={185} y={56} fontSize={8} fill="#7dd3fc" fillOpacity={0.6} textAnchor="middle">
          taper &lt;{FLOW_TAPER_PCT}%
        </text>
      </svg>
    </div>
  );
}

const TONES = {
  emerald: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 hover:shadow-[0_0_18px_-4px_rgba(52,211,153,0.6)]",
  amber: "border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 hover:shadow-[0_0_18px_-4px_rgba(251,191,36,0.6)]",
  red: "border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/25 hover:shadow-[0_0_18px_-4px_rgba(248,113,113,0.6)]",
  cyan: "border-cyan-400/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 hover:shadow-[0_0_18px_-4px_rgba(34,211,238,0.6)]",
};

function CmdButton({
  label,
  icon,
  tone,
  blocked,
  busy,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  tone: keyof typeof TONES;
  blocked: string | null;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!!blocked || busy}
      title={blocked ?? `Send ${label}`}
      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-3 text-sm font-semibold tracking-[0.16em] transition disabled:cursor-not-allowed disabled:border-slate-600/30 disabled:bg-slate-700/10 disabled:text-slate-500 disabled:shadow-none ${TONES[tone]}`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {busy ? "SENT…" : label}
      </span>
      <span className="h-3 text-[9px] font-normal tracking-normal text-slate-500">{blocked ?? ""}</span>
    </button>
  );
}
