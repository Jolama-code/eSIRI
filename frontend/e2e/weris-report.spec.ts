/**
 * WERIS individual weekly report (no LLM): the landing, the form computed from today's ISO week, tab counters,
 * validation, Save Draft, Submit → read-only + the supervisor's notification, demo reset, the
 * "Imeandaliwa na NURU" chips (fill call stubbed), and the code gate on weris.report.submit.
 */
import { test, expect, type Page } from '@playwright/test';
import { API, apiLogin, auth, esiriId, resetDemo, signIn } from './helpers';

function isoWeek(d = new Date()): { week: string; monday: string; sunday: string } {
  // Today's date in Dar es Salaam (the backend's NURU_TZ).
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' }));
  const day = (local.getDay() + 6) % 7;
  const monday = new Date(local);
  monday.setDate(local.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { week: `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`, monday: ymd(monday), sunday: ymd(sunday) };
}

async function openForm(page: Page, lang: 'en' | 'sw' = 'en') {
  await signIn(page, 'jolama', '/weris/reports/individual', lang);
  await expect(page.getByTestId('wr-form')).toBeVisible();
}

const card = (page: Page, name: string) => page.getByTestId('wr-item').filter({ has: page.locator('.wr-item-name', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test('landing: Project and Individual reports cards, Security Reports not in this demo', async ({ page }) => {
  await signIn(page, 'jolama', '/weris/reports', 'en');
  await expect(page.getByRole('heading', { name: 'Weekly Reports' })).toBeVisible();
  await expect(page.getByText('Project Reports')).toBeVisible();
  await page.locator(esiriId('weris.reports.security')).click();
  await expect(page.getByText('Not available in this demo.')).toBeVisible();
  await page.getByTestId('wr-individual').click();
  await expect(page).toHaveURL(/\/weris\/reports\/individual/);
});

test('the form: this ISO week, DRAFT, tabs with counters, promises from last week', async ({ page }) => {
  const w = isoWeek();
  await openForm(page);
  await expect(page.getByTestId('wr-title')).toHaveText(`Weekly Report — ${w.week} (${w.monday} → ${w.sunday})`);
  await expect(page.getByTestId('wr-status')).toHaveText('Status: DRAFT');
  await expect(page.getByTestId('wr-count-projects')).toHaveText('0/6');
  await expect(page.getByTestId('wr-count-assignments')).toHaveText('0/2');
  await expect(page.getByTestId('wr-count-pdps')).toHaveText('0/2');
  await expect(page.getByTestId('wr-footer-msg')).toHaveText('10 items need progress before you can submit.');
  await expect(page.getByTestId('wr-item')).toHaveCount(6);
  await expect(card(page, 'SGRFasta').getByTestId('wr-promise')).toHaveText('improving the AI engine');
  await expect(card(page, 'GoPost').getByTestId('wr-promise')).toHaveText('understanding why it has been hard to integrate the TikTok APIs');
  await expect(page.getByTestId('wr-submit')).toBeDisabled();
  await page.getByTestId('wr-tab-assignments').click();
  await expect(page.getByTestId('wr-item')).toHaveCount(2);
  await page.getByTestId('wr-tab-pdps').click();
  await expect(page.getByTestId('wr-item')).toHaveCount(2);
});

test('validation, live counters and Save Draft', async ({ page }) => {
  await openForm(page);
  const sgr = card(page, 'SGRFasta');
  await sgr.getByTestId('wr-progress').fill('Improved the ranking module of the AI engine.');
  await expect(sgr.getByTestId('wr-item-state')).toHaveText('incomplete'); // the plan is required too
  await expect(page.getByTestId('wr-count-projects')).toHaveText('0/6');
  await sgr.getByTestId('wr-plan').fill('Test the engine with more routes.');
  await expect(sgr.getByTestId('wr-item-state')).toHaveText('complete');
  await expect(page.getByTestId('wr-count-projects')).toHaveText('1/6');
  await expect(page.getByTestId('wr-footer-msg')).toHaveText('9 items need progress before you can submit.');
  await sgr.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('wr-save').click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.reload();
  await expect(card(page, 'SGRFasta').getByTestId('wr-plan')).toHaveValue('Test the engine with more routes.');
  await expect(card(page, 'SGRFasta').getByRole('button', { name: 'Done', exact: true })).toHaveClass(/on/);
  await expect(page.getByTestId('wr-status')).toHaveText('Status: DRAFT');
});

test('submit: read-only SUBMITTED, Dkt. Halima is notified; demo reset gives an empty DRAFT again', async ({ page, browser, request }) => {
  const { token } = await apiLogin(request, 'jolama');
  const cur = await (await request.get(`${API}/api/weris/reports/current`, { headers: auth(token) })).json();
  // Fill every item except one through the API, the last one by hand.
  const items = cur.items.slice(1).map((i: { key: string }) => ({ key: i.key, progress: 'Progress made.', plan: 'Continue next week.' }));
  await request.put(`${API}/api/weris/reports/current`, { headers: auth(token), data: { items } });

  const halima = await browser.newPage();
  await signIn(halima, 'halima', '/hub', 'sw');

  await openForm(page);
  await expect(page.getByTestId('wr-footer-msg')).toHaveText('1 item needs progress before you can submit.');
  const first = page.getByTestId('wr-item').first();
  await first.getByTestId('wr-progress').fill('Finished the work promised last week.');
  await first.getByTestId('wr-plan').fill('Start the next milestone.');
  await expect(page.getByTestId('wr-footer-msg')).toHaveText('All items are complete. You can submit.');
  await page.getByTestId('wr-submit').click(); // a human click is never gated
  await expect(page.getByTestId('wr-status')).toHaveText('Status: SUBMITTED');
  await expect(first.getByTestId('wr-progress')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('wr-submit')).toHaveCount(0);
  await expect(page.getByTestId('wr-footer-msg')).toContainText('read-only');

  const w = cur.week as string;
  await expect(halima.getByText(`Jolama amewasilisha ripoti ya wiki ${w}.`).first()).toBeVisible({ timeout: 15_000 });
  const { token: ht } = await apiLogin(request, 'halima');
  const notes = await (await request.get(`${API}/api/notifications`, { headers: auth(ht) })).json();
  expect(JSON.stringify(notes)).toContain(`Jolama amewasilisha ripoti ya wiki ${w}.`);
  await halima.close();

  await resetDemo(request);
  const again = await (await request.get(`${API}/api/weris/reports/current`, { headers: auth(token) })).json();
  expect(again.status).toBe('DRAFT');
  expect(again.items.every((i: { progress: string; plan: string }) => !i.progress && !i.plan)).toBe(true);
});

test('NURU fills cards visibly with "Imeandaliwa na NURU" chips that disappear on edit; submit is gated in code', async ({ page }) => {
  await page.route('**/api/weris/reports/current/fill', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        week: 'stub',
        items: [
          { key: 'project-7', outcome: 'done', progress: 'I finished improving the AI engine for SGRFasta.', plan: 'I will test it with more routes.', blockers: '', source: 'user', needs_review: false },
          { key: 'project-8', outcome: 'partial', progress: 'Continued testing the image-matching model.', plan: 'Continue the tests next week.', blockers: '', source: 'generic', needs_review: true },
        ],
      }),
    }),
  );
  await openForm(page, 'sw');
  const r = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('weris_report', { action: 'fill', request: 'stub', scope: 'all', keys: [] }, 0));
  expect(r.ok).toBe(true);
  expect(r.draft_saved).toBe(true);
  expect(r.needs_review).toEqual(['FAKE PRODUCT DETECTOR']);
  const sgr = card(page, 'SGRFasta');
  await expect(sgr.getByTestId('wr-progress')).toHaveValue('I finished improving the AI engine for SGRFasta.');
  await expect(sgr.getByRole('button', { name: 'Imekamilika', exact: true })).toHaveClass(/on/);
  await expect(sgr.getByTestId('wr-nuru-chip')).toHaveCount(3); // outcome, progress, plan
  await expect(card(page, 'FAKE PRODUCT DETECTOR').getByTestId('wr-nuru-chip').first()).toContainText('Imeandaliwa na NURU · Hakiki');
  // The draft (with the chips) is saved.
  await page.reload();
  await expect(card(page, 'SGRFasta').getByTestId('wr-nuru-chip')).toHaveCount(3);
  // A human edit removes that field's chip.
  await card(page, 'SGRFasta').getByTestId('wr-plan').fill('I will test it with more routes and fix bugs.');
  await expect(card(page, 'SGRFasta').getByTestId('wr-nuru-chip')).toHaveCount(2);

  // Fill the rest, then: NURU may not click Submit without a confirmation.
  const { token } = await apiLogin(page.request, 'jolama');
  const cur = await (await page.request.get(`${API}/api/weris/reports/current`, { headers: auth(token) })).json();
  await page.request.put(`${API}/api/weris/reports/current`, { headers: auth(token), data: { items: cur.items.map((i: { key: string; progress: string; plan: string }) => ({ ...i, progress: i.progress || 'x', plan: i.plan || 'y' })) } });
  await page.reload();
  await expect(page.locator(esiriId('weris.report.submit'))).toHaveAttribute('data-esiri-sensitive', 'true');
  const blocked = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('click', { element_id: 'weris.report.submit' }, 0));
  expect(blocked.code).toBe('confirmation_required');
  await expect(page.getByTestId('wr-status')).toHaveText('Hali: DRAFT');
  const ok = await page.evaluate(() => (window as any).__esiriTest.testExecuteTool('click', { element_id: 'weris.report.submit' }, 1));
  expect(ok.ok).toBe(true);
  await expect(page.getByTestId('wr-status')).toHaveText('Hali: SUBMITTED');
});
