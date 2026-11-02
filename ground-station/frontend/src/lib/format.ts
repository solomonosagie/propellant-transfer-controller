const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

export function fmtUtcClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}`;
}

export function fmtUtcTime(ms: number, millis = false): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return millis ? `${base}.${pad(d.getUTCMilliseconds(), 3)}` : base;
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function num(v: number | undefined | null, digits = 1): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "--";
}
