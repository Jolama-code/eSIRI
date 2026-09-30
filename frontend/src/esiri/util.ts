export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AbortError';
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e instanceof CancelledError);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const id = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function nextFrames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });
}

const STOP_WORDS = ['stop', 'cancel', 'simama', 'acha', 'sitisha'];

/** True when the whole utterance is a stop word. */
export function isStopUtterance(text: string): boolean {
  const s = text.toLowerCase().replace(/[.,!?¡¿'"]/g, '').trim();
  return STOP_WORDS.includes(s) || /^((nuru|nooru|noor)\s+)?(stop|cancel|simama|acha|sitisha)( it| now| sasa)?$/.test(s);
}

const YES = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'go ahead', 'do it', 'proceed', 'confirm', 'ndiyo', 'ndio', 'sawa', 'endelea', 'haya', 'thibitisha', 'yes please', 'of course'];
const NO = ['no', 'nope', 'cancel', "don't", 'dont', 'do not', 'stop', 'hapana', 'acha', 'usifanye', 'ghairi', 'sitisha', 'no thanks'];

/** Parse a spoken or typed yes/no answer. */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const s = ` ${text.toLowerCase().replace(/[.,!?¡¿"]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const has = (words: string[]) => words.some((w) => s.includes(` ${w} `));
  const yes = has(YES);
  const no = has(NO);
  if (yes && !no) return 'yes';
  if (no && !yes) return 'no';
  if (yes && no) {
    // "no, go ahead" is rare; the first word decides.
    const first = s.trim().split(' ')[0];
    if (YES.includes(first)) return 'yes';
    if (NO.includes(first)) return 'no';
  }
  return null;
}
