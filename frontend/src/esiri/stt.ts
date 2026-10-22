import type { Language } from '../store/appStore';

/* Minimal typings for the Web Speech API (not in lib.dom). */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SpeechRecognitionLike;

export function recognitionCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  return recognitionCtor() !== null;
}

export function recognitionLang(lang: Language): string {
  return lang === 'sw' ? 'sw-TZ' : 'en-US';
}

export type ListenError = 'no-speech' | 'not-allowed' | 'network' | 'aborted' | 'unsupported' | 'other';

export interface ListenResult {
  text?: string;
  error?: ListenError;
}

let active: SpeechRecognitionLike | null = null;
let activeFinish: ((r: ListenResult) => void) | null = null;

/** Stop the current one-shot recognition (resolves it as aborted, or with any interim text). */
export function stopListening(): void {
  const rec = active;
  if (rec) {
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }
  activeFinish?.({ error: 'aborted' });
}

/** Listen for one utterance. Always resolves. */
export function listenOnce(lang: Language, onInterim: (text: string) => void): Promise<ListenResult> {
  stopListening();
  stopWake(); // only one recognizer at a time; wake mode resumes when eSiri is idle again
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve({ error: 'unsupported' });

  return new Promise<ListenResult>((resolve) => {
    const rec = new Ctor();
    rec.lang = recognitionLang(lang);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let interimText = '';
    let error: ListenError | null = null;
    let settled = false;

    const finish = (r: ListenResult) => {
      if (settled) return;
      settled = true;
      if (active === rec) {
        active = null;
        activeFinish = null;
      }
      window.clearTimeout(safety);
      resolve(r);
    };

    // Safety net: some engines never fire onend.
    const safety = window.setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      window.setTimeout(() => finish(finalText ? { text: finalText } : { error: 'no-speech' }), 800);
    }, 20000);

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      interimText = interim;
      onInterim((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => {
      const map: Record<string, ListenError> = {
        'no-speech': 'no-speech',
        'not-allowed': 'not-allowed',
        'service-not-allowed': 'not-allowed',
        network: 'network',
        aborted: 'aborted',
        'audio-capture': 'not-allowed',
      };
      error = map[e.error] ?? 'other';
    };
    rec.onend = () => {
      const text = (finalText || interimText).trim();
      if (text && error !== 'aborted') finish({ text });
      else finish({ error: error ?? 'no-speech' });
    };

    active = rec;
    activeFinish = finish;
    try {
      rec.start();
    } catch {
      finish({ error: 'other' });
    }
  });
}

// ---------------------------------------------------------------------------
// Wake word: continuous background recognition

// "Nuru" and close recognizer spellings. Deliberately NOT "new room" (a common phrase in this app).
export const WAKE_RE = /\b(nuru|nooru|noor|nuroo)\b/i;

let wakeRec: SpeechRecognitionLike | null = null;
let wakeWanted = false;
let wakeFailures = 0;

/**
 * Start continuous wake-word listening. onWake receives any command that
 * followed the wake word in the same utterance (possibly empty).
 * Returns false if unsupported.
 */
export function startWake(lang: Language, onWake: (command: string) => void, onFatal: () => void): boolean {
  const Ctor = recognitionCtor();
  if (!Ctor) return false;
  stopWake();
  wakeWanted = true;
  wakeFailures = 0;

  const launch = () => {
    if (!wakeWanted) return;
    const rec = new Ctor();
    rec.lang = recognitionLang(lang);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let fired = false;
    let pendingTimer = 0;
    rec.onresult = (e) => {
      if (fired) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript;
        const m = WAKE_RE.exec(text);
        if (!m) continue;
        const after = text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, '').trim();
        if (res.isFinal) {
          fired = true;
          window.clearTimeout(pendingTimer);
          stopWake();
          onWake(after);
          return;
        }
        // Interim match: wait briefly for the rest of the command to arrive as final.
        window.clearTimeout(pendingTimer);
        pendingTimer = window.setTimeout(() => {
          if (fired) return;
          fired = true;
          stopWake();
          onWake('');
        }, 1600);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
        wakeFailures = 99;
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        wakeFailures++;
      }
    };
    rec.onend = () => {
      if (wakeRec === rec) wakeRec = null;
      if (!wakeWanted) return;
      if (wakeFailures >= 5) {
        wakeWanted = false;
        onFatal();
        return;
      }
      window.setTimeout(launch, 250); // restart on end
    };
    wakeRec = rec;
    try {
      rec.start();
    } catch {
      wakeFailures++;
      window.setTimeout(launch, 1000);
    }
  };
  launch();
  return true;
}

export function stopWake(): void {
  wakeWanted = false;
  const rec = wakeRec;
  wakeRec = null;
  if (rec) {
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }
}

export function isWakeActive(): boolean {
  return wakeWanted;
}

// ---------------------------------------------------------------------------
// Long listening (morning briefing): keep recognising until `silenceMs` of silence after speech.

export function listenLong(
  lang: Language,
  onInterim: (text: string) => void,
  opts: { silenceMs?: number; noSpeechMs?: number; maxMs?: number } = {},
): Promise<ListenResult> {
  stopListening();
  stopWake();
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve({ error: 'unsupported' });
  const silenceMs = opts.silenceMs ?? 2500;
  const noSpeechMs = opts.noSpeechMs ?? 12000;
  const maxMs = opts.maxMs ?? 120000;

  return new Promise<ListenResult>((resolve) => {
    let finalText = '';
    let interimText = '';
    let error: ListenError | null = null;
    let settled = false;
    let lastSpeech = 0;
    let rec: SpeechRecognitionLike | null = null;
    const started = Date.now();

    const text = () => `${finalText} ${interimText}`.replace(/\s+/g, ' ').trim();
    const finish = (r: ListenResult) => {
      if (settled) return;
      settled = true;
      window.clearInterval(watch);
      if (activeFinish === finishFromOutside) {
        active = null;
        activeFinish = null;
      }
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    const finishFromOutside = (r: ListenResult) => {
      const t = text();
      finish(t ? { text: t } : r);
    };

    const launch = () => {
      if (settled) return;
      const r = new Ctor();
      rec = r;
      active = r;
      activeFinish = finishFromOutside;
      r.lang = recognitionLang(lang);
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += ' ' + res[0].transcript;
          else interim += res[0].transcript;
        }
        interimText = interim;
        lastSpeech = Date.now();
        onInterim(text());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') error = 'not-allowed';
        else if (e.error === 'network') error = 'network';
        else if (e.error === 'aborted') error = 'aborted';
      };
      r.onend = () => {
        if (settled) return;
        finalText = `${finalText} ${interimText}`;
        interimText = '';
        if (error === 'not-allowed' || error === 'network' || error === 'aborted') {
          const t = text();
          finish(t ? { text: t } : { error });
          return;
        }
        window.setTimeout(launch, 150); // Chrome ends continuous sessions on pauses: keep going
      };
      try {
        r.start();
      } catch {
        finish({ error: 'other' });
      }
    };

    const watch = window.setInterval(() => {
      const now = Date.now();
      const t = text();
      if (t && lastSpeech && now - lastSpeech > silenceMs) finish({ text: t });
      else if (!t && now - started > noSpeechMs) finish({ error: 'no-speech' });
      else if (now - started > maxMs) finish(t ? { text: t } : { error: 'no-speech' });
    }, 250);
    launch();
  });
}
