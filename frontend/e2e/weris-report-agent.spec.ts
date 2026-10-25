/**
 * NURU fills the WERIS weekly report (real model): A one Swahili overview, B card by card with
 * "mengine yote yaendelee vizuri", C "do it for me" (generic items marked for review, no invented numbers),
 * declining and confirming the submit (Dkt. Halima is notified). The report text is always English.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { API, apiLogin, auth, openPanel, resetDemo, signIn } from './helpers';

interface Item { key: string; kind: string; name: string; outcome: string; progress: string; plan: string; blockers: string; nuru: Record<string, string> }

async function report(request: APIRequestContext): Promise<{ status: string; week: string; items: Item[] }> {
  const { token } = await apiLogin(request, 'jolama');
  return (await request.get(`${API}/api/weris/reports/current`, { headers: auth(token) })).json();
}

/** Send a typed message and wait until NURU is idle or waiting for an answer; confirmation cards get `confirm`. */
async function say(page: Page, text: string, confirm: 'yes' | 'no' = 'no', timeout = 150_000): Promise<string> {
  await openPanel(page).catch(() => undefined);
  await page.getByTestId('esiri-input').fill(text);
  await page.getByTestId('esiri-send').click();
  const status = page.getByTestId('esiri-status');
  await expect(status).not.toHaveText(/^(idle|awaiting_answer)$/, { timeout: 5_000 }).catch(() => undefined);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const btn = page.getByTestId(confirm === 'yes' ? 'esiri-confirm-yes' : 'esiri-confirm-no');
    if ((await btn.count()) && (await btn.first().isVisible())) {
      await btn.first().click();
      continue;
    }
    const s = (await status.textContent())?.trim();
    if (s === 'idle' || s === 'awaiting_answer') return s;
    await page.waitForTimeout(300);
  }
  throw new Error(`NURU did not finish "${text}"`);
}

const SWAHILI = /\b(nimemaliza|inaendelea|nahangaika|bado|mradi|wiki|vizuri|kazi|mengine|yote)\b/i;
const complete = (i: Item) => !!i.progress.trim() && !!i.plan.trim();

test.describe('NURU fills the weekly report @llm', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('A: one Swahili overview → every item in English, saved as a draft; "Hapana" keeps the draft', async ({ page, request }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/weris/reports', 'sw');
    const end = await say(page, 'Jaza ripoti yangu ya wiki: SGRFasta nimemaliza kuboresha injini ya AI, GoPost bado nahangaika na API ya TikTok, mingine yote inaendelea vizuri.', 'no');
    expect(end).toBe('idle');
    const r = await report(request);
    expect(r.status).toBe('DRAFT');
    expect(r.items.filter((i) => i.kind === 'project').every(complete)).toBe(true);
    for (const i of r.items.filter(complete)) {
      expect(`${i.progress} ${i.plan} ${i.blockers}`, i.name).not.toMatch(SWAHILI);
    }
    const sgr = r.items.find((i) => i.name === 'SGRFasta')!;
    expect(sgr.outcome).toBe('done');
    expect(sgr.nuru.progress).toBeTruthy();
    expect(r.items.find((i) => i.name === 'GoPost')!.progress + r.items.find((i) => i.name === 'GoPost')!.blockers).toMatch(/tiktok/i);
    // The form on screen shows the chips; the question was declined, so no submit.
    await expect(page.getByTestId('wr-nuru-chip').first()).toBeVisible();
    await expect(page.getByTestId('wr-status')).toHaveText('Hali: DRAFT');
  });

  test('B: card by card for two items, then "mengine yote yaendelee vizuri"', async ({ page, request }) => {
    test.setTimeout(420_000);
    await signIn(page, 'jolama', '/weris', 'sw');
    expect(await say(page, 'Tujaze ripoti pamoja.')).toBe('awaiting_answer');
    await expect(page.getByTestId('esiri-reply').last()).toContainText(/SGRFasta/i);
    expect(await say(page, 'Nimemaliza kuboresha injini ya AI. Wiki ijayo nitaijaribu na data mpya.')).toBe('awaiting_answer');
    await expect(page.getByTestId('esiri-reply').last()).toContainText(/FAKE PRODUCT DETECTOR/i);
    expect(await say(page, 'Nimefanya majaribio kiasi, mpango ni kuendelea na majaribio wiki ijayo.')).toBe('awaiting_answer');
    await say(page, 'Mengine yote yaendelee vizuri.', 'no');
    const r = await report(request);
    expect(r.items.every(complete)).toBe(true);
    const sgr = r.items.find((i) => i.name === 'SGRFasta')!;
    expect(sgr.progress).toMatch(/AI engine|engine/i);
    expect(r.status).toBe('DRAFT');
  });

  test('C: "Niandikie ripoti yangu ya wiki" → every item filled, generic ones marked for review, no invented numbers', async ({ page, request }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/hub', 'sw');
    await say(page, 'Niandikie ripoti yangu ya wiki.', 'no');
    const r = await report(request);
    expect(r.items.every(complete)).toBe(true);
    const projects = r.items.filter((i) => i.kind === 'project');
    expect(projects.some((i) => Object.values(i.nuru).includes('review'))).toBe(true);
    for (const i of projects) expect(`${i.progress} ${i.plan}`, i.name).not.toMatch(/\d|%/);
    for (const i of r.items) expect(`${i.progress} ${i.plan}`, i.name).not.toMatch(SWAHILI);
  });

  test('confirm the submit → SUBMITTED and Dkt. Halima is notified', async ({ page, request }) => {
    test.setTimeout(240_000);
    await signIn(page, 'jolama', '/weris/reports/individual', 'sw');
    await say(page, 'Niandikie ripoti yangu ya wiki kwa maneno mazuri kwa kila kipengele, kisha uiwasilishe.', 'yes');
    const r = await report(request);
    expect(r.status).toBe('SUBMITTED');
    const { token } = await apiLogin(request, 'halima');
    const notes = await (await request.get(`${API}/api/notifications`, { headers: auth(token) })).json();
    expect(JSON.stringify(notes)).toContain(`Jolama amewasilisha ripoti ya wiki ${r.week}.`);
  });
});
