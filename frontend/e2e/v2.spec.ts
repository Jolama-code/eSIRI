/**
 * NURU v2 without the LLM: accounts and single sign-on, the day timeline, reminders across devices,
 * GMS and WERIS between users (live SSE), moderator mode, the PWA, the code-enforced gates and layout.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { API, apiLogin, auth, esiriId, resetDemo, signIn } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

async function eventsConnected(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as any).__esiriTest.useEvents.getState().connected), { timeout: 10_000 }).toBe(true);
}

/** Time (ms since epoch) at which an event of this type arrived on the page, or null. */
async function eventAt(page: Page, type: string, after = 0): Promise<number | null> {
  return page.evaluate(
    ([ty, af]) => ((window as any).__nuruEvents as { type: string; at: number }[]).find((e) => e.type === ty && e.at >= (af as number))?.at ?? null,
    [type, after] as const,
  );
}

async function device(browser: Browser, username: string, path: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Nuru-Test': '1' } });
  const page = await ctx.newPage();
  await signIn(page, username, path, 'en');
  await eventsConnected(page);
  return page;
}

test.describe('accounts and single sign-on', () => {
  test('sign-in, invalid password, sign-out', async ({ page }) => {
    await page.goto('/hub?mute=1');
    await expect(page).toHaveURL(/\/hub\/login/);
    await page.getByTestId('login-lang-en').click();
    await page.getByTestId('login-username').fill('jolama');
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password.');
    await page.getByTestId('login-password').fill('Demo@2026');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/hub(\?|$)/);
    await expect(page.getByTestId('greeting')).toContainText('Jolama');
    await page.getByTestId('hub-signout').click();
    await expect(page).toHaveURL(/\/hub\/login/);
    expect(await page.evaluate(() => localStorage.getItem('nuru-token'))).toBeNull();
    await page.goto('/weris?mute=1');
    await expect(page).toHaveURL(/\/hub\/login\?next=%2Fweris/);
  });

  test('one sign-in opens GMS, WERIS and e-Mikutano as the same person', async ({ page }) => {
    await signIn(page, 'halima', '/hub');
    await expect(page.getByTestId('greeting')).toContainText('Dkt. Halima');
    await page.goto('/gms/login');
    await expect(page).toHaveURL(/\/gms\/inbox$/);
    await expect(page.getByTestId('gms-user')).toHaveText('halima.said@mfano.go.tz');
    await page.goto('/weris');
    await expect(page.getByTestId('weris-user')).toHaveText('DKT. HALIMA SAID');
    await page.goto('/rooms');
    await expect(page.locator(esiriId('header.user-menu'))).toContainText('Dkt. Halima Said');
    await expect(page.getByText("Dkt. Halima Said's Room")).toBeVisible();
  });
});

