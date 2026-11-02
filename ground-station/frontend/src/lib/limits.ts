// Mirrors of the firmware limits, used for gauge zones, chart bands and for
// disabling buttons ahead of time. The firmware still enforces every rule
// itself; if these drift, the UI is merely wrong about what will be accepted.
export const PRESSURE_MAX = 300;
export const PRESSURE_WARN = 220;
export const PRESSURE_FAULT = 250;
export const PRESSURE_RESET_MAX = 150;
export const FLOW_MIN = 0.1;
export const FLOW_MAX = 20;
export const FLOW_AUTO_CRUISE = 4;
export const FLOW_TAPER_PCT = 20;
export const TEMP_MIN = -20;
export const TEMP_MAX = 60;
export const TEMP_SAFE_MIN = 10;
export const TEMP_SAFE_MAX = 40;

export const THERMAL_FAULTS = ["OVERTEMP", "UNDERTEMP"];
export const isThermalFault = (fault: string | null | undefined) => !!fault && THERMAL_FAULTS.includes(fault);
export const tempInBand = (t: number | undefined) => t === undefined || (t >= TEMP_SAFE_MIN && t <= TEMP_SAFE_MAX);

export const HISTORY_MS = 60_000;
export const NO_SIGNAL_MS = 2_000;
