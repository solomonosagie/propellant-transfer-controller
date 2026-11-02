import { Gauge } from "lucide-react";
import { PRESSURE_FAULT, PRESSURE_MAX, PRESSURE_WARN } from "../lib/limits";
import { num } from "../lib/format";
import { Panel } from "./Panel";

const CX = 130;
const CY = 125;
const R = 95;
// 270 degree dial starting at the lower left. Angles are in SVG coordinates
// (y points down), so they run clockwise from the +x axis.
const START = 135;
const SWEEP = 270;

const angleFor = (v: number) => START + (SWEEP * Math.max(0, Math.min(PRESSURE_MAX, v))) / PRESSURE_MAX;

function point(angle: number, r = R) {
  const a = (angle * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

function arc(from: number, to: number, r = R) {
  const a1 = angleFor(from);
  const a2 = angleFor(to);
  const p1 = point(a1, r);
  const p2 = point(a2, r);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
}

export function PressureGauge({ pressure }: { pressure: number | null }) {
  const p = pressure ?? 0;
  const zone = p >= PRESSURE_FAULT ? "FAULT" : p >= PRESSURE_WARN ? "WARN" : "NOMINAL";
  const color = zone === "FAULT" ? "#f87171" : zone === "WARN" ? "#fbbf24" : "#22d3ee";
  const needle = angleFor(p);
  const tip = point(needle, R - 18);

  return (
    <Panel id="pressure" title="Tank A Pressure" icon={<Gauge className="h-3.5 w-3.5" />}>
      <svg viewBox="0 0 260 240" className="mx-auto h-full max-h-[300px] w-full">
        <defs>
          <filter id="gaugeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path d={arc(0, PRESSURE_MAX)} fill="none" stroke="#0f2142" strokeWidth={16} strokeLinecap="round" />
        <path d={arc(PRESSURE_WARN, PRESSURE_FAULT)} fill="none" stroke="#f59e0b" strokeOpacity={0.35} strokeWidth={16} />
        <path d={arc(PRESSURE_FAULT, PRESSURE_MAX)} fill="none" stroke="#ef4444" strokeOpacity={0.4} strokeWidth={16} />
        {pressure !== null && p > 0.5 && (
          <path d={arc(0, p)} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" filter="url(#gaugeGlow)" />
        )}

        {Array.from({ length: PRESSURE_MAX / 25 + 1 }, (_, i) => i * 25).map((v) => {
          const a = angleFor(v);
          const major = v % 50 === 0;
          const o = point(a, R - 12);
          const iP = point(a, R - (major ? 22 : 17));
          const l = point(a, R - 34);
          return (
            <g key={v}>
              <line x1={o.x} y1={o.y} x2={iP.x} y2={iP.y} stroke="#7dd3fc" strokeOpacity={major ? 0.8 : 0.35} strokeWidth={major ? 2 : 1} />
              {major && (
                <text x={l.x} y={l.y + 3} textAnchor="middle" fontSize={9} fill="#7dd3fc" fillOpacity={0.7} fontFamily="var(--font-mono)">
                  {v}
                </text>
              )}
            </g>
          );
        })}

        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={3} strokeLinecap="round" filter="url(#gaugeGlow)" style={{ transition: "all 200ms linear" }} />
        <circle cx={CX} cy={CY} r={7} fill="#0a1730" stroke={color} strokeWidth={2} />

        <text x={CX} y={CY + 50} textAnchor="middle" fontSize={30} fontWeight={700} fill="#f0f9ff" fontFamily="var(--font-mono)">
          {num(pressure)}
        </text>
        <text x={CX} y={CY + 66} textAnchor="middle" fontSize={11} fill="#7dd3fc" fillOpacity={0.7} letterSpacing={2}>
          kPa
        </text>
        <text x={CX} y={CY + 92} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} letterSpacing={3} fontFamily="var(--font-mono)">
          {pressure === null ? "NO DATA" : zone === "FAULT" ? "OVERPRESSURE" : zone === "WARN" ? "WARNING" : "NOMINAL"}
        </text>
      </svg>
      <div className="num mt-1 flex justify-center gap-4 text-[11px]">
        <span className="text-amber-300">■ WARN ≥ {PRESSURE_WARN}</span>
        <span className="text-red-300">■ FAULT ≥ {PRESSURE_FAULT}</span>
      </div>
    </Panel>
  );
}
