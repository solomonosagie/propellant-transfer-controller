import { Activity, Fuel, Gauge, LayoutDashboard, Orbit, ScrollText, SquareTerminal, Database, Thermometer } from "lucide-react";
import { useState } from "react";
import type { Hello, Status } from "../types";

const NAV = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "propellant", label: "Propellant", icon: Fuel },
  { id: "pressure", label: "Pressure", icon: Gauge },
  { id: "commands", label: "Commands", icon: SquareTerminal },
  { id: "telemetry", label: "Telemetry", icon: Activity },
  { id: "session", label: "Session", icon: Database },
  { id: "thermal", label: "Thermal", icon: Thermometer },
  { id: "events", label: "Events", icon: ScrollText },
];

interface Props {
  wsOpen: boolean;
  linkUp: boolean;
  status: Status | null;
  hello: Hello | null;
  faultCount: number;
}

export function Sidebar({ wsOpen, linkUp, status, hello, faultCount }: Props) {
  const [active, setActive] = useState("overview");

  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sky-400/10 bg-space-900/80 lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-full border border-cyan-300/40 bg-cyan-400/10 shadow-[0_0_18px_-4px_rgba(34,211,238,0.7)]">
          <Orbit className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <div className="text-lg font-semibold tracking-wide text-white">PropTrack</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/60">Ground Operations</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
              active === id
                ? "bg-gradient-to-r from-cyan-500/25 to-cyan-500/5 text-white shadow-[inset_2px_0_0_#22d3ee]"
                : "text-sky-200/70 hover:bg-sky-400/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {id === "events" && faultCount > 0 && (
              <span className="num rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{faultCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-3 p-4 text-xs">
        <div className="rounded-lg border border-sky-400/10 bg-space-800/60 p-3">
          <Row ok={wsOpen} label="Ground backend" value={wsOpen ? "Online" : "Offline"} />
          <Row ok={linkUp} label="Device link" value={linkUp ? "Connected" : "Down"} />
        </div>
        <div className="rounded-lg border border-sky-400/10 bg-space-800/60 p-3 text-sky-300/70">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-sky-300/50">Ground station</div>
          <div className="num text-sky-100">{status?.link.port ?? "--"}</div>
          <div className="num">{status?.mode === "sim" ? "Simulation mode" : "USB serial · 115200"}</div>
          <div className="num mt-1">
            FW {hello?.fw ?? "?"} {hello?.version ?? ""}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400 text-emerald-400 pulse-dot" : "bg-red-500"}`} />
      <span className="text-sky-300/70">{label}</span>
      <span className={`ml-auto ${ok ? "text-emerald-300" : "text-red-300"}`}>{value}</span>
    </div>
  );
}
