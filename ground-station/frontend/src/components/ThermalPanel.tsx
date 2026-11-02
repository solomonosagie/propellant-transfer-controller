import { ArrowDown, ArrowUp, Thermometer } from "lucide-react";
import { Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { HISTORY_MS, TEMP_MAX, TEMP_MIN, TEMP_SAFE_MAX, TEMP_SAFE_MIN } from "../lib/limits";
import type { Sample, Telemetry } from "../types";
import { Panel } from "./Panel";

const STEP = 10;
const TUBE_TOP = 20;
const TUBE_BOTTOM = 200;
const yFor = (t: number) =>
  TUBE_BOTTOM - ((Math.max(TEMP_MIN, Math.min(TEMP_MAX, t)) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * (TUBE_BOTTOM - TUBE_TOP);

interface Props {
  tlm: Telemetry | null;
  history: Sample[];
  now: number;
  sim: boolean;
}

export function ThermalPanel({ tlm, history, now, sim }: Props) {
  const temp = tlm?.temp;
  const has = typeof temp === "number";
  const zone = !has ? "none" : temp < TEMP_SAFE_MIN ? "cold" : temp > TEMP_SAFE_MAX ? "hot" : "ok";
  const color = zone === "cold" ? "#60a5fa" : zone === "hot" ? "#fb923c" : "#2dd4bf";
  const label =
    zone === "cold" ? "UNDERTEMP FAULT · FREEZE RISK" : zone === "hot" ? "OVERTEMP FAULT" : zone === "ok" ? "NOMINAL" : "NO DATA";
  const up = tlm?.tempDir !== "DOWN";

  return (
    <Panel
      id="thermal"
      title="Tank Thermal · D4 Button"
      icon={<Thermometer className="h-3.5 w-3.5" />}
      right={
        sim ? (
          <button
            onClick={() => void api.sim("button")}
            className="rounded-md border border-violet-400/30 px-2 py-0.5 text-[11px] text-violet-100 hover:bg-violet-500/15"
          >
            Press D4 (sim)
          </button>
        ) : undefined
      }
    >
      <div className="flex gap-4">
        <svg viewBox="0 0 150 250" className="h-64 w-32 shrink-0">
          {/* Safe band marker */}
          <rect x={34} y={yFor(TEMP_SAFE_MAX)} width={8} height={yFor(TEMP_SAFE_MIN) - yFor(TEMP_SAFE_MAX)} rx={3} fill="#10b981" opacity={0.7} />
          <rect x={34} y={yFor(TEMP_MAX)} width={8} height={yFor(TEMP_SAFE_MAX) - yFor(TEMP_MAX)} rx={3} fill="#f97316" opacity={0.45} />
          <rect x={34} y={yFor(TEMP_SAFE_MIN)} width={8} height={yFor(TEMP_MIN) - yFor(TEMP_SAFE_MIN)} rx={3} fill="#3b82f6" opacity={0.45} />

          {/* Tube + bulb */}
          <rect x={52} y={TUBE_TOP - 10} width={26} height={TUBE_BOTTOM - TUBE_TOP + 20} rx={13} fill="#06101f" stroke="#38bdf8" strokeOpacity={0.45} strokeWidth={2} />
          <circle cx={65} cy={222} r={22} fill="#06101f" stroke="#38bdf8" strokeOpacity={0.45} strokeWidth={2} />
          {has && (
            <>
              <rect
                x={58}
                y={yFor(temp)}
                width={14}
                height={TUBE_BOTTOM + 14 - yFor(temp)}
                rx={7}
                fill={color}
                style={{ transition: "y 400ms ease, height 400ms ease, fill 400ms" }}
              />
              <circle cx={65} cy={222} r={16} fill={color} style={{ transition: "fill 400ms" }} />
            </>
          )}

          {Array.from({ length: (TEMP_MAX - TEMP_MIN) / STEP + 1 }, (_, i) => TEMP_MIN + i * STEP).map((t) => (
            <g key={t}>
              <line x1={80} x2={88} y1={yFor(t)} y2={yFor(t)} stroke="#7dd3fc" strokeOpacity={0.6} />
              <text x={92} y={yFor(t) + 3} fontSize={10} fill="#7dd3fc" fillOpacity={t === temp ? 1 : 0.6} fontWeight={t === temp ? 700 : 400} fontFamily="var(--font-mono)">
                {t}°
              </text>
            </g>
          ))}
        </svg>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300/50">Tank temperature</div>
            <div className="num text-4xl font-bold" style={{ color }}>
              {has ? temp : "--"}
              <span className="ml-1 text-base text-sky-300/50">°C</span>
            </div>
            <div className="num text-xs font-semibold tracking-widest" style={{ color }}>
              {label}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-sky-400/10 bg-space-800/40 p-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300/50">Next press</div>
              <div className={`num flex items-center gap-1 text-sm ${up ? "text-orange-300" : "text-sky-300"}`}>
                {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                {has ? `${up ? "+" : "−"}${STEP} °C` : "--"}
              </div>
            </div>
            <div className="rounded-md border border-sky-400/10 bg-space-800/40 p-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300/50">Safe band</div>
              <div className="num text-sm text-emerald-300">
                {TEMP_SAFE_MIN}…{TEMP_SAFE_MAX} °C
              </div>
            </div>
          </div>
          <div className="num text-[10px] text-sky-300/40">
            Range {TEMP_MIN}…{TEMP_MAX} °C · reverses at the limits
          </div>

          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="x" type="number" domain={[now - HISTORY_MS, now]} hide allowDataOverflow />
                <YAxis domain={[TEMP_MIN, TEMP_MAX]} hide />
                <ReferenceArea y1={TEMP_SAFE_MIN} y2={TEMP_SAFE_MAX} fill="#10b981" fillOpacity={0.08} />
                <Line type="stepAfter" dataKey="temp" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      {!has && tlm && (
        <div className="mt-2 text-xs text-amber-300/80">Device firmware doesn't report temperature. Upload firmware v1.1.0.</div>
      )}
    </Panel>
  );
}
