import { Eye, SignalZero } from "lucide-react";
import { useEffect, useState } from "react";
import type { Status } from "../types";

interface Props {
  active: boolean;
  wsOpen: boolean;
  linkUp: boolean;
  status: Status | null;
  lastTlm: number | null;
  now: number;
}

export function NoSignalOverlay({ active, wsOpen, linkUp, status, lastTlm, now }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Re-arm the overlay whenever the signal comes back.
  useEffect(() => {
    if (!active) setDismissed(false);
  }, [active]);

  if (!active || dismissed) return null;

  const reason = !wsOpen
    ? "Ground station backend unreachable. Is `python main.py` running?"
    : !linkUp
      ? `Device link down${status?.link.error ? `: ${status.link.error}` : ""}. Waiting for USB…`
      : lastTlm
        ? `No telemetry for ${((now - lastTlm) / 1000).toFixed(1)} s`
        : "Waiting for first telemetry frame…";

  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-hidden bg-space-950/75 backdrop-blur-[3px]">
      <div className="pointer-events-none absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-red-500/5 to-transparent scanline" />
      <div className="panel flex flex-col items-center gap-3 border-red-500/40 px-12 py-8 text-center">
        <SignalZero className="h-12 w-12 animate-pulse text-red-400" />
        <div className="num text-5xl font-bold tracking-[0.3em] text-red-400 drop-shadow-[0_0_14px_rgba(248,113,113,0.6)]">
          NO SIGNAL
        </div>
        <div className="max-w-md text-sm text-sky-200/80">{reason}</div>
        <div className="text-xs text-sky-300/50">Select a port in the top bar if auto-detect can't find the Pro Micro.</div>
        <button
          onClick={() => setDismissed(true)}
          className="mt-2 flex items-center gap-2 rounded-md border border-sky-400/30 px-3 py-1.5 text-xs text-sky-200 hover:border-sky-400/60"
        >
          <Eye className="h-3.5 w-3.5" /> Show last known data
        </button>
      </div>
    </div>
  );
}
