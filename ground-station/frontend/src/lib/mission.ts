import type { DeviceState, Mission, MissionStep, StepStatus } from "../types";

// Mission timeline shown in the Session panel:
//   Standby -> Valve Open -> Transfer -> Complete
// State changes move it forward. Events cover the cases the state alone can't
// tell apart: a CLOSING -> IDLE transition can be a completed transfer or an
// operator abort, and a fault is announced before the valve has finished closing.

export function initialMission(): Mission {
  return {
    steps: [
      { key: "standby", label: "Standby", status: "active" },
      { key: "valve", label: "Valve Open", status: "pending" },
      { key: "transfer", label: "Transfer", status: "pending" },
      { key: "complete", label: "Complete", status: "pending" },
    ],
  };
}

function setStep(m: Mission, key: MissionStep["key"], status: StepStatus, ts?: number): Mission {
  return {
    ...m,
    steps: m.steps.map((s) => (s.key === key ? { ...s, status, ts: ts ?? s.ts } : s)),
  };
}

function markActive(m: Mission, status: StepStatus, ts: number): Mission {
  return { ...m, endedAt: ts, steps: m.steps.map((s) => (s.status === "active" ? { ...s, status, ts } : s)) };
}

export function missionOnState(m: Mission, prev: DeviceState | null, next: DeviceState, ts: number): Mission {
  if (prev === next) return m;
  switch (next) {
    case "OPENING": {
      let r = initialMission();
      r = setStep(r, "standby", "done", ts);
      r = setStep(r, "valve", "active", ts);
      return { ...r, startedAt: ts };
    }
    case "TRANSFER":
      return setStep(setStep(m, "valve", "done", ts), "transfer", "active", ts);
    case "FAULT":
      return markActive(m, "error", ts);
    case "IDLE":
      if (prev === "FAULT") return initialMission();
      return m;
    default:
      return m;
  }
}

export function missionOnEvent(m: Mission, msg: string, ts: number): Mission {
  switch (msg) {
    case "TRANSFER_COMPLETE":
      return { ...setStep(setStep(m, "transfer", "done"), "complete", "done", ts), endedAt: ts };
    case "TRANSFER_STOPPED":
      return markActive(m, "aborted", ts);
    case "OVERPRESSURE":
    case "OVERTEMP":
    case "UNDERTEMP":
    case "LINK_LOSS":
      return markActive(m, "error", ts);
    case "TANKS_REFILLED":
      return initialMission();
    default:
      return m;
  }
}
