/**
 * A tiny bus carrying the current audio level (0..1) to the orb, without React re-renders.
 * Sources: the real microphone (AnalyserNode), OpenAI TTS audio (AnalyserNode),
 * or a simulated rhythm (browser speechSynthesis, or when mic access fails).
 */

type Listener = (level: number) => void;

const listeners = new Set<Listener>();
let level = 0;

export function setLevel(v: number): void {
  level = Math.max(0, Math.min(1, v));
  listeners.forEach((l) => l(level));
}

export function subscribeLevel(l: Listener): () => void {
  listeners.add(l);
  l(level);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------------------
// Shared AudioContext

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Reads an analyser every frame and publishes an RMS level. Returns a stop function. */
export function driveFromAnalyser(analyser: AnalyserNode, gain = 3.2): () => void {
  const buf = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let smooth = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    smooth = smooth * 0.6 + Math.min(1, rms * gain) * 0.4;
    setLevel(smooth);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    setLevel(0);
  };
}

/** A simulated speech-like rhythm. Returns a stop function. */
export function simulateLevel(intensity = 0.7): () => void {
  let t = 0;
  const id = window.setInterval(() => {
    t += 1;
    const syllable = Math.abs(Math.sin(t * 0.9)) * 0.6 + Math.random() * 0.4;
    setLevel(syllable * intensity);
  }, 90);
  return () => {
    window.clearInterval(id);
    setLevel(0);
  };
}

// ---------------------------------------------------------------------------
// Microphone level while listening

let micStream: MediaStream | null = null;
let micStop: (() => void) | null = null;
let micGen = 0;

export async function startMicLevel(): Promise<void> {
  stopMicLevel();
  const gen = micGen;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no getUserMedia');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (gen !== micGen) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const ac = audioContext();
    if (!ac) throw new Error('no AudioContext');
    micStream = stream;
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const stopDrive = driveFromAnalyser(analyser, 4);
    micStop = () => {
      stopDrive();
      src.disconnect();
    };
  } catch {
    if (gen === micGen) micStop = simulateLevel(0.45);
  }
}

export function stopMicLevel(): void {
  micGen++;
  micStop?.();
  micStop = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}
