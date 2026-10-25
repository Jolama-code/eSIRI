/**
 * NURU's typing box: a textarea that grows upwards to about 6 lines, then scrolls inside; Enter sends,
 * Shift+Enter makes a new line; long messages wrap in the conversation. Hub, GMS, WERIS and e-Mikutano.
 * The agent call is stubbed, so no OpenAI request is made.
 */
import { test, expect, type Page } from '@playwright/test';
import { openPanel, resetDemo, signIn } from './helpers';

const LONG =
  'Tafadhali niandalie barua pepe kwa Dkt. Halima Said kuhusu maendeleo ya mradi wa NURU, ukieleza kwamba majaribio ' +
  'ya simu yamekamilika, kumbukumbu za vikao zinatumwa kupitia KatibuAI, na ripoti ya wiki itawasilishwa kabla ya Ijumaa. ' +
  'Neno-refu-sana-lisilo-na-nafasi-ambalo-lazima-likatwe-ndani-ya-kiputo-bila-kupanua-dirisha-la-mazungumzo-kabisa-kabisa.';

async function stubAgent(page: Page) {
  await page.route('**/api/agent/step', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'test_stub', error: 'Stubbed in this test.' }) }),
  );
}

async function checkTypingBox(page: Page) {
  await openPanel(page);
  const box = page.getByTestId('esiri-input');
  expect(await box.evaluate((el) => el.tagName)).toBe('TEXTAREA');
  const h1 = (await box.boundingBox())!.height;

  // Shift+Enter makes new lines; the box grows upwards (its bottom stays put).
  await box.click();
  await box.pressSequentially('Mstari wa kwanza');
  const bottom1 = (await box.boundingBox())!.y + h1;
  for (const line of ['wa pili', 'wa tatu']) {
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(line);
  }
  await expect(page.getByTestId('esiri-reply')).toHaveCount(0);
  expect(await box.inputValue()).toBe('Mstari wa kwanza\nwa pili\nwa tatu');
  const b3 = (await box.boundingBox())!;
  expect(b3.height).toBeGreaterThan(h1 + 30);
  expect(Math.abs(b3.y + b3.height - bottom1)).toBeLessThan(3);

  // Very long text: capped at about 6 lines, then it scrolls inside.
  await box.fill(`${LONG}\n${LONG}\n${LONG}`);
  const capped = (await box.boundingBox())!.height;
  expect(capped).toBeLessThanOrEqual(142);
  expect(capped).toBeGreaterThan(110);
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);

  // Enter sends; the bubble keeps the line breaks and wraps inside the panel.
  await box.fill(`Mstari wa kwanza\n${LONG}`);
  await box.press('Enter');
  await expect(box).toHaveValue('');
  expect((await box.boundingBox())!.height).toBeLessThan(h1 + 3);
  const bubble = page.locator('.esiri-panel .bubble-user').last();
  await expect(bubble).toContainText('Mstari wa kwanza');
  const fits = await bubble.evaluate((el) => {
    const panel = el.closest('.esiri-panel')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { inside: r.right <= panel.right + 1 && r.left >= panel.left - 1, noOverflow: el.scrollWidth <= el.clientWidth + 1, lines: el.getClientRects().length && r.height > 60 };
  });
  expect(fits.inside).toBe(true);
  expect(fits.noOverflow).toBe(true);
  expect(fits.lines).toBeTruthy();
  expect(await page.evaluate(() => document.querySelector('.ep-list')!.scrollWidth <= document.querySelector('.ep-list')!.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

for (const path of ['/hub', '/gms/inbox', '/weris', '/rooms']) {
  test(`typing box grows, Enter sends, long messages wrap: ${path}`, async ({ page }) => {
    await stubAgent(page);
    await signIn(page, 'jolama', path, 'sw');
    await checkTypingBox(page);
  });
}
