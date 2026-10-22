/**
 * NURU account session: the bearer token (localStorage), the signed-in user, and an authenticated
 * fetch helper used by every /api call. Signing in to the Hub signs in to every mock system (SSO).
 */
import { create } from 'zustand';

export interface NuruUser {
  id: number;
  username: string;
  display_name: string;
  first_name: string;
  title: string;
  role: 'supervisor' | 'staff';
  email: string;
  language: 'sw' | 'en';
  voice_enabled: boolean;
  reminder_lead_min: number;
  meeting_audio_source: 'live' | 'sample';
  wake_word: boolean;
  supervisor_id: number | null;
  signature: string;
}

export interface DirectoryPerson {
  id: number;
  username: string | null;
  display_name: string;
  first_name: string;
  title: string;
  role: string;
  email: string;
  has_account: boolean;
}

const TOKEN_KEY = 'nuru-token';
const USER_KEY = 'nuru-user';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the session lasts for this page only */
  }
}

function cachedUser(): NuruUser | null {
  try {
    const raw = readStorage(USER_KEY);
    return raw ? (JSON.parse(raw) as NuruUser) : null;
  } catch {
    return null;
  }
}

interface SessionState {
  token: string | null;
  user: NuruUser | null;
  /** 'checking' until /api/me answered for a stored token. */
  status: 'checking' | 'anon' | 'authed';
  directory: DirectoryPerson[];
  setSession: (token: string, user: NuruUser) => void;
  setUser: (user: NuruUser) => void;
  clear: () => void;
  setDirectory: (d: DirectoryPerson[]) => void;
}

const initialToken = readStorage(TOKEN_KEY);

export const useSession = create<SessionState>()((set) => ({
  token: initialToken,
  user: initialToken ? cachedUser() : null,
  status: initialToken ? 'checking' : 'anon',
  directory: [],
  setSession: (token, user) => {
    writeStorage(TOKEN_KEY, token);
    writeStorage(USER_KEY, JSON.stringify(user));
    set({ token, user, status: 'authed' });
  },
  setUser: (user) => {
    writeStorage(USER_KEY, JSON.stringify(user));
    set({ user });
  },
  clear: () => {
    writeStorage(TOKEN_KEY, null);
    writeStorage(USER_KEY, null);
    set({ token: null, user: null, status: 'anon', directory: [] });
  },
  setDirectory: (directory) => set({ directory }),
}));

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public messageSw: string = message,
    public body: unknown = null,
  ) {
    super(message);
  }
}

export function authHeaders(): Record<string, string> {
  const token = useSession.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** fetch() with the bearer token. Signs out locally on 401. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) };
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 && useSession.getState().token && !path.startsWith('/api/auth/login')) {
    useSession.getState().clear();
  }
  return r;
}

/** JSON API call; throws HttpError with the backend's {code, error, error_sw}. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let r: Response;
  try {
    r = await authFetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
      body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new HttpError(0, 'network', 'The NURU service could not be reached.', 'Huduma ya NURU haipatikani.');
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    /* empty body */
  }
  if (!r.ok) {
    const e = (j ?? {}) as { code?: string; error?: string; error_en?: string; error_sw?: string };
    throw new HttpError(r.status, e.code ?? 'error', e.error_en ?? e.error ?? `HTTP ${r.status}`, e.error_sw ?? e.error ?? `HTTP ${r.status}`, j);
  }
  return j as T;
}

export async function login(username: string, password: string): Promise<NuruUser> {
  const res = await api<{ token: string; user: NuruUser }>('/api/auth/login', {
    body: { username, password, device_label: navigator.userAgent.slice(0, 120) },
  });
  useSession.getState().setSession(res.token, res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* already gone */
  }
  useSession.getState().clear();
}

export async function refreshMe(): Promise<NuruUser | null> {
  if (!useSession.getState().token) {
    useSession.setState({ status: 'anon' });
    return null;
  }
  try {
    const u = await api<NuruUser>('/api/me');
    useSession.getState().setUser(u);
    useSession.setState({ status: 'authed' });
    return u;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      useSession.getState().clear();
      return null;
    }
    // Backend unreachable: keep the cached user so the UI still renders.
    useSession.setState({ status: useSession.getState().user ? 'authed' : 'anon' });
    return useSession.getState().user;
  }
}

export async function patchMe(patch: Partial<Pick<NuruUser, 'language' | 'voice_enabled' | 'reminder_lead_min' | 'meeting_audio_source' | 'wake_word'>>): Promise<void> {
  if (!useSession.getState().token) return;
  const cur = useSession.getState().user;
  if (cur) useSession.getState().setUser({ ...cur, ...patch });
  try {
    const u = await api<NuruUser>('/api/me', { method: 'PATCH', body: patch });
    useSession.getState().setUser(u);
  } catch {
    /* offline: keep the optimistic value */
  }
}

export async function loadDirectory(): Promise<DirectoryPerson[]> {
  const d = await api<DirectoryPerson[]>('/api/users');
  useSession.getState().setDirectory(d);
  return d;
}

/** The signed-in person as e-Mikutano shows them (falls back to Jolama when signed out). */
export function currentPerson(): { name: string; initials: string; email: string } {
  const u = useSession.getState().user;
  const name = u?.display_name ?? 'Jolama';
  return { name, initials: initialsOf(name), email: u?.email ?? 'jolama@mfano.go.tz' };
}

export function useCurrentPerson(): { name: string; initials: string; email: string } {
  const u = useSession((s) => s.user);
  const name = u?.display_name ?? 'Jolama';
  return { name, initials: initialsOf(name), email: u?.email ?? 'jolama@mfano.go.tz' };
}

export function initialsOf(name: string): string {
  const parts = name.replace(/^(Dkt|Dr|Prof)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
