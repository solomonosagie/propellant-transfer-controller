import type { LogFile, Mode, SerialPortInfo } from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  ports: () => request<{ mode: Mode; ports: SerialPortInfo[]; requested: string | null }>("/api/ports"),
  setPort: (port: string | null) => request("/api/port", { method: "POST", body: JSON.stringify({ port }) }),
  setLogging: (enabled: boolean) => request("/api/logging", { method: "POST", body: JSON.stringify({ enabled }) }),
  logs: () => request<{ files: LogFile[] }>("/api/logs"),
  logUrl: (name: string) => `/api/logs/${encodeURIComponent(name)}`,
  sim: (action: "spike" | "dropout" | "button") => request(`/api/sim/${action}`, { method: "POST" }),
};

// Same host as the page: in production FastAPI serves both, and in development
// the Vite dev server proxies /ws through to the backend.
export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}
