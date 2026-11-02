import type { ReactNode } from "react";

interface PanelProps {
  id?: string;
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({ id, title, icon, right, className = "", bodyClassName = "", children }: PanelProps) {
  return (
    <section id={id} className={`panel flex min-w-0 flex-col scroll-mt-4 ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-sky-400/10 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200/80">
          {icon && <span className="text-cyan-300">{icon}</span>}
          {title}
        </h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, unit, tone = "text-sky-50" }: { label: string; value: ReactNode; unit?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.16em] text-sky-300/50">{label}</div>
      <div className={`num truncate text-lg font-medium ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-xs text-sky-300/50">{unit}</span>}
      </div>
    </div>
  );
}
