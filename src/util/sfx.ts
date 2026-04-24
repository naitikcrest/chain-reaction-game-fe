let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function beep(freq: number, durationMs: number, type: OscillatorType, gain: number) {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000);
}

export function playPlace() {
  // subtle click
  beep(420, 50, "square", 0.02);
}

export function playExplosion() {
  // small descending zap
  beep(180, 110, "sawtooth", 0.028);
  beep(120, 120, "triangle", 0.02);
}

export function playTurnCue() {
  // short bright cue (kept subtle)
  beep(660, 70, "triangle", 0.02);
  beep(880, 90, "sine", 0.018);
}