test.describe('NURU Hub', () => {
  test('Today: timeline in time order with the "now" marker in the right place', async ({ page }) => {
    await signIn(page, 'jolama', '/hub');
    const items = page.getByTestId('timeline-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(4);
    const starts = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-start') ?? ''));
    expect([...starts].sort()).toEqual(starts);
    await expect(page.getByTestId('now-marker')).toHaveCount(1);
    const order = await page.getByTestId('timeline').evaluate((tl) => {
      const kids = Array.from(tl.children).filter((c) => c.matches('[data-testid="timeline-item"], [data-testid="now-marker"]'));
      const nowIdx = kids.findIndex((c) => c.getAttribute('data-testid') === 'now-marker');
      return kids.map((c, i) => ({ i, nowIdx, start: c.getAttribute('data-start') }));
    });
    const now = Date.now();
    for (const o of order) {
      if (!o.start) continue;
      if (o.i < o.nowIdx) expect(new Date(o.start).getTime()).toBeLessThanOrEqual(now);
      else expect(new Date(o.start).getTime()).toBeGreaterThan(now - 60_000);
    }
    // The seeded Budget Committee meeting is next, highlighted in orange.
    await expect(page.locator('.tl-row.next')).toContainText('Kikao cha Kamati ya Bajeti');
  });

  test('first-use "Tap to start" overlay unlocks audio once per device', async ({ page }) => {
    await signIn(page, 'jolama', '/hub?unlock=1');
    await expect(page.getByTestId('unlock-overlay')).toBeVisible();
    await expect(page.getByTestId('unlock-overlay')).toContainText('Tap to start');
    await page.getByTestId('unlock-start').click();
    await expect(page.getByTestId('unlock-overlay')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('nuru-unlocked-v1'))).toBe('1');
  });

  test('demo controls open with Ctrl+Shift+D and show the KatibuAI connection', async ({ page }) => {
    await signIn(page, 'jolama', '/hub');
    await expect(page.getByTestId('demo-panel')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+D');
    await expect(page.getByTestId('demo-panel')).toBeVisible();
    await expect(page.getByTestId('demo-katibu')).not.toContainText('…');
  });
});

test.describe('reminders', () => {
  test('a reminder reaches both devices of the same user, and OK on one closes it on both', async ({ browser }) => {
    const a = await device(browser, 'jolama', '/hub');
    const b = await device(browser, 'jolama', '/hub/tasks');
    await a.keyboard.press('Control+Shift+D');
    await a.getByTestId('demo-fire-reminder').click();
    await expect(a.getByTestId('reminder-card')).toBeVisible({ timeout: 3000 });
    await expect(b.getByTestId('reminder-card')).toBeVisible({ timeout: 3000 });
    await expect(b.getByTestId('reminder-message')).toContainText('Kikao cha Kamati ya Bajeti');
    await expect(a.getByTestId('reminder-moderate')).toBeVisible();
    await a.getByTestId('reminder-ok').click();
    await expect(a.getByTestId('reminder-card')).toHaveCount(0);
    await expect(b.getByTestId('reminder-card')).toHaveCount(0, { timeout: 3000 });
    // never fires twice
    const { token } = await apiLogin(a.request);
    const list = await (await a.request.get(`${API}/api/reminders`, { headers: auth(token) })).json();
    expect(list.open.find((r: { message_en: string }) => r.message_en.includes('Kikao cha Kamati ya Bajeti'))).toBeUndefined();
  });

  test('snooze re-arms the reminder 5 minutes later and closes it on every device', async ({ browser }) => {
    const a = await device(browser, 'jolama', '/hub');
    const b = await device(browser, 'jolama', '/hub/meetings');
    const { token } = await apiLogin(a.request);
    const fired = await (await a.request.post(`${API}/api/demo/fire-next-reminder`, { headers: auth(token) })).json();
    expect(fired.ok).toBe(true);
    await expect(a.getByTestId('reminder-card')).toBeVisible({ timeout: 3000 });
    await expect(b.getByTestId('reminder-card')).toBeVisible({ timeout: 3000 });
    await a.getByTestId('reminder-snooze').click();
    await expect(a.getByTestId('reminder-card')).toHaveCount(0);
    await expect(b.getByTestId('reminder-card')).toHaveCount(0, { timeout: 3000 });
    const list = await (await a.request.get(`${API}/api/reminders`, { headers: auth(token) })).json();
    const r = list.upcoming.find((x: { id: number }) => x.id === fired.reminder_id);
    expect(r).toBeTruthy();
    const mins = (new Date(r.fire_at).getTime() - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(4);
    expect(mins).toBeLessThan(5.5);
  });

  test('"meeting in 2 minutes" fires its reminder at once with a moderator button', async ({ page }) => {
    await signIn(page, 'jolama', '/hub');
    await eventsConnected(page);
    await page.keyboard.press('Control+Shift+D');
    await page.getByTestId('demo-meeting-soon').click();
    await expect(page.getByTestId('reminder-card')).toBeVisible({ timeout: 4000 });
    await expect(page.getByTestId('reminder-message')).toContainText(/in [12] minutes/);
  });

  test('"Start as moderator" on the reminder opens the meeting, mutes the user and admits the lobby', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, 'jolama', '/hub');
    await eventsConnected(page);
    const { token } = await apiLogin(page.request);
    await page.request.post(`${API}/api/demo/fire-next-reminder`, { headers: auth(token) });
    await page.getByTestId('reminder-moderate').click();
    await expect(page).toHaveURL(/\/rooms\/kamati-ya-bajeti-k7b2\/meeting$/);
    await expect(page.getByTestId('moderator-badge')).toBeVisible();
    await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'off');
    await expect(page.getByTestId('meeting-participant').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('moderator mode', () => {
  test('lobby simulation: invitees knock, NURU admits them visibly, summary on hand-back', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, 'jolama', '/hub');
    await page.goto('/rooms/kamati-ya-bajeti-k7b2/meeting');
    await expect(page.getByTestId('meeting')).toBeVisible();
    await expect(page.getByTestId('katibu-recording')).toBeVisible();
    const res = await page.evaluate(() => (window as any).__esiriTest.enableModerator(true));
    expect(res.ok).toBe(true);
    expect(res.expected_people).toContain('Dkt. Halima Said');
    await expect(page.getByTestId('moderator-badge')).toContainText('Nuru is moderating');
    await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'off');
    const room = await page.evaluate(() => (window as any).__esiriTest.useApp.getState().rooms.find((r: any) => r.id === 'kamati-ya-bajeti-k7b2'));
    expect(room.settings.requireApproval).toBe(true);
    await expect(page.getByTestId('lobby-person').first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('meeting-participant').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('lobby-person')).toHaveCount(0);
    const joined = await page.getByTestId('meeting-participant').count();
    await page.locator(esiriId('meeting.moderator.handback')).click();
    await expect(page.getByTestId('moderator-badge')).toHaveCount(0);
    const audit = await page.evaluate(() => (window as any).__esiriTest.useApp.getState().audit);
    const mod = audit.find((r: any) => r.request.startsWith('Moderator mode'));
    expect(mod.steps.filter((s: any) => s.tool === 'admit').length).toBe(joined);
  });
});

test.describe('GMS', () => {
  test('read, reply, auto-saved draft, send to a demo user who receives it live, external address rejected', async ({ browser }) => {
    const halima = await device(browser, 'halima', '/gms/inbox');
    const jolama = await device(browser, 'jolama', '/gms/inbox');
    await jolama.getByTestId('gms-row').filter({ hasText: 'Mapitio ya bajeti ya robo ya tatu' }).click();
    await expect(jolama.getByTestId('gms-body')).toContainText('takwimu');
    await expect(jolama).toHaveURL(/\/gms\/inbox\/\d+$/);
    await jolama.locator(esiriId('gms.read.reply')).click();
    await expect(jolama.getByTestId('gms-to')).toHaveValue('halima.said@mfano.go.tz');
    await expect(jolama.getByTestId('gms-subject-input')).toHaveValue('Re: Mapitio ya bajeti ya robo ya tatu');
    await expect(jolama.getByTestId('gms-signature')).toContainText('Afisa TEHAMA');
    await jolama.getByTestId('gms-body-input').fill('Habari Dkt. Halima,\n\nNitahudhuria kikao na nitaleta takwimu mpya.\n\nWako,');
    await expect(jolama.getByTestId('gms-draft-status')).toHaveText('Draft saved', { timeout: 5000 });
    const { token } = await apiLogin(jolama.request);
    const drafts = await (await jolama.request.get(`${API}/api/mail?folder=drafts`, { headers: auth(token) })).json();
    expect(drafts.messages).toHaveLength(1);
    const t0 = Date.now();
    await jolama.getByTestId('gms-send').click();
    await expect(jolama).toHaveURL(/\/gms\/sent$/);
    await expect(jolama.getByTestId('gms-row').first()).toContainText('Re: Mapitio ya bajeti');
    await expect.poll(() => eventAt(halima, 'mail_received', t0), { timeout: 3000 }).not.toBeNull();
    await expect(halima.getByTestId('event-toast')).toContainText('Jolama');
    await expect(halima.getByTestId('gms-row').first()).toContainText('Re: Mapitio ya bajeti ya robo ya tatu');
    const sent = await (await jolama.request.get(`${API}/api/mail?folder=sent`, { headers: auth(token) })).json();
    const body = (await (await jolama.request.get(`${API}/api/mail/${sent.messages[0].id}`, { headers: auth(token) })).json()).body as string;
    expect(body).toContain('takwimu mpya');
    expect(body).toContain('Barua pepe: jolama@mfano.go.tz');
    expect(body).toContain('Mapitio ya bajeti ya robo ya tatu');
    // no drafts left after sending
    expect((await (await jolama.request.get(`${API}/api/mail?folder=drafts`, { headers: auth(token) })).json()).messages).toHaveLength(0);

    // external address
    await jolama.goto('/gms/compose');
    await jolama.getByTestId('gms-to').fill('someone@gmail.com');
    await jolama.getByTestId('gms-subject-input').fill('Test');
    await jolama.getByTestId('gms-body-input').fill('Hello');
    await jolama.getByTestId('gms-send').click();
    await expect(jolama.getByTestId('gms-error')).toContainText('Sending outside the system is disabled in this demo.');
    await expect(jolama).toHaveURL(/\/gms\/compose/);
  });
});

test.describe('WERIS NURU-to-NURU', () => {
  test('Halima assigns a special task; Jolama is told within 3 s; his status change flows back', async ({ browser }) => {
    const jolama = await device(browser, 'jolama', '/hub/tasks');
    const halima = await device(browser, 'halima', '/weris/tasks');
    await halima.getByTestId('weris-add-task').click();
    await halima.getByTestId('weris-task-assignee').selectOption('1');
    await halima.getByTestId('weris-task-title').fill('Kuandaa ripoti ya bajeti ya robo ya tatu');
    const friday = await halima.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + (((5 - d.getDay()) + 7) % 7 || 7));
      return d.toISOString().slice(0, 10);
    });
    await halima.getByTestId('weris-task-end').fill(friday);
    await halima.getByTestId('weris-task-time').fill('14:00');
    const t0 = Date.now();
    await halima.getByTestId('weris-task-submit').click();
    await expect(halima.getByTestId('weris-task-row').filter({ hasText: 'Kuandaa ripoti ya bajeti ya robo ya tatu' })).toBeVisible();
    await expect.poll(() => eventAt(jolama, 'task_assigned', t0), { timeout: 3000 }).not.toBeNull();
    expect((await eventAt(jolama, 'task_assigned', t0))! - t0).toBeLessThan(3000);
    await expect(jolama.getByTestId('event-toast')).toContainText('Dkt. Halima Said');
    const row = jolama.getByTestId('task-mine').filter({ hasText: 'Kuandaa ripoti ya bajeti ya robo ya tatu' });
    await expect(row).toBeVisible();
    const id = await row.getAttribute('data-task-id');
    const t1 = Date.now();
    await jolama.locator(esiriId(`hub.task.${id}.status`)).selectOption('done');
    await expect.poll(() => eventAt(halima, 'task_updated', t1), { timeout: 3000 }).not.toBeNull();
    await expect(halima.getByTestId('event-toast')).toContainText('Jolama has completed the task');
    await expect(halima.getByTestId('weris-task-row').filter({ hasText: 'Kuandaa ripoti' }).getByTestId('weris-task-status')).toHaveText('DONE');
  });
});

