import { CircleCheck, CircleX, X } from "lucide-react";
import type { Toast } from "../types";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-xl backdrop-blur ${
            t.ok ? "border-emerald-400/50 bg-emerald-950/80" : "border-red-400/60 bg-red-950/85"
          }`}
        >
          {t.ok ? <CircleCheck className="mt-0.5 h-5 w-5 text-emerald-300" /> : <CircleX className="mt-0.5 h-5 w-5 text-red-300" />}
          <div className="min-w-0 flex-1">
            <div className={`num text-sm font-bold tracking-wider ${t.ok ? "text-emerald-100" : "text-red-100"}`}>{t.title}</div>
            <div className="num text-xs text-sky-100/70">{t.detail}</div>
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-sky-200/50 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
