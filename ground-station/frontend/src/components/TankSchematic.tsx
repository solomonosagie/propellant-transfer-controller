import { Fuel } from "lucide-react";
import { num } from "../lib/format";
import type { Telemetry } from "../types";
import { Panel } from "./Panel";

const TANK = { y: 40, w: 140, h: 200, r: 34 };
const TANK_A_X = 40;
const TANK_B_X = 460;
const PIPE_Y = 196;
const VALVE_X = 320;

interface Props {
  tlm: Telemetry | null;
}

export function TankSchematic({ tlm }: Props) {
  const valve = tlm?.valve ?? "CLOSED";
  // Rotating the disc as soon as the valve starts opening lets the 600 ms CSS
  // transition roughly match the real servo travel time.
  const openish = valve === "OPEN" || valve === "OPENING";
  const moving = valve === "OPENING" || valve === "CLOSING";
  const flowing = valve === "OPEN" && tlm?.state === "TRANSFER";

  const valveColor = moving ? "#fbbf24" : valve === "OPEN" ? "#2dd4bf" : "#64748b";

  return (
    <Panel
      id="propellant"
      title="Propellant System"
      icon={<Fuel className="h-3.5 w-3.5" />}
      right={
        <span className={`num text-xs ${flowing ? "text-emerald-300" : "text-sky-300/50"}`}>
          {flowing ? `FLOWING ${num(tlm?.flow, 2)} %/s` : "NO FLOW"}
        </span>
      }
    >
      <svg viewBox="0 0 640 290" className="h-full max-h-[320px] w-full">
        <defs>
          <linearGradient id="fuelA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0e7490" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="fuelB" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0f766e" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="fuelLow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="clipA">
            <rect x={TANK_A_X} y={TANK.y} width={TANK.w} height={TANK.h} rx={TANK.r} />
          </clipPath>
          <clipPath id="clipB">
            <rect x={TANK_B_X} y={TANK.y} width={TANK.w} height={TANK.h} rx={TANK.r} />
          </clipPath>
        </defs>

        {/* Pipe */}
        <line x1={TANK_A_X + TANK.w - 6} y1={PIPE_Y} x2={TANK_B_X + 6} y2={PIPE_Y} stroke="#1e3a5f" strokeWidth={18} strokeLinecap="round" />
        <line x1={TANK_A_X + TANK.w - 6} y1={PIPE_Y} x2={TANK_B_X + 6} y2={PIPE_Y} stroke="#081226" strokeWidth={12} />
        <line
          x1={TANK_A_X + TANK.w}
          y1={PIPE_Y}
          x2={TANK_B_X}
          y2={PIPE_Y}
          stroke={flowing ? "#22d3ee" : "#1e3a5f"}
          strokeWidth={5}
          strokeDasharray="10 6"
          className={flowing ? "flow-dash" : ""}
          filter={flowing ? "url(#glow)" : undefined}
        />
        {flowing &&
          [250, 395].map((x) => (
            <path key={x} d={`M ${x - 6} ${PIPE_Y - 22} l 10 6 l -10 6`} fill="none" stroke="#67e8f9" strokeWidth={2} opacity={0.8} />
          ))}

        <Tank x={TANK_A_X} label="TANK A" sub="SOURCE" pct={tlm?.tankA ?? 0} clip="clipA" fill={(tlm?.tankA ?? 0) < 10 ? "url(#fuelLow)" : "url(#fuelA)"} />
        <Tank x={TANK_B_X} label="TANK B" sub="RECEIVER" pct={tlm?.tankB ?? 0} clip="clipB" fill="url(#fuelB)" />

        {/* Pressure transducer on Tank A */}
        <line x1={TANK_A_X + TANK.w / 2} y1={TANK.y} x2={TANK_A_X + TANK.w / 2} y2={TANK.y - 14} stroke="#38bdf8" strokeWidth={2} />
        <circle cx={TANK_A_X + TANK.w / 2} cy={TANK.y - 20} r={8} fill="#0a1730" stroke="#38bdf8" strokeWidth={1.5} />
        <text x={TANK_A_X + TANK.w / 2} y={TANK.y - 17} textAnchor="middle" fontSize={8} fill="#7dd3fc" fontFamily="var(--font-mono)">
          PT
        </text>
        <text x={TANK_A_X + TANK.w / 2 + 16} y={TANK.y - 16} fontSize={12} fill="#bae6fd" fontFamily="var(--font-mono)">
          {num(tlm?.pressure)} kPa
        </text>

        {/* Servo actuator */}
        <line x1={VALVE_X} y1={PIPE_Y - 26} x2={VALVE_X} y2={PIPE_Y - 46} stroke="#334155" strokeWidth={4} />
        <rect x={VALVE_X - 26} y={PIPE_Y - 74} width={52} height={28} rx={5} fill="#0a1730" stroke={valveColor} strokeWidth={1.5} />
        <text x={VALVE_X} y={PIPE_Y - 56} textAnchor="middle" fontSize={10} fill="#cbd5e1" fontFamily="var(--font-mono)">
          SERVO
        </text>

        {/* Butterfly valve: disc perpendicular to pipe = closed, parallel = open */}
        <g transform={`translate(${VALVE_X} ${PIPE_Y})`}>
          {moving && (
            <circle r={32} fill="none" stroke="#fbbf24" strokeOpacity={0.5} strokeWidth={2}>
              <animate attributeName="r" values="26;36;26" dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.7;0;0.7" dur="0.8s" repeatCount="indefinite" />
            </circle>
          )}
          <circle r={25} fill="#071124" stroke={valveColor} strokeWidth={3} filter="url(#glow)" />
          <g style={{ transform: `rotate(${openish ? 90 : 0}deg)`, transition: "transform 600ms linear" }}>
            <rect x={-4} y={-19} width={8} height={38} rx={4} fill={valveColor} />
            <circle r={4} fill="#0a1730" stroke={valveColor} strokeWidth={2} />
          </g>
        </g>
        <text x={VALVE_X} y={PIPE_Y + 48} textAnchor="middle" fontSize={13} fontWeight={700} fill={valveColor} fontFamily="var(--font-mono)" letterSpacing={2}>
          VALVE {valve}
        </text>
        <text x={VALVE_X} y={PIPE_Y + 66} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="var(--font-mono)">
          SERVO D8 · 600 ms TRAVEL
        </text>
      </svg>
    </Panel>
  );
}

