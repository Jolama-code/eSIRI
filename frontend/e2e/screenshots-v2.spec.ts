/**
 * NURU v2 visual set (no LLM): every Hub page in Swahili and English at 1366 and 1920 px, GMS inbox,
 * reading and compose, WERIS dashboard, projects and special tasks, the meeting in moderator mode,
 * the reminder card and the briefing timetable. Saved in e2e/screenshots/v2/.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, apiLogin, auth, resetDemo, signIn } from './helpers';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots', 'v2');

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(900);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${name}: horizontal overflow`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test('Hub pages, sw and en, 1366 and 1920', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'jolama', '/hub', 'sw');
  const pages = ['/hub', '/hub/tasks', '/hub/meetings', '/hub/minutes', '/hub/notifications', '/hub/systems', '/hub/activity', '/hub/settings'];
  for (const lang of ['sw', 'en'] as const) {
    await page.evaluate((l) => (window as any).__esiriTest.useApp.getState().setLanguage(l), lang);
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of pages) {
        await page.goto(p);
        await shot(page, `${lang}-${w}-${p.replace(/\//g, '-').replace(/^-/, '')}`);
      }
    }
  }
});

test('GMS and WERIS', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'jolama', '/gms/inbox', 'sw');
  await shot(page, 'sw-1366-gms-inbox');
  await page.getByTestId('gms-row').filter({ hasText: 'Mapitio ya bajeti' }).click();
  await expect(page.getByTestId('gms-body')).toBeVisible();
  await shot(page, 'sw-1366-gms-read');
  await page.locator('[data-esiri-id="gms.read.reply"]').click();
  await page.getByTestId('gms-body-input').fill('Habari Dkt. Halima,\n\nNitahudhuria kikao cha mapitio ya bajeti na nitaleta takwimu mpya.\n\nWako,');
  await shot(page, 'sw-1366-gms-compose');
  for (const p of ['/weris', '/weris/projects', '/weris/tasks', '/weris/pdp', '/weris/reports']) {
    await page.goto(p);
    await shot(page, `sw-1366-${p.replace(/\//g, '-').replace(/^-/, '')}`);
  }
  await page.goto('/weris/tasks');
  await page.getByTestId('weris-add-task').click();
  await page.getByTestId('weris-task-assignee').selectOption('1');
  await page.getByTestId('weris-task-title').fill('Kuandaa ripoti ya bajeti ya robo ya tatu');
  await shot(page, 'sw-1366-weris-add-task');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/gms/inbox');
  await shot(page, 'sw-1920-gms-inbox');
  await page.goto('/weris');
  await shot(page, 'sw-1920-weris');
});

test('reminder card, meeting in moderator mode, briefing timetable', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'jolama', '/hub', 'sw');
  await expect.poll(() => page.evaluate(() => (window as any).__esiriTest.useEvents.getState().connected), { timeout: 10_000 }).toBe(true);
  const { token } = await apiLogin(page.request);
  await page.request.post(`${API}/api/demo/fire-next-reminder`, { headers: auth(token) });
  await expect(page.getByTestId('reminder-card')).toBeVisible({ timeout: 5000 });
  await shot(page, 'sw-1366-reminder-card');
  await page.getByTestId('reminder-moderate').click();
  await expect(page.getByTestId('moderator-badge')).toBeVisible();
  await expect(page.getByTestId('lobby-person').first()).toBeVisible({ timeout: 12_000 });
  await shot(page, 'sw-1366-meeting-lobby');
  await expect(page.getByTestId('meeting-participant').first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'sw-1366-meeting-moderator');

  await page.goto('/hub');
  await page.evaluate(() => {
    const T = (window as any).__esiriTest;
    T.useNuru.getState().setBriefing({
      stage: 'confirm',
      transcript: 'Saa nne asubuhi nina kikao na timu ya mifumo, saa nane mchana nitampigia simu Mkurugenzi, saa kumi jioni nitaandaa ripoti ya wiki.',
      items: [
        { title: 'Kikao na timu ya mifumo', start: '10:00', end: '11:00', duration_min: 60, kind: 'meeting', notes: '' },
        { title: 'Kumpigia simu Mkurugenzi', start: '14:00', end: null, duration_min: null, kind: 'call', notes: '' },
        { title: 'Kuandaa ripoti ya wiki', start: '16:00', end: null, duration_min: 60, kind: 'task', notes: '' },
      ],
      questions: [],
      existing: T.useHub.getState().day.items.map((i: any) => ({ key: i.key, time: i.time, title: i.title, kind: i.kind, start_at: i.start_at })),
    });
  });
  await expect(page.getByTestId('briefing-item')).toHaveCount(3);
  await shot(page, 'sw-1366-briefing');
});
