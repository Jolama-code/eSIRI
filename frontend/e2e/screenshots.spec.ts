/**
 * Visual check: screenshots of every page in English and Swahili with the eSiri panel open,
 * at 1366×768 and 1920×1080, plus automatic overflow checks. No LLM needed.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esiriId, openPanel, resetDemo, signIn } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'screenshots');

const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
];

async function noHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    const shell = document.querySelector('.app-shell') as HTMLElement | null;
    const limit = shell ? shell.getBoundingClientRect().right + 1 : window.innerWidth + 1;
    document.querySelectorAll<HTMLElement>('.app-shell *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (el.closest('.esiri-panel, .esiri-stage, .orb-fab, .nuru-stack, .rem-stack, .ev-toasts, .toasts, .modal-backdrop, .rec-table-wrap, .audit-table-wrap, .full-header-bg, .mt-floating')) return;
      if (r.right > limit + 1) offenders.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(r.right)} > ${Math.round(limit)}`);
    });
    return { scroll: doc.scrollWidth > doc.clientWidth + 1, offenders: offenders.slice(0, 5) };
  });
  expect(overflow.scroll, `${label}: page scrolls horizontally`).toBe(false);
  expect(overflow.offenders, `${label}: elements overflow the content area`).toEqual([]);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await noHorizontalOverflow(page, name);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

for (const size of SIZES) {
  for (const lang of ['en', 'sw'] as const) {
    test(`screenshots ${lang} ${size.w}x${size.h}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.w, height: size.h });
      const tag = `${lang}-${size.w}`;

      await signIn(page, 'jolama', '/', lang);
      await shot(page, `${tag}-01-landing`);
      await openPanel(page);
      await shot(page, `${tag}-02-landing-panel`);
      await page.locator(esiriId('landing.reserve-btn')).click();

      await expect(page).toHaveURL(/\/rooms$/);
      await shot(page, `${tag}-03-rooms-panel`);
      await page.locator(esiriId('rooms.new-room-btn')).click();
      await shot(page, `${tag}-04-create-room-modal`);
      await page.locator(esiriId('create-room.name-input')).fill('Board Meeting');
      await page.locator(esiriId('create-room.submit')).click();
      await expect(page.getByTestId('room-title')).toHaveText('Board Meeting');
      await shot(page, `${tag}-05-room-recordings`);
      await page.locator(esiriId('room.tab.presentation')).click();
      await page.locator(esiriId('presentation.sample.meeting-agenda.add')).click();
      await shot(page, `${tag}-06-room-presentation`);
      await page.locator(esiriId('room.tab.access')).click();
      await page.locator(esiriId('access.share-btn')).click();
      await shot(page, `${tag}-07-share-access-modal`);
      await page.locator(esiriId('access.user.neema-mwakalinga.add')).click();
      await page.locator(esiriId('access.modal.close')).click();
      await shot(page, `${tag}-08-room-access`);
      await page.locator(esiriId('room.tab.settings')).click();
      await page.locator(esiriId('settings.viewer-code.generate')).click();
      await shot(page, `${tag}-09-room-settings`);

      await page.locator(esiriId('room.start-meeting')).click();
      await page.locator(esiriId('meeting.chat-input')).fill('Good morning everyone');
      await page.locator(esiriId('meeting.chat-send')).click();
      await page.locator(esiriId('meeting.camera-toggle')).click();
      await page.locator(esiriId('meeting.record-toggle')).click();
      const bottom = await page.locator('.mt-bottombar').boundingBox();
      expect(bottom && bottom.y + bottom.height, 'meeting bottom bar fits the viewport').toBeLessThanOrEqual(size.h + 1);
      await shot(page, `${tag}-10-meeting-panel`);
      await page.locator(esiriId('meeting.leave')).click();

      await page.goto('/recordings');
      await openPanel(page);
      await shot(page, `${tag}-11-recordings`);

      await page.goto('/audit');
      await openPanel(page);
      // A sample conversation in the panel, to check the message styles.
      await page.evaluate(() => {
        const es = (window as any).__esiriTest.useEsiri.getState();
        es.addMsg({ kind: 'user', text: 'Create a room called Board Meeting', mode: 'voice' });
        es.addMsg({ kind: 'step', text: "Clicked '+ New Room'", status: 'ok', icon: 'click' });
        es.addMsg({ kind: 'step', text: "Typed 'Board Meeting'", status: 'ok', icon: 'type' });
        es.addMsg({ kind: 'confirm', summary: 'Create a new room called Board Meeting?', state: 'approved' });
        es.addMsg({ kind: 'step', text: "Clicked 'Create Room'", status: 'ok', icon: 'click' });
        es.addMsg({ kind: 'assistant', text: 'I created the room Board Meeting for you.' });
        es.addMsg({ kind: 'confirm', summary: 'Start the meeting now?', state: 'pending' });
      });
      await shot(page, `${tag}-12-audit`);
    });
  }
}