function Tank({ x, label, sub, pct, clip, fill }: { x: number; label: string; sub: string; pct: number; clip: string; fill: string }) {
  // The fuel is a full-height rect scaled from the bottom, so CSS can animate the
  // level smoothly between 5 Hz updates. The clip path keeps it inside the rounded tank.
  const level = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <g>
      <text x={x + TANK.w / 2} y={TANK.y + TANK.h + 22} textAnchor="middle" fontSize={13} fontWeight={700} fill="#e0f2fe" letterSpacing={3}>
        {label}
      </text>
      <text x={x + TANK.w / 2} y={TANK.y + TANK.h + 38} textAnchor="middle" fontSize={9} fill="#64748b" letterSpacing={3}>
        {sub}
      </text>

      <rect x={x} y={TANK.y} width={TANK.w} height={TANK.h} rx={TANK.r} fill="#06101f" />
      <g clipPath={`url(#${clip})`}>
        <rect
          x={x}
          y={TANK.y}
          width={TANK.w}
          height={TANK.h}
          fill={fill}
          style={{
            transform: `scaleY(${level})`,
            transformOrigin: "bottom",
            transformBox: "fill-box",
            transition: "transform 300ms linear",
          }}
        />
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={x} x2={x + 16} y1={TANK.y + TANK.h * (1 - f)} y2={TANK.y + TANK.h * (1 - f)} stroke="#e0f2fe" strokeOpacity={0.35} />
            <text x={x + 20} y={TANK.y + TANK.h * (1 - f) + 3} fontSize={8} fill="#e0f2fe" fillOpacity={0.45} fontFamily="var(--font-mono)">
              {f * 100}
            </text>
          </g>
        ))}
      </g>
      <rect x={x} y={TANK.y} width={TANK.w} height={TANK.h} rx={TANK.r} fill="url(#glass)" stroke="#38bdf8" strokeOpacity={0.45} strokeWidth={2} />
      <text
        x={x + TANK.w / 2}
        y={TANK.y + TANK.h / 2 + 8}
        textAnchor="middle"
        fontSize={26}
        fontWeight={700}
        fill="#ffffff"
        fontFamily="var(--font-mono)"
        style={{ paintOrder: "stroke", stroke: "#030814", strokeWidth: 4 }}
      >
        {pct.toFixed(1)}%
      </text>
    </g>
  );
}