test.describe('safety gates in code', () => {
  test('gms.compose.send, weris.task.submit, katibu_send_minutes and moderator mode are refused without a confirmation', async ({ page }) => {
    await signIn(page, 'halima', '/gms/compose');
    await page.getByTestId('gms-to').fill('jolama@mfano.go.tz');
    await page.getByTestId('gms-subject-input').fill('Gate test');
    await page.getByTestId('gms-body-input').fill('Hello');
    const r1 = await page.evaluate(async () => {
      const T = (window as any).__esiriTest;
      return T.click('gms.compose.send', { signal: new AbortController().signal, hasCredit: () => false, useCredit: () => undefined });
    });
    expect(r1.code).toBe('confirmation_required');
    await expect(page).toHaveURL(/\/gms\/compose/);

    await page.goto('/weris/tasks');
    await page.getByTestId('weris-add-task').click();
    await page.getByTestId('weris-task-assignee').selectOption('1');
    await page.getByTestId('weris-task-title').fill('Gate test task');
    await expect(page.locator(esiriId('weris.task.submit'))).toHaveAttribute('data-esiri-sensitive', 'true');
    const r2 = await page.evaluate(async () => {
      const T = (window as any).__esiriTest;
      return T.click('weris.task.submit', { signal: new AbortController().signal, hasCredit: () => false, useCredit: () => undefined });
    });
    expect(r2.code).toBe('confirmation_required');
    // assigning to oneself is not sensitive
    await page.getByTestId('weris-task-assignee').selectOption('2');
    await expect(page.locator(esiriId('weris.task.submit'))).not.toHaveAttribute('data-esiri-sensitive', 'true');

    const r3 = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('katibu_send_minutes', {}, 0));
    expect(r3.code).toBe('confirmation_required');
    await page.goto('/rooms/kamati-ya-bajeti-k7b2/meeting');
    await expect(page.getByTestId('meeting')).toBeVisible();
    const r4 = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('moderator_mode', { enabled: true, mute_user: true }, 0));
    expect(r4.code).toBe('confirmation_required');
    await expect(page.getByTestId('moderator-badge')).toHaveCount(0);
    const r5 = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('moderator_mode', { enabled: true, mute_user: true }, 1));
    expect(r5.ok).toBe(true);
    expect(r5.credits_left).toBe(0);
    await expect(page.getByTestId('moderator-badge')).toBeVisible();
  });
});

