import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-space-950/70 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="panel w-[min(440px,92vw)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <TriangleAlert className="h-6 w-6 text-red-300" />
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-sky-200/80">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-sky-400/20 px-4 py-2 text-sm text-sky-200 hover:border-sky-400/50"
            autoFocus
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md border border-red-400/60 bg-red-500/20 px-4 py-2 text-sm font-semibold tracking-wider text-red-100 hover:bg-red-500/35"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
