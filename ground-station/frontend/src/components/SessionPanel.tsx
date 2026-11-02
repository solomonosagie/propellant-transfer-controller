import { Check, Database, Download, FileText, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtBytes, fmtDuration, fmtUtcTime } from "../lib/format";
import type { LogFile, Mission, MissionStep, Status } from "../types";
import { Panel } from "./Panel";

interface Props {
  status: Status | null;
  mission: Mission;
  now: number;
}

export function SessionPanel({ status, mission, now }: Props) {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [busy, setBusy] = useState(false);
  const logging = status?.logging;

  const refresh = useCallback(async () => {
    try {
      setFiles((await api.logs()).files.slice(0, 6));
    } catch {
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const toggleLogging = async () => {
    if (!logging) return;
    setBusy(true);
    try {
      await api.setLogging(!logging.enabled);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const elapsed = mission.startedAt ? ((mission.endedAt ?? now) - mission.startedAt) / 1000 : null;

  return (
    <Panel id="session" title="Session" icon={<Database className="h-3.5 w-3.5" />} bodyClassName="flex flex-col gap-5">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-sky-300/60">Mission timeline</span>
          <span className="num text-xs text-sky-200">T+ {elapsed === null ? "--:--:--" : fmtDuration(elapsed)}</span>
        </div>
        <Stepper steps={mission.steps} />
      </div>

      <div className="rounded-lg border border-sky-400/10 bg-space-800/40 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300/60">CSV telemetry logging</div>
            <div className={`num text-sm font-semibold ${logging?.enabled ? "text-emerald-300" : "text-slate-400"}`}>
              {logging?.enabled ? "● RECORDING" : "○ PAUSED"}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={!!logging?.enabled}
            disabled={!logging || busy}
            onClick={() => void toggleLogging()}
            className={`relative h-6 w-11 rounded-full border transition disabled:opacity-40 ${
              logging?.enabled ? "border-emerald-400/60 bg-emerald-500/30" : "border-slate-500/40 bg-slate-700/40"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${logging?.enabled ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
        </div>
        <div className="num mt-2 truncate text-xs text-sky-300/60">
          {logging?.file ? `${logging.file} · ${logging.rows} rows` : "No file yet"}
        </div>
        {logging?.file && (
          <a
            href={api.logUrl(logging.file)}
            className="mt-3 flex items-center justify-center gap-2 rounded-md border border-cyan-400/40 bg-cyan-500/10 py-1.5 text-xs font-semibold tracking-widest text-cyan-200 hover:bg-cyan-500/20"
          >
            <Download className="h-3.5 w-3.5" /> DOWNLOAD CURRENT CSV
          </a>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-sky-300/60">Recent logs</span>
          <button onClick={() => void refresh()} className="text-sky-300/60 hover:text-white" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="space-y-1">
          {files.length === 0 && <li className="text-xs text-sky-300/40">No CSV files in ./logs yet</li>}
          {files.map((f) => (
            <li key={f.name}>
              <a
                href={api.logUrl(f.name)}
                className="num flex items-center gap-2 rounded-md px-2 py-1 text-xs text-sky-200/80 hover:bg-sky-400/5 hover:text-white"
              >
                <FileText className={`h-3.5 w-3.5 ${f.active ? "text-emerald-300" : "text-sky-300/50"}`} />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-sky-300/40">{fmtBytes(f.size)}</span>
                <Download className="h-3.5 w-3.5 text-sky-300/50" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

const STEP_STYLE: Record<MissionStep["status"], { dot: string; text: string; sub: string }> = {
  pending: { dot: "border-slate-500 bg-space-900", text: "text-slate-400", sub: "Pending" },
  active: { dot: "border-cyan-300 bg-cyan-400/30 shadow-[0_0_12px_#22d3ee]", text: "text-cyan-200", sub: "In progress" },
  done: { dot: "border-emerald-300 bg-emerald-400", text: "text-emerald-200", sub: "Completed" },
  aborted: { dot: "border-amber-300 bg-amber-400", text: "text-amber-200", sub: "Aborted" },
  error: { dot: "border-red-300 bg-red-500", text: "text-red-200", sub: "Fault" },
};

function Stepper({ steps }: { steps: MissionStep[] }) {
  return (
    <ol className="flex items-start">
      {steps.map((s, i) => {
        const st = STEP_STYLE[s.status];
        const nextDone = i < steps.length - 1 && steps[i + 1].status !== "pending";
        return (
          <li key={s.key} className="relative flex flex-1 flex-col items-center text-center">
            {i < steps.length - 1 && (
              <span
                className={`absolute left-1/2 top-[9px] h-0.5 w-full ${nextDone ? "bg-gradient-to-r from-emerald-400 to-cyan-400" : "bg-slate-600/50"}`}
              />
            )}
            <span className={`relative z-10 grid h-5 w-5 place-items-center rounded-full border-2 ${st.dot}`}>
              {s.status === "done" && <Check className="h-3 w-3 text-space-950" strokeWidth={3} />}
              {s.status === "error" && <X className="h-3 w-3 text-white" strokeWidth={3} />}
            </span>
            <span className={`mt-2 text-xs font-semibold ${st.text}`}>{s.label}</span>
            <span className="text-[10px] text-sky-300/40">{st.sub}</span>
            <span className="num text-[10px] text-sky-300/50">{s.ts ? fmtUtcTime(s.ts) : "--:--:--"}</span>
          </li>
        );
      })}
    </ol>
  );
}