test.describe('PWA and layout', () => {
  test('the manifest and service worker are served and the worker registers', async ({ page, request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.name).toBe('NURU');
    expect(m.start_url).toBe('/hub');
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    const sw = await request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type']).toContain('javascript');
    expect((await request.get('/icons/icon-512.png')).status()).toBe(200);
    await signIn(page, 'jolama', '/hub');
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 10_000 }).toBe(true);
  });

  test('no horizontal overflow on any Hub page at 390, 1366 and 1920 px', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'jolama', '/hub');
    const { token } = await apiLogin(page.request);
    void token;
    const pages = ['/hub', '/hub/tasks', '/hub/meetings', '/hub/minutes', '/hub/notifications', '/hub/systems', '/hub/activity', '/hub/settings'];
    for (const [w, h] of [[390, 844], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of pages) {
        await page.goto(p);
        await page.waitForTimeout(500);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${p} at ${w}px`).toBeLessThanOrEqual(0);
      }
    }
  });
});

test.describe('morning briefing', () => {
  test('the parse endpoint turns a fixed Swahili transcript into an ordered timetable @key', async ({ request }) => {
    const health = await (await request.get(`${API}/api/health`)).json();
    test.skip(!health.has_key, 'needs OPENAI_API_KEY');
    const { token } = await apiLogin(request);
    const r = await request.post(`${API}/api/briefing/parse`, {
      headers: auth(token),
      data: {
        language: 'sw',
        transcript: 'Leo saa nne asubuhi nina kikao na timu ya mifumo. Saa nane mchana nitampigia simu Mkurugenzi. Saa kumi jioni nitaandaa ripoti ya wiki.',
      },
    });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.items.map((i: { start: string }) => i.start)).toEqual(['10:00', '14:00', '16:00']);
    expect(j.items[1].kind).toBe('call');
    expect(j.items[1].title.toLowerCase()).toMatch(/mkurugenzi/);
  });
});
