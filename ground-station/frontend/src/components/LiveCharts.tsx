import { Activity } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HISTORY_MS, PRESSURE_FAULT, PRESSURE_MAX, PRESSURE_WARN } from "../lib/limits";
import { fmtUtcTime } from "../lib/format";
import type { Sample } from "../types";
import { Panel } from "./Panel";

interface Props {
  history: Sample[];
  now: number;
}

const AXIS = { stroke: "#335173", fontSize: 10, fontFamily: "var(--font-mono)" };
const TOOLTIP = {
  contentStyle: {
    background: "rgba(6,15,34,0.95)",
    border: "1px solid rgba(56,189,248,0.3)",
    borderRadius: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  },
  labelStyle: { color: "#7dd3fc" },
  labelFormatter: (v: unknown) => `${fmtUtcTime(Number(v), true)} UTC`,
};

export function LiveCharts({ history, now }: Props) {
  // The x domain is pinned to the wall clock, not the data, so the traces keep
  // scrolling (and visibly flatline) when telemetry stops.
  const domain: [number, number] = [now - HISTORY_MS, now];
  const ticks = Array.from({ length: 7 }, (_, i) => now - HISTORY_MS + i * 10_000);
  const xAxis = (
    <XAxis
      dataKey="x"
      type="number"
      domain={domain}
      ticks={ticks}
      allowDataOverflow
      tick={AXIS}
      stroke="#1e3a5f"
      tickFormatter={(v: number) => {
        const s = Math.round((now - v) / 1000);
        return s === 0 ? "now" : `-${s}s`;
      }}
    />
  );

  return (
    <Panel id="telemetry" title="Live Telemetry · 60 s" icon={<Activity className="h-3.5 w-3.5" />}>
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <ChartTitle label="Tank A pressure" unit="kPa" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="pFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#13294a" strokeDasharray="3 4" />
                <ReferenceArea y1={PRESSURE_WARN} y2={PRESSURE_FAULT} fill="#f59e0b" fillOpacity={0.07} />
                <ReferenceArea y1={PRESSURE_FAULT} y2={PRESSURE_MAX} fill="#ef4444" fillOpacity={0.08} />
                <ReferenceLine y={PRESSURE_WARN} stroke="#f59e0b" strokeDasharray="4 4" />
                <ReferenceLine y={PRESSURE_FAULT} stroke="#ef4444" strokeDasharray="4 4" />
                {xAxis}
                <YAxis domain={[0, PRESSURE_MAX]} ticks={[0, 50, 100, 150, 200, 250, 300]} tick={AXIS} stroke="#1e3a5f" />
                <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v).toFixed(1)} kPa`, "Pressure"]} />
                <Area
                  type="monotone"
                  dataKey="pressure"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#pFill)"
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <ChartTitle label="Tank levels & flow" unit="% · %/s" legend />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="#13294a" strokeDasharray="3 4" />
                {xAxis}
                {/* Levels are 0-100 % and flow is a few %/s, so flow gets its own right-hand axis. */}
                <YAxis yAxisId="pct" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} stroke="#1e3a5f" />
                <YAxis
                  yAxisId="flow"
                  orientation="right"
                  domain={[0, (max: number) => Math.max(5, Math.ceil(max))]}
                  tick={AXIS}
                  stroke="#1e3a5f"
                  width={30}
                />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(v, name) =>
                    name === "flow"
                      ? [`${Number(v).toFixed(2)} %/s`, "Flow"]
                      : [`${Number(v).toFixed(1)} %`, name === "tankA" ? "Tank A" : "Tank B"]
                  }
                />
                <Line yAxisId="pct" type="monotone" dataKey="tankA" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="pct" type="monotone" dataKey="tankB" stroke="#2dd4bf" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="flow" type="monotone" dataKey="flow" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ChartTitle({ label, unit, legend }: { label: string; unit: string; legend?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="text-sky-200/80">
        {label} <span className="text-sky-300/40">({unit})</span>
      </span>
      {legend && (
        <span className="num flex gap-3 text-[11px]">
          <span className="text-sky-400">● Tank A</span>
          <span className="text-teal-300">● Tank B</span>
          <span className="text-amber-300">┄ Flow</span>
        </span>
      )}
    </div>
  );
}
