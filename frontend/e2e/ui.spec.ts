/**
 * Tests that do not need the LLM: the e-Mikutano mockup works for a human,
 * the language toggle, token join, the confirmation gate and the snapshot.
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, auth, createRoomByHand, esiriId, openPanel, signIn, startSignedIn, store } from './helpers';

test.describe('e-Mikutano mockup (human, no LLM)', () => {
  test('landing page branding, no forbidden names, health check', async ({ page, request }) => {
    const health = await (await request.get('http://localhost:8010/api/health')).json();
    expect(health.ok).toBe(true);
    await page.goto('/?mute=1');
    await page.locator(esiriId('landing.lang.en')).click();
    await expect(page.locator('.gov-title')).toHaveText('Jamhuri ya Muungano wa Tanzania');
    await expect(page.locator('.gov-subtitle')).toHaveText('Mfumo Wa Mawasiliano Kwa Njia ya Video');
    await expect(page.locator('img.coat-lg')).toBeVisible();
    await expect(page.getByText('Conduct a Meeting through the Internet, Anywhere and Anytime')).toBeVisible();
    await expect(page.getByText('© 2020 – 2026 e-GA. All rights reserved. | e-Mikutano version 4.0 (NURU PoC)')).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/Joseph Laurent/i);
    expect(html).not.toMatch(/BigBlueButton/i);
  });

  test('single sign-on gate: /rooms needs the NURU sign-in, then shows the seeded rooms', async ({ page }) => {
    await page.goto('/rooms?mute=1');
    await expect(page).toHaveURL(/\/hub\/login\?next=%2Frooms/);
    await page.goto('/?mute=1');
    await page.locator(esiriId('landing.lang.en')).click();
    await page.locator(esiriId('landing.reserve-btn')).click();
    await expect(page).toHaveURL(/\/hub\/login\?next=/);
    await page.getByTestId('login-username').fill('jolama');
    await page.getByTestId('login-password').fill('Demo@2026');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.getByTestId('room-card')).toHaveCount(2);
    await expect(page.getByText('Kamati ya Bajeti')).toBeVisible();
    await expect(page.getByText("Jolama's Room")).toBeVisible();
    await expect(page.getByText('Last Session: September 25, 2026 at 11:11 AM')).toBeVisible();
  });

  test('language toggle switches the whole UI to Swahili and back', async ({ page }) => {
    await signIn(page, 'jolama', '/', 'en');
    await page.locator(esiriId('landing.lang.sw')).click();
    await expect(page.getByText('Fanya Mkutano kupitia Mtandao, Mahali Popote na Wakati Wowote')).toBeVisible();
    await expect(page.locator(esiriId('landing.reserve-btn'))).toHaveText('Hifadhi mkutano');
    await page.locator(esiriId('landing.reserve-btn')).click();
    await expect(page.locator(esiriId('rooms.tab.rooms'))).toHaveText('Vyumba');
    await expect(page.locator(esiriId('rooms.new-room-btn'))).toHaveText('+ Chumba Kipya');
    // the panel language chip is the same setting
    await openPanel(page);
    await page.getByTestId('esiri-lang-chip').click();
    await expect(page.locator(esiriId('rooms.tab.rooms'))).toHaveText('Rooms');
    expect((await store(page)).language).toBe('en');
    // title stays in Swahili in both languages
    await page.goto('/');
    await expect(page.locator('.gov-title')).toHaveText('Jamhuri ya Muungano wa Tanzania');
  });

  test('token join: invalid token shows an error, valid token opens the meeting, ?token= pre-fills', async ({ page }) => {
    await page.goto('/?mute=1');
    await page.locator(esiriId('landing.token-input')).fill('NOPE-0000');
    await page.locator(esiriId('landing.join-btn')).click();
    await expect(page.getByTestId('token-error')).toBeVisible();
    await page.goto('/?token=JLM-7K2Q');
    await expect(page.locator(esiriId('landing.token-input'))).toHaveValue('JLM-7K2Q');
    await page.locator(esiriId('landing.join-btn')).click();
    await expect(page).toHaveURL(/\/rooms\/jolamas-room-r7k2\/meeting$/);
    await expect(page.getByTestId('meeting')).toBeVisible();
  });

  test('human create-room flow with validation, toast and search', async ({ page }) => {
    await startSignedIn(page);
    await page.locator(esiriId('rooms.new-room-btn')).click();
    await page.locator(esiriId('create-room.submit')).click();
    await expect(page.getByText('Please enter a room name.')).toBeVisible();
    await page.locator(esiriId('create-room.name-input')).fill('  Board Meeting  ');
    await page.locator(esiriId('create-room.submit')).click();
    await expect(page).toHaveURL(/\/rooms\/board-meeting-[a-z0-9]{4}$/);
    await expect(page.getByTestId('room-title')).toHaveText('Board Meeting');
    await expect(page.getByText('A new room has been created.')).toBeVisible();
    await expect(page.getByText('No previous session created')).toBeVisible();
    const room = (await store(page)).rooms.find((r) => r.name === 'Board Meeting')!;
    expect(room.token).toMatch(/^BRD-[A-Z0-9]{4}$/);
    await page.locator(esiriId('room.home-btn')).click();
    await expect(page.getByTestId('room-card')).toHaveCount(3);
    await page.locator(esiriId('rooms.search')).fill('board');
    await expect(page.getByTestId('room-card')).toHaveCount(1);
  });

  test('room tabs: settings, access codes, access sharing, presentation, rename, delete', async ({ page }) => {
    await startSignedIn(page);
    const id = await createRoomByHand(page, 'Budget Review');
    await page.locator(esiriId('room.tab.settings')).click();
    const mute = page.locator(esiriId('settings.toggle.mute-on-join'));
    await expect(mute).toHaveAttribute('data-esiri-state', 'off');
    await mute.click();
    await expect(mute).toHaveAttribute('data-esiri-state', 'on');
    await expect(page.locator(esiriId('settings.toggle.allow-recording'))).toHaveAttribute('data-esiri-state', 'on');
    await page.locator(esiriId('settings.viewer-code.generate')).click();
    await expect(page.getByTestId('viewer-code')).toHaveText(/\d{6}/);
    await page.locator(esiriId('settings.viewer-code.delete')).click();
    await expect(page.getByTestId('viewer-code')).not.toHaveText(/\d{6}/);
    await page.locator(esiriId('settings.moderator-code.generate')).click();
    await expect(page.getByTestId('moderator-code')).toHaveText(/\d{6}/);

    await page.locator(esiriId('room.tab.access')).click();
    await page.locator(esiriId('access.share-btn')).click();
    await page.locator(esiriId('access.search-input')).fill('neema');
    await page.locator(esiriId('access.user.neema-mwakalinga.add')).click();
    await page.locator(esiriId('access.modal.close')).click();
    await expect(page.getByTestId('shared-user')).toHaveText(/Neema Mwakalinga/);
    await page.locator(esiriId('access.shared.neema-mwakalinga.remove')).click();
    await expect(page.getByTestId('shared-user')).toHaveCount(0);

    await page.locator(esiriId('room.tab.presentation')).click();
    await page.locator(esiriId('presentation.sample.meeting-agenda.add')).click();
    await page.locator(esiriId('presentation.sample.previous-minutes.add')).click();
    await expect(page.getByTestId('presentation-files')).toContainText('Meeting_Agenda.pdf');
    await expect(page.getByTestId('presentation-files')).toContainText('Default presentation');
    await page.locator('input[type=file]').setInputFiles({ name: 'Notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByTestId('presentation-files')).toContainText('Notes.pdf');

    await page.locator(esiriId('room.tab.settings')).click();
    await page.locator(esiriId('settings.room-name-input')).fill('Budget Review 2026');
    await page.locator(esiriId('settings.room-name-save')).click();
    await expect(page.getByTestId('room-title')).toHaveText('Budget Review 2026');
    await page.locator(esiriId('settings.delete-room')).click();
    await page.locator(esiriId('delete-room.cancel')).click();
    await expect(page.getByTestId('room-title')).toBeVisible();
    await page.locator(esiriId('settings.delete-room')).click();
    await page.locator(esiriId('delete-room.confirm')).click();
    await expect(page).toHaveURL(/\/rooms$/);
    expect((await store(page)).rooms.some((r) => r.id === id)).toBe(false);
  });

  test('meeting: chat, notes, mic (mute on join), camera, screen share, reactions, hand, recording, leave', async ({ page }) => {
    await startSignedIn(page);
    const id = await createRoomByHand(page, 'Weekly Sync');
    await page.locator(esiriId('room.tab.settings')).click();
    await page.locator(esiriId('settings.toggle.mute-on-join')).click();
    await page.locator(esiriId('room.start-meeting')).click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${id}/meeting$`));
    await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'off');
    await page.locator(esiriId('meeting.mic-toggle')).click();
    await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'on');

    await page.locator(esiriId('meeting.chat-input')).fill('Habari za asubuhi');
    await page.locator(esiriId('meeting.chat-send')).click();
    await expect(page.getByTestId('chat-message')).toHaveText(['Habari za asubuhi']);
    await page.locator(esiriId('meeting.panel.shared-notes')).click();
    await page.locator(esiriId('meeting.notes-input')).fill('Agenda: budget');
    await expect(page.getByTestId('notes')).toHaveValue('Agenda: budget');

    await page.locator(esiriId('meeting.camera-toggle')).click();
    await expect(page.getByTestId('webcam-tile')).toBeVisible();
    await page.locator(esiriId('meeting.screenshare-toggle')).click();
    await expect(page.getByTestId('share-banner')).toBeVisible();
    await page.locator(esiriId('meeting.reactions-btn')).click();
    await page.locator(esiriId('meeting.reaction.clap')).click();
    await expect(page.locator('.float-emoji')).toHaveText('👏');
    await page.locator(esiriId('meeting.raise-hand')).click();
    await expect(page.getByTestId('hand-indicator')).toBeVisible();

    await page.locator(esiriId('meeting.record-toggle')).click();
    await expect(page.locator(esiriId('meeting.record-toggle'))).toHaveAttribute('data-esiri-state', 'on');
    await page.waitForTimeout(2200);
    await page.locator(esiriId('meeting.record-toggle')).click();
    await expect(page.getByText('The recording has been saved to the room.')).toBeVisible();
    await page.locator(esiriId('meeting.leave')).click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${id}$`));
    const s = await store(page);
    const recs = s.recordings.filter((r) => r.roomId === id);
    expect(recs).toHaveLength(1);
    expect(recs[0].durationSec).toBeGreaterThanOrEqual(2);
    expect(recs[0].name).toMatch(/^Weekly Sync – /);
    expect(s.rooms.find((r) => r.id === id)!.lastSession).not.toBeNull();
    await expect(page.getByTestId('recording-row')).toHaveCount(1);
  });

  test('recording is disabled when "Allow recording" is off', async ({ page }) => {
    await startSignedIn(page);
    await createRoomByHand(page, 'No Recording Room');
    await page.locator(esiriId('room.tab.settings')).click();
    await page.locator(esiriId('settings.toggle.allow-recording')).click();
    await page.locator(esiriId('room.start-meeting')).click();
    await expect(page.locator(esiriId('meeting.record-toggle'))).toBeDisabled();
  });

  test('user menu: audit log, reset demo data, sign out', async ({ page }) => {
    await startSignedIn(page);
    await createRoomByHand(page, 'Temporary');
    await page.locator(esiriId('header.user-menu')).click();
    await page.locator(esiriId('header.menu.audit-log')).click();
    await expect(page).toHaveURL(/\/audit$/);
    await expect(page.getByText('No NURU tasks have been recorded yet.')).toBeVisible();
    await page.locator(esiriId('header.user-menu')).click();
    await page.locator(esiriId('header.menu.reset-demo')).click();
    await expect(page).toHaveURL(/\/rooms$/);
    await expect(page.getByTestId('room-card')).toHaveCount(2);
    await page.locator(esiriId('header.user-menu')).click();
    await page.locator(esiriId('header.menu.sign-out')).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('audit page: rows expand, filters, CSV export, clear with confirmation', async ({ page }) => {
    await startSignedIn(page);
    await page.evaluate(() => {
      const app = (window as any).__esiriTest.useApp.getState();
      const base = { user: 'Jolama', language: 'en', inputMode: 'text', finalMessage: 'Done.', durationMs: 4200 };
      app.addAudit({ ...base, id: 'a1', timestamp: new Date().toISOString(), request: 'Create a room called X', outcome: 'Completed',
        steps: [{ time: new Date().toISOString(), tool: 'click', target: '+ New Room', ok: true }],
        confirmations: [{ summary: 'Create room X?', result: 'approved' }] });
      app.addAudit({ ...base, id: 'a2', timestamp: new Date().toISOString(), request: 'Delete room X', outcome: 'Declined', steps: [],
        confirmations: [{ summary: 'Delete room X?', result: 'declined' }] });
    });
    await page.goto('/audit');
    await expect(page.getByTestId('audit-row')).toHaveCount(2);
    await page.locator(esiriId('audit.filter.declined')).click();
    await expect(page.getByTestId('audit-row')).toHaveCount(1);
    await page.locator(esiriId('audit.filter.all')).click();
    await page.getByTestId('audit-row').last().click();
    await expect(page.getByText('“Create room X?”')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator(esiriId('audit.export-csv')).click()]);
    const csv = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString('utf8');
    expect(text).toContain('Create a room called X');
    expect(text).toContain('Declined');
    await page.locator(esiriId('audit.clear')).click();
    await page.locator(esiriId('audit.clear-confirm')).click();
    await expect(page.getByTestId('audit-row')).toHaveCount(0);
  });
});

test.describe('eSiri runtime (no LLM)', () => {
  test('orb + Alt+S open the panel; Esc closes nothing when idle; suggestions shown', async ({ page }) => {
    await startSignedIn(page);
    await expect(page.getByTestId('esiri-orb')).toBeVisible();
    await page.keyboard.press('Alt+s');
    await expect(page.locator('.esiri-panel.open')).toBeVisible();
    await expect(page.getByTestId('esiri-status')).toHaveText('idle');
    await expect(page.getByText('Create a room called Board Meeting')).toBeVisible();
    // content is pushed aside, not covered
    await expect.poll(async () => (await page.locator('.app-shell').boundingBox())!.width).toBeLessThanOrEqual(1366 - 380 + 1);
  });

  test('sensitive clicks are refused without a confirmation (enforced in code)', async ({ page }) => {
    await startSignedIn(page);
    const res = await page.evaluate(async () => {
      const T = (window as any).__esiriTest;
      const signal = new AbortController().signal;
      let credits = 0;
      const ctx = { signal, hasCredit: () => credits > 0, useCredit: () => (credits -= 1) };
      const r1 = await T.click('rooms.new-room-btn', ctx);
      const r2 = await T.typeText('create-room.name-input', 'Gate Test', ctx);
      const r3 = await T.click('create-room.submit', ctx);
      const roomsAfterRefusal = T.useApp.getState().rooms.length;
      credits = 1;
      const r4 = await T.click('create-room.submit', ctx);
      return { r1, r2, r3, r4, roomsAfterRefusal, creditsLeft: credits, rooms: T.useApp.getState().rooms.map((r: any) => r.name) };
    });
    expect(res.r1.ok).toBe(true);
    expect(res.r2.ok).toBe(true);
    expect(res.r3.ok).toBe(false);
    expect(res.r3.code).toBe('confirmation_required');
    expect(res.roomsAfterRefusal).toBe(2);
    expect(res.r4.ok).toBe(true);
    expect(res.creditsLeft).toBe(0);
    expect(res.rooms).toContain('Gate Test');
  });

  test('snapshot lists only modal elements when a modal is open, with labels, state and sensitivity', async ({ page }) => {
    await startSignedIn(page);
    let snap = await page.evaluate(() => (window as any).__esiriTest.buildSnapshot());
    expect(snap.page).toBe('rooms');
    expect(snap.elements.map((e: any) => e.id)).toContain('rooms.new-room-btn');
    const start = snap.elements.find((e: any) => e.id === 'room-card.jolamas-room-r7k2.start');
    expect(start.sensitive).toBe(true);
    await page.locator(esiriId('rooms.new-room-btn')).click();
    snap = await page.evaluate(() => (window as any).__esiriTest.buildSnapshot());
    expect(snap.open_modal).toBe('create-room');
    expect(snap.elements.map((e: any) => e.id).sort()).toEqual(['create-room.close', 'create-room.name-input', 'create-room.submit']);
    await page.locator(esiriId('create-room.close')).click();
    await page.evaluate(() => (window as any).__esiriTest.useApp.getState().setLanguage('sw'));
    snap = await page.evaluate(() => (window as any).__esiriTest.buildSnapshot());
    expect(snap.elements.find((e: any) => e.id === 'rooms.tab.rooms').label).toBe('Vyumba');
  });

  test('backend: TTS returns MP3 audio for Swahili, audit endpoint accepts records (signed in)', async ({ request }) => {
    const health = await (await request.get(`${API}/api/health`)).json();
    test.skip(!health.has_key, 'needs OPENAI_API_KEY');
    expect((await request.post(`${API}/api/tts`, { data: { text: 'x', lang: 'sw' } })).status()).toBe(401);
    const { token } = await apiLogin(request);
    const r = await request.post(`${API}/api/tts`, { headers: auth(token), data: { text: 'Karibu kwenye e-Mikutano.', lang: 'sw' } });
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('audio/mpeg');
    expect((await r.body()).length).toBeGreaterThan(1000);
    const a = await request.post(`${API}/api/audit`, { headers: auth(token), data: { id: 'test', outcome: 'Completed', request: 'e2e audit check' } });
    expect((await a.json()).ok).toBe(true);
  });
});
