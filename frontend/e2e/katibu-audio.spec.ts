/**
 * Honest audio for KatibuAI (no LLM; nothing reaches KatibuAI): live mode never falls back to the sample
 * silently, the meeting shows the sample player in sample mode, and Leave without a usable recording asks
 * whether to use the sample.
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, auth, esiriId, resetDemo, signIn } from './helpers';

/** A WAV file of `secs` seconds of silence (16 kHz mono). */
function silentWav(secs: number): Buffer {
  const n = 16000 * secs;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
});

test('live mode: a missing, short or silent recording is refused (live_unusable), never replaced silently', async ({ request }) => {
  const { token } = await apiLogin(request, 'jolama');
  const post = (multipart: Record<string, any>) => request.post(`${API}/api/katibu/jobs`, { headers: auth(token), multipart: { room_id: 'kamati-ya-bajeti-k7b2', ...multipart } });
  const none = await post({});
  expect(none.status()).toBe(422);
  expect(await none.json()).toMatchObject({ code: 'live_unusable', reason: 'no_recording' });
  const short = await post({ audio: { name: 'short.wav', mimeType: 'audio/wav', buffer: silentWav(3) } });
  expect(await short.json()).toMatchObject({ code: 'live_unusable', reason: 'too_short' });
  const silent = await post({ audio: { name: 'silent.wav', mimeType: 'audio/wav', buffer: silentWav(25) } });
  expect(await silent.json()).toMatchObject({ code: 'live_unusable', reason: 'silent' });
  const jobs = await (await request.get(`${API}/api/katibu/jobs`, { headers: auth(token) })).json();
  expect(jobs).toHaveLength(0); // nothing was sent to KatibuAI
});

test('sample mode: the meeting shows "Inacheza rekodi ya mfano" and the badge says the sample goes to KatibuAI', async ({ page, request }) => {
  const { token } = await apiLogin(request, 'jolama');
  await request.patch(`${API}/api/me`, { headers: auth(token), data: { meeting_audio_source: 'sample' } });
  await signIn(page, 'jolama', '/rooms/kamati-ya-bajeti-k7b2', 'sw');
  await page.locator(esiriId('room.start-meeting')).click();
  await expect(page.getByTestId('meeting')).toBeVisible();
  await expect(page.getByTestId('sample-player')).toContainText('Inacheza rekodi ya mfano');
  await expect(page.getByTestId('katibu-recording')).toContainText('Rekodi ya mfano kwa KatibuAI');
  await expect(page.getByTestId('katibu-timer')).toBeVisible();
});

test('Leave without a usable live recording: NURU says why and asks about the sample; "Hapana" sends nothing', async ({ page, request }) => {
  await signIn(page, 'jolama', '/rooms/kamati-ya-bajeti-k7b2', 'sw');
  await page.locator(esiriId('room.start-meeting')).click();
  await expect(page.getByTestId('meeting')).toBeVisible();
  await page.locator(esiriId('meeting.leave')).click();
  await page.getByTestId('minutes-offer-yes').click();
  const card = page.getByTestId('minutes-offer');
  await expect(card).toContainText('Rekodi halisi ya kikao hiki haiwezi kutumika');
  await expect(page.getByTestId('minutes-offer-yes')).toHaveText(/Ndiyo, tumia ya mfano/);
  await page.getByTestId('minutes-offer-no').click();
  await expect(card).toHaveCount(0);
  const { token } = await apiLogin(request, 'jolama');
  const jobs = await (await request.get(`${API}/api/katibu/jobs`, { headers: auth(token) })).json();
  expect(jobs).toHaveLength(0);
});
