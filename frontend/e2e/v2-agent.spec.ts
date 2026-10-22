/**
 * NURU v2 agent scenarios (section 14 of the build prompt). Needs OPENAI_API_KEY.
 * Assertions check the final state (server data, events received), not the model's exact steps.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { API, apiLogin, askEsiri, auth, driveUntilIdle, resetDemo, signIn } from './helpers';

test.describe.configure({ retries: 2 });

test.beforeEach(async ({ request }) => {
  const health = await (await request.get(`${API}/api/health`)).json();
  test.skip(!health.has_key, 'needs OPENAI_API_KEY in .env');
  await resetDemo(request);
});

async function connected(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as any).__esiriTest.useEvents.getState().connected), { timeout: 10_000 }).toBe(true);
}

async function device(browser: Browser, username: string, path: string, lang: 'en' | 'sw' = 'sw'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Nuru-Test': '1' } });
  const page = await ctx.newPage();
  await signIn(page, username, path, lang);
  await connected(page);
  return page;
}

async function got(page: Page, type: string, after: number): Promise<boolean> {
  return page.evaluate(
    ([ty, af]) => ((window as any).__nuruEvents as { type: string; at: number }[]).some((e) => e.type === ty && e.at >= (af as number)),
    [type, after] as const,
  );
}

async function mail(page: Page, folder: string, username = 'jolama') {
  const { token } = await apiLogin(page.request, username);
  const list = (await (await page.request.get(`${API}/api/mail?folder=${folder}`, { headers: auth(token) })).json()).messages as {
    id: number;
    subject: string;
    to: { email: string }[];
  }[];
  const full = [];
  for (const m of list) full.push(await (await page.request.get(`${API}/api/mail/${m.id}`, { headers: auth(token) })).json());
  return full as { id: number; subject: string; body: string; to: { email: string }[] }[];
}

async function lastAudit(page: Page) {
  return page.evaluate(() => (window as any).__esiriTest.useApp.getState().audit[0]);
}

test.describe('NURU v2 agent @llm', () => {
  test('1. reply to Dkt. Halima in GMS after one confirmation; she receives it', async ({ browser }) => {
    test.setTimeout(240_000);
    const halima = await device(browser, 'halima', '/gms/inbox');
    const jolama = await device(browser, 'jolama', '/gms/inbox');
    const t0 = Date.now();
    await askEsiri(jolama, 'Jibu barua ya Dkt. Halima kuhusu mapitio ya bajeti, mwambie nitahudhuria na nitaleta takwimu mpya.');
    const confirms = await jolama.getByTestId('esiri-confirm-card').count();
    expect(confirms).toBe(1);
    const sent = await mail(jolama, 'sent');
    const reply = sent.find((m) => /mapitio ya bajeti/i.test(m.subject) && m.to.some((x) => x.email === 'halima.said@mfano.go.tz'));
    expect(reply, 'a reply to Halima in Sent').toBeTruthy();
    const text = reply!.body.split('Jolama\nAfisa TEHAMA')[0].toLowerCase();
    expect(text).toMatch(/hudhuria|attend/);
    expect(text).toMatch(/takwimu|figures/);
    await expect.poll(() => got(halima, 'mail_received', t0), { timeout: 5000 }).toBe(true);
    expect((await mail(halima, 'inbox', 'halima')).some((m) => m.subject === reply!.subject)).toBe(true);
    expect((await lastAudit(jolama)).outcome).toBe('Completed');
  });

  test('2. new English e-mail to Baraka about maintenance is sent after consent', async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/gms/inbox', 'en');
    await askEsiri(page, "Write an email to baraka.mollel@mfano.go.tz about tomorrow's system maintenance at 10 am");
    const sent = await mail(page, 'sent');
    const m = sent.find((x) => x.to.some((y) => y.email === 'baraka.mollel@mfano.go.tz') && /maintenance/i.test(`${x.subject} ${x.body}`));
    expect(m, 'e-mail to Baraka in Sent').toBeTruthy();
    expect(m!.body).toMatch(/10/);
  });

  test('3. declining the send: nothing is sent, the draft exists, the audit says Declined', async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/gms/inbox', 'en');
    const before = (await mail(page, 'sent')).length;
    await askEsiri(page, "Write an email to baraka.mollel@mfano.go.tz about tomorrow's system maintenance at 10 am", { confirm: 'no' });
    expect((await mail(page, 'sent')).length).toBe(before);
    await expect.poll(async () => (await mail(page, 'drafts')).filter((d) => d.to.some((x) => x.email === 'baraka.mollel@mfano.go.tz')).length, { timeout: 5000 }).toBeGreaterThan(0);
    expect((await lastAudit(page)).outcome).toBe('Declined');
  });

  test('4. Halima assigns Jolama a task through WERIS; his NURU receives it', async ({ browser }) => {
    test.setTimeout(240_000);
    const jolama = await device(browser, 'jolama', '/hub');
    const halima = await device(browser, 'halima', '/hub');
    const t0 = Date.now();
    await askEsiri(halima, 'Mpe Jolama kazi ya kuandaa ripoti ya bajeti, iwe tayari Ijumaa saa nane mchana.');
    const { token } = await apiLogin(jolama.request, 'jolama');
    const tasks = (await (await jolama.request.get(`${API}/api/tasks?scope=mine`, { headers: auth(token) })).json()) as { title: string; due_local: string; assigned_by: { display_name: string } }[];
    const task = tasks.find((x) => /ripoti ya bajeti/i.test(x.title));
    expect(task, 'task for Jolama').toBeTruthy();
    expect(task!.assigned_by.display_name).toBe('Dkt. Halima Said');
    expect(task!.due_local).toMatch(/ 14:00$/);
    const due = new Date(task!.due_local.replace(' ', 'T'));
    expect(due.getDay()).toBe(5); // Friday
    await expect.poll(() => got(jolama, 'task_assigned', t0), { timeout: 5000 }).toBe(true);
  });

  test('5. Jolama tells Dkt. Halima he finished; the status is done and her NURU is told', async ({ browser }) => {
    test.setTimeout(240_000);
    const req = (await browser.newContext()).request;
    const { token } = await apiLogin(req, 'halima');
    await req.post(`${API}/api/tasks`, {
      headers: auth(token),
      data: { title: 'Kuandaa ripoti ya bajeti ya robo ya tatu', assigned_to_id: 1, due_at: null },
    });
    const halima = await device(browser, 'halima', '/hub');
    const jolama = await device(browser, 'jolama', '/hub');
    const t0 = Date.now();
    await askEsiri(jolama, 'Mwambie Dkt. Halima nimemaliza kazi ya ripoti ya bajeti.');
    const { token: jt } = await apiLogin(jolama.request, 'jolama');
    const tasks = (await (await jolama.request.get(`${API}/api/tasks?scope=mine`, { headers: auth(jt) })).json()) as { title: string; status: string }[];
    expect(tasks.find((x) => x.title === 'Kuandaa ripoti ya bajeti ya robo ya tatu')!.status).toBe('done');
    await expect.poll(() => got(halima, 'task_updated', t0), { timeout: 5000 }).toBe(true);
  });

  test('6. from a meeting reminder: "Ndiyo, anza kama msimamizi na uninyamazishe"', async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/hub', 'sw');
    await connected(page);
    const { token } = await apiLogin(page.request);
    await page.request.post(`${API}/api/demo/fire-next-reminder`, { headers: auth(token) });
    await expect(page.getByTestId('reminder-card')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('reminder-input').fill('Ndiyo, anza kama msimamizi na uninyamazishe');
    await page.getByTestId('reminder-send').click();
    await driveUntilIdle(page, { label: 'reminder answer' });
    await expect(page).toHaveURL(/\/rooms\/kamati-ya-bajeti-k7b2\/meeting$/);
    await expect(page.getByTestId('moderator-badge')).toBeVisible();
    await expect(page.locator('[data-esiri-id="meeting.mic-toggle"]')).toHaveAttribute('data-esiri-state', 'off');
    await expect(page.getByTestId('meeting-participant').first()).toBeVisible({ timeout: 20_000 });
  });

  test('7. "Nikumbushe kumpigia Mkurugenzi saa nane mchana" adds a 14:00 item with a reminder', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, 'jolama', '/hub', 'sw');
    await askEsiri(page, 'Nikumbushe kumpigia Mkurugenzi saa nane mchana');
    const { token } = await apiLogin(page.request);
    const day = await (await page.request.get(`${API}/api/day`, { headers: auth(token) })).json();
    const item = day.items.find((i: { title: string; type: string }) => i.type === 'item' && /mkurugenzi/i.test(i.title));
    expect(item, 'day item').toBeTruthy();
    expect(item.time).toBe('14:00');
    const rem = await (await page.request.get(`${API}/api/reminders`, { headers: auth(token) })).json();
    const all = [...rem.open, ...rem.upcoming];
    expect(all.some((r: { kind: string; ref_id: string }) => r.kind === 'item' && r.ref_id === String(item.id)) || item.start_at < new Date().toISOString()).toBe(true);
  });

  test('8. typed morning briefing: items are created after "ndiyo"', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, 'jolama', '/hub', 'sw');
    await page.getByTestId('plan-day').click();
    await expect(page.getByTestId('briefing')).toBeVisible();
    await page.getByTestId('briefing-input').fill(
      'Saa nne asubuhi nina kikao na timu ya mifumo. Saa nane mchana nitampigia simu Mkurugenzi. Saa kumi jioni nitaandaa ripoti ya wiki.',
    );
    await page.getByTestId('briefing-send').click();
    await expect(page.getByTestId('briefing-item')).toHaveCount(3, { timeout: 60_000 });
    await page.getByTestId('briefing-input').fill('ndiyo');
    await page.getByTestId('briefing-send').click();
    await expect(page.getByTestId('briefing-done')).toBeVisible({ timeout: 15_000 });
    const { token } = await apiLogin(page.request);
    const day = await (await page.request.get(`${API}/api/day`, { headers: auth(token) })).json();
    const mine = day.items.filter((i: { source: string }) => i.source === 'briefing').map((i: { time: string }) => i.time);
    expect(mine).toEqual(expect.arrayContaining(['10:00', '14:00', '16:00']));
  });
});
