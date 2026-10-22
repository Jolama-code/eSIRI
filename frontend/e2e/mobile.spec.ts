/**
 * NURU Hub on a phone (Pixel 7 emulation, project "mobile"): bottom navigation with the raised orb,
 * the "more" sheet, the 5-tap demo controls, reminder cards that fit, and no horizontal overflow.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, apiLogin, auth, resetDemo, signIn } from './helpers';

const shots = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots', 'v2');

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test('phone layout: top bar, bottom navigation with the raised orb, more sheet, sign-in screen', async ({ page }) => {
  await page.goto('/hub/login?mute=1');
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'phone-sw-login.png') });
  await signIn(page, 'jolama', '/hub', 'sw');
  await expect(page.getByTestId('hub-nav-orb')).toBeVisible();
  await expect(page.getByTestId('hub-side-orb')).toBeHidden();
  await expect(page.getByTestId('greeting')).toContainText('Jolama');
  const orb = await page.getByTestId('hub-nav-orb').boundingBox();
  const nav = await page.locator('.hub-bottom').boundingBox();
  expect(orb!.y).toBeLessThan(nav!.y); // raised above the bar
  await page.getByTestId('hub-more').click();
  await page.locator('.more-panel').getByText('Kumbukumbu').click();
  await expect(page).toHaveURL(/\/hub\/minutes$/);
});

test('five taps on the logo open the demo controls', async ({ page }) => {
  await signIn(page, 'jolama', '/hub', 'sw');
  const logo = page.getByTestId('hub-logo-mobile');
  for (let i = 0; i < 5; i++) await logo.click();
  await expect(page.getByTestId('demo-panel')).toBeVisible();
});

test('a reminder card fits the phone screen', async ({ page }) => {
  await signIn(page, 'jolama', '/hub', 'sw');
  await expect.poll(() => page.evaluate(() => (window as any).__esiriTest.useEvents.getState().connected), { timeout: 10_000 }).toBe(true);
  const { token } = await apiLogin(page.request);
  await page.request.post(`${API}/api/demo/fire-next-reminder`, { headers: auth(token) });
  const card = page.getByTestId('reminder-card');
  await expect(card).toBeVisible({ timeout: 5000 });
  const box = await card.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
  await page.screenshot({ path: path.join(shots, 'phone-sw-reminder.png') });
});

test('no horizontal overflow on any Hub page; screenshots in Swahili and English', async ({ page }) => {
  test.setTimeout(120_000);
  const pages = ['/hub', '/hub/tasks', '/hub/meetings', '/hub/minutes', '/hub/notifications', '/hub/systems', '/hub/activity', '/hub/settings'];
  for (const lang of ['sw', 'en'] as const) {
    await page.context().clearCookies();
    await signIn(page, 'jolama', '/hub', lang);
    await page.evaluate((l) => (window as any).__esiriTest.useApp.getState().setLanguage(l), lang);
    for (const p of pages) {
      await page.goto(p);
      await page.waitForTimeout(700);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${p} (${lang})`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(shots, `phone-${lang}-${p.replace(/\//g, '-').replace(/^-/, '')}.png`) });
    }
  }
});
