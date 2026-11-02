import { BellOff, BellRing, Volume2, VolumeX } from "lucide-react";
import type { FaultAlarm } from "../hooks/useFaultAlarm";

export function AlarmControl({ alarm }: { alarm: FaultAlarm }) {
  return (
    <div className="flex items-center gap-2">
      {alarm.sounding && (
        <div className={`${alarm.kind === "thermal" ? "thermal-flash" : "fault-flash"} flex items-center gap-2 rounded-md border px-2.5 py-1`}>
          <BellRing className="h-4 w-4 animate-pulse text-red-200" />
          <span className="num text-xs font-bold tracking-widest text-red-100">
            {alarm.blocked ? "CLICK TO ENABLE SOUND" : alarm.kind === "thermal" ? "THERMAL ALARM" : "FAULT ALARM"}
          </span>
          <button
            onClick={alarm.silence}
            className="rounded border border-red-300/60 bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-50 hover:bg-red-500/40"
            title="Silence until the next fault"
          >
            SILENCE
          </button>
        </div>
      )}
      {!alarm.sounding && alarm.silenced && (
        <span className="flex items-center gap-1 text-xs text-amber-300">
          <BellOff className="h-3.5 w-3.5" /> Alarm silenced
        </span>
      )}
      <button
        onClick={alarm.toggleEnabled}
        title={alarm.enabled ? "Fault alarm sound ON (click to mute)" : "Fault alarm sound MUTED (click to enable)"}
        className={`rounded-md border p-1.5 ${
          alarm.enabled ? "border-sky-400/20 text-sky-300 hover:text-white" : "border-amber-400/40 text-amber-300"
        }`}
      >
        {alarm.enabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
