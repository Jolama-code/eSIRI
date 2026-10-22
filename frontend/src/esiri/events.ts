/**
 * Server-Sent Events: one stream per signed-in device (GET /api/events?token=…).
 * Reconnects automatically and lets subscribers refetch state after a reconnect.
 */
import { create } from 'zustand';
import { useSession } from './session';

export const EVENT_TYPES = [
  'reminder', 'reminder_closed', 'task_assigned', 'task_updated', 'mail_received', 'katibu_progress', 'katibu_ready',
  'katibu_sent', 'katibu_failed', 'katibu_delivery', 'notification', 'day_updated', 'briefing_prompt', 'demo_reset',
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

export const useEvents = create<{ connected: boolean; connects: number }>()(() => ({ connected: false, connects: 0 }));

let source: EventSource | null = null;
let currentToken: string | null = null;
let retryTimer = 0;

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

function dispatch(type: string, raw: string): void {
  let e: NuruEvent;
  try {
    e = JSON.parse(raw) as NuruEvent;
  } catch {
    return;
  }
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
  const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source = es;
  es.addEventListener('hello', () => {
    const s = useEvents.getState();
    useEvents.setState({ connected: true, connects: s.connects + 1 });
    if (s.connects > 0) reconnectHandlers.forEach((fn) => fn());
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
        if (useSession.getState().token && !source) connect();
      }, 3000);
    }
  };
}

export function startEvents(): void {
  const token = useSession.getState().token;
  if (source && token === currentToken) return;
  stopEvents();
  connect();
}

export function stopEvents(): void {
  window.clearTimeout(retryTimer);
  source?.close();
  source = null;
  currentToken = null;
  useEvents.setState({ connected: false });
}
