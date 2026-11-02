import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "propxfer.alarm.enabled";

/** "general" = hi-lo two-tone (pressure, link loss); "thermal" = rapid rising chirps. */
export type AlarmKind = "general" | "thermal";

const PATTERN_MS: Record<AlarmKind, number> = { general: 1200, thermal: 1000 };

/**
 * Plays a repeating alarm through the laptop speakers while `kind` is set.
 * Tones are synthesized with the Web Audio API, so there are no sound files to
 * ship and it works offline. Thermal faults get a distinct pattern, so the
 * operator can tell what went wrong without looking at the screen.
 */
export function useFaultAlarm(kind: AlarmKind | null) {
  const active = kind !== null;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) !== "0");
  const [silenced, setSilenced] = useState(false); // operator silenced this fault episode
  const [blocked, setBlocked] = useState(false); // browser autoplay policy needs a click first
  const ctxRef = useRef<AudioContext | null>(null);

  const ctx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  // Browsers only allow audio after a user gesture: unlock on the first click/key.
  useEffect(() => {
    const unlock = () => {
      void ctx().resume().then(() => setBlocked(false));
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ctx]);

  // A new fault re-arms the alarm.
  useEffect(() => {
    if (!active) setSilenced(false);
  }, [active]);

  const sounding = active && enabled && !silenced;
  const playing = sounding ? kind : null;

  useEffect(() => {
    if (!playing) return;
    const ac = ctx();
    if (ac.state !== "running") {
      setBlocked(true);
      void ac.resume().then(() => setBlocked(ac.state !== "running"));
    }

    const tone = (type: OscillatorType, f0: number, f1: number, start: number, dur: number, level: number) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, start);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(level, start + 0.015);
      gain.gain.setValueAtTime(level, start + dur - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };

    const play = () => {
      if (ac.state !== "running") return;
      const t = ac.currentTime + 0.02;
      if (playing === "thermal") {
        for (let i = 0; i < 3; i++) tone("sawtooth", 700, 1500, t + i * 0.2, 0.15, 0.12);
      } else {
        tone("square", 960, 960, t, 0.38, 0.18);
        tone("square", 640, 640, t + 0.45, 0.38, 0.18);
      }
    };

    play();
    const id = window.setInterval(play, PATTERN_MS[playing]);
    return () => window.clearInterval(id);
  }, [playing, ctx]);

  const toggleEnabled = useCallback(() => {
    setEnabled((e) => {
      localStorage.setItem(STORAGE_KEY, e ? "0" : "1");
      return !e;
    });
  }, []);

  return {
    kind,
    sounding,
    enabled,
    silenced,
    blocked: sounding && blocked,
    toggleEnabled,
    silence: () => setSilenced(true),
  };
}

export type FaultAlarm = ReturnType<typeof useFaultAlarm>;
