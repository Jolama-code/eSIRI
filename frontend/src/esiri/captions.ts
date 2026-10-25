/**
 * "Manukuu ya moja kwa moja": live captions in the meeting (Web Speech, sw-TZ / en-US).
 *
 * The browser runs one SpeechRecognition at a time, so captions pause whenever NURU itself listens
 * (push-to-talk, a spoken answer, the briefing, the wake word) and resume when it is done. Captions never
 * touch the MediaRecorder: the KatibuAI recording has its own microphone stream.
 */
import { create } from 'zustand';
import { recognitionCtor, recognitionLang, nuruIsListening, setCaptionsPauser, type SpeechRecognitionLike } from './stt';
import { useEsiri } from './esiriStore';
import { useApp } from '../store/appStore';
import { isMuted } from './tts';

export interface CaptionLine {
  id: number;
  text: string;
}

interface CaptionState {
  on: boolean;
  paused: boolean;
  supported: boolean;
  lines: CaptionLine[];
  interim: string;
}

export const useCaptions = create<CaptionState>()(() => ({ on: false, paused: false, supported: true, lines: [], interim: '' }));

let rec: SpeechRecognitionLike | null = null;
let timer = 0;
let seq = 0;
let restartAt = 0;

function stopRec(): void {
  const r = rec;
  rec = null;
  if (!r) return;
  r.onend = null;
  r.onresult = null;
  r.onerror = null;
  try {
    r.abort();
  } catch {
    /* ignore */
  }
}

function nuruListening(): boolean {
  const s = useEsiri.getState();
  return s.micOpen || s.status === 'listening' || nuruIsListening();
}

function startRec(): void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    useCaptions.setState({ supported: false });
    return;
  }
  const r = new Ctor();
  r.lang = recognitionLang(useApp.getState().language);
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let interim = '';
    const finals: string[] = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finals.push(res[0].transcript.trim());
      else interim += res[0].transcript;
    }
    useCaptions.setState((s) => ({
      interim: interim.trim(),
      lines: finals.length ? [...s.lines, ...finals.filter(Boolean).map((text) => ({ id: ++seq, text }))].slice(-30) : s.lines,
    }));
  };
  r.onerror = () => {
    restartAt = Date.now() + 1500;
  };
  r.onend = () => {
    if (rec === r) rec = null; // tick() restarts it
  };
  rec = r;
  try {
    r.start();
  } catch {
    rec = null;
  }
}

function tick(): void {
  if (!useCaptions.getState().on) return;
  const pause = nuruListening();
  if (pause !== useCaptions.getState().paused) useCaptions.setState({ paused: pause, interim: '' });
  if (pause) stopRec();
  else if (!rec && Date.now() >= restartAt) startRec();
}

/** Start captions for the meeting (no-op when muted or unsupported). */
export function startCaptions(): void {
  if (useCaptions.getState().on || isMuted()) return;
  if (!recognitionCtor()) {
    useCaptions.setState({ supported: false });
    return;
  }
  useCaptions.setState({ on: true, paused: false, supported: true, lines: [], interim: '' });
  // NURU's own listening stops captions at once, so the two never compete for the recogniser.
  setCaptionsPauser(() => {
    useCaptions.setState({ paused: true, interim: '' });
    stopRec();
  });
  tick();
  timer = window.setInterval(tick, 500);
}

export function stopCaptions(): void {
  window.clearInterval(timer);
  setCaptionsPauser(null);
  stopRec();
  useCaptions.setState({ on: false, paused: false, interim: '' });
}
