import { fetchTTS } from './api';
import { audioContext, driveFromAnalyser, simulateLevel } from './audioLevel';
import type { Language } from '../store/appStore';

// ?mute=1 disables all speech (automated tests). Remembered for the tab session.
const MUTE_KEY = 'esiri-mute';
try {
  const p = new URLSearchParams(window.location.search);
  if (p.get('mute') === '1') sessionStorage.setItem(MUTE_KEY, '1');
  if (p.get('mute') === '0') sessionStorage.removeItem(MUTE_KEY);
} catch {
  /* ignore */
}

export function isMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let englishMode: 'browser' | 'openai' = 'openai';
export function setEnglishTTS(mode: 'browser' | 'openai'): void {
  englishMode = mode;
}

/** Remove markdown so it is not read aloud. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/[>#*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split into sentence-sized chunks (Chrome cuts long utterances). */
export function splitSentences(text: string, max = 180): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if ((cur + ' ' + p).trim().length <= max) cur = (cur + ' ' + p).trim();
    else {
      if (cur) out.push(cur);
      if (p.length <= max) cur = p;
      else {
        // hard split very long sentences on commas / spaces
        let rest = p;
        while (rest.length > max) {
          let cut = rest.lastIndexOf(',', max);
          if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
          if (cut <= 0) cut = max;
          out.push(rest.slice(0, cut + 1).trim());
          rest = rest.slice(cut + 1);
        }
        cur = rest.trim();
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function estimateMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words * 420 + 600;
}

// ---------------------------------------------------------------------------
// Voices

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (!voicesReady) {
    voicesReady = new Promise((resolve) => {
      const now = speechSynthesis.getVoices();
      if (now.length) return resolve(now);
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      window.setTimeout(done, 1500);
    });
    // Voices may change later too; refresh the cache.
    speechSynthesis.addEventListener('voiceschanged', () => {
      voicesReady = Promise.resolve(speechSynthesis.getVoices());
    });
  }
  return voicesReady;
}

async function pickVoice(lang: Language): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  if (lang === 'sw') return voices.find((v) => v.lang.toLowerCase().startsWith('sw')) ?? null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => /google/i.test(v.name) && /en[-_]us/i.test(v.lang)) ??
    en.find((v) => /google/i.test(v.name)) ??
    en.find((v) => /en[-_]us/i.test(v.lang) && v.localService) ??
    en[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Playback

let currentAudio: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null;
let generation = 0;

export function stopSpeaking(): void {
  generation++;
  stopCurrent?.();
  stopCurrent = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

function withTimeout(p: Promise<void>, ms: number, onTimeout: () => void): Promise<void> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => {
      onTimeout();
      resolve();
    }, ms);
    p.then(
      () => {
        window.clearTimeout(id);
        resolve();
      },
      () => {
        window.clearTimeout(id);
        resolve();
      },
    );
  });
}

function speakBrowser(chunks: string[], voice: SpeechSynthesisVoice | null, lang: Language, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const stopSim = simulateLevel(0.75);
    let i = 0;
    const finish = () => {
      stopSim();
      resolve();
    };
    stopCurrent = () => {
      stopSim();
      resolve();
    };
    const next = () => {
      if (gen !== generation || i >= chunks.length) return finish();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (lang === 'sw' ? 'sw-TZ' : 'en-US');
      u.rate = 1.02;
      u.onend = next;
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  });
}

async function speakOpenAI(text: string, lang: Language, gen: number): Promise<void> {
  const ctrl = new AbortController();
  stopCurrent = () => ctrl.abort();
  const blob = await fetchTTS(text, lang, ctrl.signal);
  if (gen !== generation) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  let stopDrive: (() => void) | null = null;
  const ac = audioContext();
  if (ac) {
    try {
      const src = ac.createMediaElementSource(audio);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyser.connect(ac.destination);
      stopDrive = driveFromAnalyser(analyser, 3.5);
    } catch {
      stopDrive = simulateLevel(0.7);
    }
  } else stopDrive = simulateLevel(0.7);

  await new Promise<void>((resolve) => {
    const done = () => {
      stopDrive?.();
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    stopCurrent = () => {
      audio.pause();
      done();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch((err: unknown) => {
      if ((err as Error)?.name === 'NotAllowedError') window.dispatchEvent(new Event('nuru:audio-locked'));
      done();
    });
  });
}

/**
 * Speak text. Always resolves: on end, on error, or after a timeout, so the
 * agent loop can never get stuck on audio.
 */
export async function speak(text: string, lang: Language): Promise<void> {
  const clean = stripMarkdown(text);
  if (!clean || isMuted()) return;
  stopSpeaking();
  const gen = generation;
  const timeoutMs = estimateMs(clean) + 3000;

  const run = async () => {
    // One voice for everything: OpenAI TTS for Swahili and English, the browser voice only as a fallback.
    if (lang === 'sw' || englishMode === 'openai') {
      try {
        await speakOpenAI(clean, lang, gen);
        return;
      } catch {
        /* fall back to the browser voice */
      }
    }
    const voice = await pickVoice(lang);
    if (gen !== generation) return;
    if (lang === 'sw' && !voice) return; // no Swahili voice in this browser: text only
    await speakBrowser(splitSentences(clean), voice, lang, gen);
  };

  // OpenAI TTS needs extra time for the network round trip.
  const extra = lang === 'sw' || englishMode === 'openai' ? 8000 : 0;
  await withTimeout(run(), timeoutMs + extra, () => {
    if (gen === generation) stopSpeaking();
  });
}

// ---------------------------------------------------------------------------
// Audio unlock (browsers block sound until the user taps; phones especially)

let unlocked = false;

export function audioUnlocked(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return unlocked || !!ua?.hasBeenActive;
}

/** Call from a tap/click handler: plays a short silent buffer so later speech may play. */
export async function unlockAudio(): Promise<void> {
  try {
    const ac = audioContext();
    if (ac) {
      if (ac.state === 'suspended') await ac.resume();
      const buf = ac.createBuffer(1, Math.max(1, Math.round(ac.sampleRate * 0.05)), ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    }
    // A silent WAV through an <audio> element too (iOS/Android unlock HTMLAudio separately).
    const silent = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    const a = new Audio(silent);
    a.volume = 0;
    await a.play().catch(() => undefined);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    unlocked = true;
  } catch {
    unlocked = true;
  }
}

/** Warm up the voice list early. */
export function initTTS(): void {
  void loadVoices();
}
