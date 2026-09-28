import type { Health } from './esiriStore';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StepResponse {
  tool_calls: ToolCall[];
  text: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchHealth(): Promise<Health> {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as Omit<Health, 'reachable'>;
    return { reachable: true, has_key: !!j.has_key, model: j.model, english_tts: j.english_tts === 'openai' ? 'openai' : 'browser' };
  } catch {
    return { reachable: false, has_key: false, model: '', english_tts: 'browser' };
  }
}

export async function agentStep(body: Record<string, unknown>, signal: AbortSignal): Promise<StepResponse> {
  let r: Response;
  try {
    r = await fetch('/api/agent/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('network', 'The eSiri service could not be reached.');
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const err = (j ?? {}) as { code?: string; error?: string; detail?: unknown };
    const code = err.code ?? (r.status >= 500 && r.status !== 502 ? 'network' : 'api_error');
    throw new ApiError(code, err.error ?? (typeof err.detail === 'string' ? err.detail : `HTTP ${r.status}`));
  }
  const res = j as StepResponse;
  return { tool_calls: Array.isArray(res.tool_calls) ? res.tool_calls : [], text: res.text ?? '' };
}

export function resetSession(sessionId: string): void {
  void fetch('/api/agent/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => undefined);
}

export function postAudit(record: unknown): void {
  void fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => undefined);
}

export async function fetchTTS(text: string, lang: 'en' | 'sw', signal?: AbortSignal): Promise<Blob> {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
    signal,
  });
  if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
  const blob = await r.blob();
  if (!blob.size) throw new Error('empty audio');
  return blob;
}
