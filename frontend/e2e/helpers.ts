import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:8010';
export const PASSWORD = 'Demo@2026';

export interface LoginResult {
  token: string;
  user: { id: number; username: string; display_name: string; email: string; role: string };
}

/** Sign in through the API (no browser). */
export async function apiLogin(request: APIRequestContext, username = 'jolama'): Promise<LoginResult> {
  const r = await request.post(`${API}/api/auth/login`, { data: { username, password: PASSWORD } });
  expect(r.status(), `login ${username}`).toBe(200);
  return (await r.json()) as LoginResult;
}

export function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Fresh demo data on the server (signed-in sessions survive). */
export async function resetDemo(request: APIRequestContext): Promise<void> {
  const { token } = await apiLogin(request, 'jolama');
  const r = await request.post(`${API}/api/demo/reset`, { headers: auth(token) });
  expect(r.ok()).toBe(true);
}

/**
 * Sign a browser page in as a demo user (single sign-on for every system) and open `path`.
 * Storage is per test context; `lang` sets the UI language before the app loads.
 */
export async function signIn(page: Page, username = 'jolama', path = '/hub', lang: 'en' | 'sw' = 'en'): Promise<LoginResult> {
  const res = await apiLogin(page.request, username);
  await page.request.patch(`${API}/api/me`, { headers: auth(res.token), data: { language: lang } });
  await page.addInitScript(
    ([token, user, language]) => {
      if (sessionStorage.getItem('nuru-test-init')) return; // only before the first load
      sessionStorage.setItem('nuru-test-init', '1');
      localStorage.setItem('nuru-token', token);
      localStorage.setItem('nuru-user', user);
      const raw = localStorage.getItem('emikutano-store');
      const st = raw ? JSON.parse(raw) : { state: {}, version: 2 };
      st.state = { ...st.state, language };
      localStorage.setItem('emikutano-store', JSON.stringify(st));
    },
    [res.token, JSON.stringify({ ...res.user, language: lang }), lang] as const,
  );
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}mute=1`);
  return res;
}

export interface StoreState {
  language: 'en' | 'sw';
  signedIn: boolean;
  rooms: {
    id: string;
    name: string;
    token: string;
    lastSession: string | null;
    settings: Record<string, boolean>;
    viewerCode: string | null;
    moderatorCode: string | null;
    sharedUsers: string[];
    presentation: { id: string; name: string }[];
  }[];
  recordings: { id: string; roomId: string; name: string; durationSec: number }[];
  meetings: Record<string, { chat: { text: string }[]; notes: string }>;
  audit: {
    request: string;
    outcome: 'Completed' | 'Declined' | 'Cancelled' | 'Failed';
    steps: { tool: string; ok: boolean }[];
    confirmations: { summary: string; result: string }[];
  }[];
}

/** Read the persisted zustand store. */
export async function store(page: Page): Promise<StoreState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('emikutano-store') ?? '{}').state);
}

export const esiriId = (id: string) => `[data-esiri-id="${id}"]`;

/** Fresh storage (Playwright gives each test a new context), mute mode, signed in on /rooms (English UI). */
export async function startSignedIn(page: Page): Promise<void> {
  await signIn(page, 'jolama', '/rooms', 'en');
  await expect(page).toHaveURL(/\/rooms(\?|$)/);
  await expect(page.getByTestId('room-card').first()).toBeVisible();
}

export async function openPanel(page: Page): Promise<void> {
  if (!(await page.locator('.esiri-panel.open').count())) {
    if (await page.getByTestId('esiri-orb').isVisible().catch(() => false)) await page.getByTestId('esiri-orb').click();
    else await page.keyboard.press('Alt+s');
  }
  await expect(page.locator('.esiri-panel.open')).toBeVisible();
  await expect(page.getByTestId('esiri-status')).toHaveText('idle');
}

/** Create a room through the human UI and land on its room page. */
export async function createRoomByHand(page: Page, name: string): Promise<string> {
  await page.goto('/rooms');
  await page.locator(esiriId('rooms.new-room-btn')).click();
  await page.locator(esiriId('create-room.name-input')).fill(name);
  await page.locator(esiriId('create-room.submit')).click();
  await expect(page.getByTestId('room-title')).toHaveText(name);
  const m = /\/rooms\/([^/]+)$/.exec(new URL(page.url()).pathname);
  return m![1];
}

/**
 * Send a typed request to eSiri and wait until it is idle again.
 * Confirmation cards are answered with `confirm` (default yes).
 */
export async function askEsiri(
  page: Page,
  text: string,
  opts: { confirm?: 'yes' | 'no'; timeout?: number } = {},
): Promise<string> {
  const confirm = opts.confirm ?? 'yes';
  const status = page.getByTestId('esiri-status');
  await openPanel(page);
  await page.getByTestId('esiri-input').fill(text);
  await page.getByTestId('esiri-send').click();
  await expect(status).not.toHaveText('idle', { timeout: 5_000 }).catch(() => undefined);
  const deadline = Date.now() + (opts.timeout ?? 105_000);
  let answered = 0;
  while (Date.now() < deadline) {
    const btn = page.getByTestId(confirm === 'yes' ? 'esiri-confirm-yes' : 'esiri-confirm-no');
    if ((await btn.count()) > 0 && (await btn.first().isVisible())) {
      await btn.first().click();
      answered++;
      continue;
    }
    const s = (await status.textContent())?.trim();
    if (s === 'idle') return s;
    if (s === 'awaiting_answer') {
      const q = await page.getByTestId('esiri-reply').last().textContent();
      throw new Error(`eSiri asked a clarifying question instead of acting: "${q}"`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`eSiri did not finish "${text}" in time (confirmations answered: ${answered})`);
}

export async function roomByName(page: Page, name: string) {
  const s = await store(page);
  return s.rooms.find((r) => r.name === name);
}
