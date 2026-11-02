import { ArrowDownToLine, ScrollText, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUtcTime } from "../lib/format";
import type { LogEntry, LogLevel } from "../types";
import { Panel } from "./Panel";

const LEVELS: LogLevel[] = ["INFO", "WARN", "FAULT", "CMD", "SYS"];

const LEVEL_STYLE: Record<LogLevel, string> = {
  INFO: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  WARN: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  FAULT: "border-red-400/60 bg-red-500/20 text-red-200",
  CMD: "border-violet-400/50 bg-violet-500/15 text-violet-200",
  SYS: "border-teal-400/40 bg-teal-500/10 text-teal-200",
};

const MSG_STYLE: Record<LogLevel, string> = {
  INFO: "text-sky-100/90",
  WARN: "text-amber-100",
  FAULT: "text-red-200 font-semibold",
  CMD: "text-violet-100",
  SYS: "text-teal-100/90",
};

export function EventLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  const [enabled, setEnabled] = useState<Set<LogLevel>>(() => new Set(LEVELS));
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return log.filter((e) => enabled.has(e.level) && (!q || e.msg.toLowerCase().includes(q)));
  }, [log, enabled, query]);

  useEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [visible, follow]);

  const toggle = (lvl: LogLevel) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of log) c[e.level] = (c[e.level] ?? 0) + 1;
    return c;
  }, [log]);

  return (
    <Panel
      id="events"
      title="Event Log"
      icon={<ScrollText className="h-3.5 w-3.5" />}
      right={<span className="num text-xs text-sky-300/50">{visible.length} / {log.length}</span>}
      bodyClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => toggle(lvl)}
            className={`num rounded-md border px-2 py-1 text-[11px] font-semibold tracking-wider transition ${
              enabled.has(lvl) ? LEVEL_STYLE[lvl] : "border-slate-600/30 text-slate-500 line-through"
            }`}
          >
            {lvl} <span className="opacity-60">{counts[lvl] ?? 0}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sky-300/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter messages…"
            className="w-48 rounded-md border border-sky-400/20 bg-space-800 py-1 pl-7 pr-2 text-xs text-sky-100 outline-none placeholder:text-sky-300/30 focus:border-cyan-400/60"
          />
        </div>
        <button
          onClick={() => setFollow((f) => !f)}
          title="Auto-scroll to newest"
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
            follow ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200" : "border-sky-400/20 text-sky-300/60"
          }`}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" /> Follow
        </button>
        <button
          onClick={onClear}
          title="Clear log view"
          className="flex items-center gap-1 rounded-md border border-sky-400/20 px-2 py-1 text-[11px] text-sky-300/70 hover:text-white"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      <div
        ref={scroller}
        onWheel={() => {
          const el = scroller.current;
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false);
        }}
        className="scroll-thin num h-72 overflow-y-auto rounded-lg border border-sky-400/10 bg-space-950/60 text-xs"
      >
        {visible.length === 0 ? (
          <div className="grid h-full place-items-center text-sky-300/40">No events</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-b border-sky-400/5 hover:bg-sky-400/5">
                  <td className="whitespace-nowrap px-3 py-1.5 align-top text-sky-300/50">{fmtUtcTime(e.ts, true)}</td>
                  <td className="px-1 py-1.5 align-top">
                    <span className={`inline-block w-14 rounded border px-1 text-center text-[10px] font-bold ${LEVEL_STYLE[e.level]}`}>
                      {e.level}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top text-[10px] text-sky-300/40">{e.source}</td>
                  <td className={`w-full break-all px-2 py-1.5 ${MSG_STYLE[e.level]}`}>{e.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
