/**
 * End-to-end eSiri scenarios driven only through the panel text input (needs OPENAI_API_KEY).
 * Each test gets fresh storage; prerequisites are set up through the human UI.
 * Assertions check the final app state, not the exact steps the model chose.
 */
import { test, expect } from '@playwright/test';
import { askEsiri, createRoomByHand, esiriId, openPanel, roomByName, startSignedIn, store } from './helpers';

test.describe('eSiri agent @llm', () => {
  test.beforeEach(async ({ request }) => {
    const health = await (await request.get('http://localhost:8000/api/health')).json();
    test.skip(!health.has_key, 'needs OPENAI_API_KEY in .env');
  });

  test('1. create a room called Board Meeting', async ({ page }) => {
    await startSignedIn(page);
    await askEsiri(page, 'Create a room called Board Meeting');
    const room = await roomByName(page, 'Board Meeting');
    expect(room, 'room "Board Meeting" exists').toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/rooms/${room!.id}$`));
    await page.locator(esiriId('room.home-btn')).click();
    await expect(page.locator('[data-room-name="Board Meeting"]')).toHaveCount(1);
    const rec = (await store(page)).audit[0];
    expect(rec.outcome).toBe('Completed');
    expect(rec.confirmations.length).toBeGreaterThanOrEqual(1);
    expect(rec.confirmations[0].result).toBe('approved');
  });

  test('2. settings: mute users on join + viewer access code', async ({ page }) => {
    await startSignedIn(page);
    await createRoomByHand(page, 'Board Meeting');
    await askEsiri(page, 'Open the settings and turn on mute users on join, then generate a viewer access code');
    const room = (await roomByName(page, 'Board Meeting'))!;
    expect(room.settings.muteOnJoin).toBe(true);
    expect(room.viewerCode).toMatch(/^\d{6}$/);
    await expect(page.locator(esiriId('settings.toggle.mute-on-join'))).toHaveAttribute('data-esiri-state', 'on');
    await expect(page.getByTestId('viewer-code')).toHaveText(new RegExp(room.viewerCode!));
  });

  test('3. share access with Neema Mwakalinga', async ({ page }) => {
    await startSignedIn(page);
    await createRoomByHand(page, 'Board Meeting');
    await askEsiri(page, 'Share access with Neema Mwakalinga');
    const room = (await roomByName(page, 'Board Meeting'))!;
    expect(room.sharedUsers).toContain('neema-mwakalinga');
    if (!(await page.getByTestId('shared-user').count())) await page.locator(esiriId('room.tab.access')).click();
    await expect(page.getByTestId('shared-user')).toContainText('Neema Mwakalinga');
  });

  test('4. start the meeting and greet in the public chat (mic muted on join)', async ({ page }) => {
    await startSignedIn(page);
    const id = await createRoomByHand(page, 'Board Meeting');
    await page.locator(esiriId('room.tab.settings')).click();
    await page.locator(esiriId('settings.toggle.mute-on-join')).click(); // state from test 2
    await askEsiri(page, "Start the meeting and send 'Good morning everyone' in the public chat");
    await expect(page).toHaveURL(new RegExp(`/rooms/${id}/meeting$`));
    await expect(page.getByTestId('chat-messages')).toContainText('Good morning everyone');
    await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'off');
    const s = await store(page);
    expect(s.meetings[id].chat.map((c) => c.text).join(' ')).toMatch(/Good morning everyone/i);
  });

  test('5. start recording, then stop recording and leave the meeting', async ({ page }) => {
    await startSignedIn(page);
    const id = await createRoomByHand(page, 'Board Meeting');
    await page.locator(esiriId('room.start-meeting')).click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${id}/meeting$`));
    await askEsiri(page, 'Start recording');
    await expect(page.locator(esiriId('meeting.record-toggle'))).toHaveAttribute('data-esiri-state', 'on');
    await page.waitForTimeout(1500);
    await askEsiri(page, 'Stop recording and leave the meeting');
    await expect(page).toHaveURL(new RegExp(`/rooms/${id}$`));
    const recs = (await store(page)).recordings.filter((r) => r.roomId === id);
    expect(recs.length).toBe(1);
    await expect(page.getByTestId('recording-row')).toHaveCount(1);
  });

  test('6. Swahili: Tengeneza chumba kiitwacho Kikao cha Bodi', async ({ page }) => {
    await startSignedIn(page);
    await openPanel(page);
    await page.getByTestId('esiri-lang-chip').click();
    await expect(page.locator(esiriId('rooms.tab.rooms'))).toHaveText('Vyumba');
    await askEsiri(page, 'Tengeneza chumba kiitwacho Kikao cha Bodi');
    const room = await roomByName(page, 'Kikao cha Bodi');
    expect(room, 'room "Kikao cha Bodi" exists (name not translated)').toBeTruthy();
    expect((await store(page)).language).toBe('sw');
    await page.locator(esiriId('header.home')).click();
    await expect(page.locator(esiriId('rooms.tab.rooms'))).toHaveText('Vyumba');
    await expect(page.locator('[data-room-name="Kikao cha Bodi"]')).toHaveCount(1);
    const reply = await page.getByTestId('esiri-reply').last().textContent();
    expect(reply ?? '').not.toMatch(/\b(the|room|created)\b/i); // replied in Swahili
  });

  test('7. decline: deleting Board Meeting is refused', async ({ page }) => {
    await startSignedIn(page);
    await createRoomByHand(page, 'Board Meeting');
    await page.locator(esiriId('room.home-btn')).click();
    await askEsiri(page, 'Delete the room Board Meeting', { confirm: 'no' });
    expect(await roomByName(page, 'Board Meeting')).toBeTruthy();
    const rec = (await store(page)).audit[0];
    expect(rec.outcome).toBe('Declined');
    expect(rec.confirmations.some((c) => c.result === 'declined')).toBe(true);
    expect(rec.confirmations.length, 'eSiri must not ask again after a decline').toBe(1);
  });

  test('8. cancel with Esc while eSiri is acting', async ({ page }) => {
    await startSignedIn(page);
    await openPanel(page);
    await page
      .getByTestId('esiri-input')
      .fill("Open Rahma Mbuyu's Room, go to the settings, turn on mute users on join, turn on require moderator approval and generate a moderator access code");
    await page.getByTestId('esiri-send').click();
    const status = page.getByTestId('esiri-status');
    const deadline = Date.now() + 90_000;
    let pressed = false;
    while (Date.now() < deadline) {
      const yes = page.getByTestId('esiri-confirm-yes');
      if ((await yes.count()) && (await yes.first().isVisible())) await yes.first().click();
      const s = await status.textContent();
      if (s === 'acting') {
        await page.keyboard.press('Escape');
        pressed = true;
        break;
      }
      if (s === 'idle') break;
      await page.waitForTimeout(50);
    }
    expect(pressed, 'status reached "acting" and Esc was pressed').toBe(true);
    await expect(status).toHaveText('idle', { timeout: 5_000 });
    const rec = (await store(page)).audit[0];
    expect(rec.outcome).toBe('Cancelled');
    // nothing keeps running after the cancel
    const before = JSON.stringify((await store(page)).rooms);
    await page.waitForTimeout(3000);
    expect(JSON.stringify((await store(page)).rooms)).toBe(before);
    await expect(status).toHaveText('idle');
  });
});
