/**
 * Server-Sent Events: one stream per signed-in device (GET /api/events?token=…).
 * Reconnects automatically and lets subscribers refetch state after a reconnect.
 */
import { create } from 'zustand';
import { useSession } from './session';

export const EVENT_TYPES = [
  'reminder', 'reminder_closed', 'task_assigned', 'task_updated', 'mail_received', 'katibu_progress', 'katibu_ready',
  'katibu_sent', 'katibu_failed', 'katibu_delivery', 'weris_report', 'notification', 'day_updated', 'briefing_prompt', 'demo_reset',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface NuruEvent {
  type: EventType;
  message_sw: string;
  message_en: string;
  title_sw?: string;
  title_en?: string;
  link?: string;
  announce: boolean;
  notification_id?: number | null;
  data: Record<string, unknown>;
}

type Handler = (e: NuruEvent) => void;

const handlers = new Map<string, Set<Handler>>();
const reconnectHandlers = new Set<() => void>();

export const useEvents = create<{ connected: boolean; connects: number; mode: 'sse' | 'poll' }>()(() => ({ connected: false, connects: 0, mode: 'sse' }));

let source: EventSource | null = null;
let currentToken: string | null = null;
let retryTimer = 0;
let fallbackTimer = 0;
let polling: AbortController | null = null;
/** Once a stream failed to open (a tunnel buffering it), stay on long-polling for this page. */
let preferPoll = false;

/** Every received event, for tests and the demo panel. */
const log: { type: string; at: number; data: unknown }[] = [];
(window as unknown as Record<string, unknown>).__nuruEvents = log;

export function onEvent(type: EventType | '*', fn: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(fn);
  return () => handlers.get(type)?.delete(fn);
}

export function onReconnect(fn: () => void): () => void {
  reconnectHandlers.add(fn);
  return () => reconnectHandlers.delete(fn);
}

function connectedNow(): void {
  const s = useEvents.getState();
  useEvents.setState({ connected: true, connects: s.connects + 1 });
  if (s.connects > 0) reconnectHandlers.forEach((fn) => fn());
}

function dispatch(type: string, raw: string): void {
  let e: NuruEvent;
  try {
    e = JSON.parse(raw) as NuruEvent;
  } catch {
    return;
  }
  dispatchEvent(type, e);
}

function dispatchEvent(type: string, e: NuruEvent): void {
  e.data = e.data ?? {};
  log.push({ type, at: Date.now(), data: e });
  if (log.length > 300) log.shift();
  for (const fn of handlers.get(type) ?? []) fn(e);
  for (const fn of handlers.get('*') ?? []) fn(e);
}

function connect(): void {
  const token = useSession.getState().token;
  if (!token) return;
  currentToken = token;
  if (preferPoll) {
    void pollLoop(token);
    return;
  }
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source = es;
  // Some tunnels (Cloudflare quick tunnels) buffer event streams: no "hello" within 5 s → long-poll instead.
  window.clearTimeout(fallbackTimer);
  fallbackTimer = window.setTimeout(() => {
    if (source === es && !useEvents.getState().connected) {
      preferPoll = true;
      es.close();
      source = null;
      void pollLoop(token);
    }
  }, 5000);
  es.addEventListener('hello', () => {
    window.clearTimeout(fallbackTimer);
    useEvents.setState({ mode: 'sse' });
    connectedNow();
  });
  for (const t of EVENT_TYPES) es.addEventListener(t, (ev) => dispatch(t, (ev as MessageEvent).data));
  es.onerror = () => {
    useEvents.setState({ connected: false });
    if (es.readyState === EventSource.CLOSED) {
      // e.g. 401 or the server restarted: try again shortly (the browser stops retrying on HTTP errors).
      es.close();
      if (source === es) source = null;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        if (useSession.getState().token && !source && !polling) connect();
      }, 3000);
    }
  };
}

/** Long-polling fallback: GET /api/events/poll?after=seq returns new events (waits up to 20 s). */
async function pollLoop(token: string): Promise<void> {
  polling?.abort();
  const ctrl = new AbortController();
  polling = ctrl;
  useEvents.setState({ mode: 'poll' });
  let after = -1;
  let failures = 0;
  while (!ctrl.signal.aborted && useSession.getState().token === token) {
    try {
      const r = await fetch(`/api/events/poll?token=${encodeURIComponent(token)}&after=${after}`, { signal: ctrl.signal, cache: 'no-store' });
      if (r.status === 401) break;
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { seq: number; reset?: boolean; events: (NuruEvent & { seq: number })[] };
      if (after < 0 || failures > 0 || j.reset) connectedNow();
      failures = 0;
      for (const e of j.events) dispatchEvent(e.type, e);
      after = j.seq;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      failures++;
      useEvents.setState({ connected: false });
      await new Promise((res) => window.setTimeout(res, Math.min(5000, 1000 * failures)));
    }
  }
  if (polling === ctrl) polling = null;
}

export function startEvents(): void {
  const token = useSession.getState().token;
  if ((source || polling) && token === currentToken) return;
  stopEvents();
  connect();
}

export function stopEvents(): void {
  window.clearTimeout(retryTimer);
  window.clearTimeout(fallbackTimer);
  polling?.abort();
  polling = null;
  source?.close();
  source = null;
  currentToken = null;
  useEvents.setState({ connected: false });
}
