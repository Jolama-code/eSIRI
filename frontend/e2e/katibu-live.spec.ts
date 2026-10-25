/**
 * The real NURU ↔ KatibuAI link with a LIVE recording: Chrome's fake microphone plays a generated Swahili
 * budget meeting (OpenAI TTS; it decides to buy ten computers and names Juma Hassan as responsible), the meeting
 * records it, Leave → "Ndiyo, ziandae" → real KatibuAI → the minutes must mention the computers.
 * Sends nothing by e-mail. Needs OPENAI_API_KEY (to generate the audio once) and KatibuAI on :8000.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, apiLogin, auth, resetDemo } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIO = path.join(here, '.cache', 'budget-meeting.wav');
const ROOT = path.resolve(here, '..', '..');

if (!existsSync(AUDIO)) {
  execFileSync(path.join(ROOT, 'backend', '.venv', 'bin', 'python'), [path.join(ROOT, 'backend', 'scripts', 'make_test_meeting.py'), AUDIO], { stdio: 'inherit' });
}

test.use({
  permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${AUDIO}`] },
});

test('live meeting recording → real KatibuAI → minutes of THIS meeting (ten computers) @katibu', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetDemo(request);
  const { token, user } = await apiLogin(request, 'jolama');
  const status = await (await request.get(`${API}/api/katibu/status`, { headers: auth(token) })).json();
  test.skip(!status.signed_in, `KatibuAI is not reachable or sign-in failed (${status.last_error || status.base_url}).`);
  // Live audio source, no spoken replies (no TTS calls), English UI.
  await request.patch(`${API}/api/me`, { headers: auth(token), data: { meeting_audio_source: 'live', voice_enabled: false, language: 'en' } });

  // Signed in WITHOUT ?mute=1 (mute mode turns the recorder off); skip the unlock overlay and the briefing.
  await page.addInitScript(
    ([tok, u]) => {
      if (sessionStorage.getItem('nuru-test-init')) return;
      sessionStorage.setItem('nuru-test-init', '1');
      localStorage.setItem('nuru-token', tok);
      localStorage.setItem('nuru-user', u);
      localStorage.setItem('nuru-unlocked-v1', '1');
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
      localStorage.setItem(`nuru-briefing-${JSON.parse(u).id}-${today}`, '1');
      localStorage.setItem('emikutano-store', JSON.stringify({ state: { language: 'en' }, version: 2 }));
    },
    [token, JSON.stringify({ ...user, language: 'en' })] as const,
  );
  await page.goto('/rooms/kamati-ya-bajeti-k7b2');
  await page.locator('[data-esiri-id="room.start-meeting"]').click();
  await expect(page.getByTestId('meeting')).toBeVisible();
  await expect(page.getByTestId('katibu-recording')).toContainText('Recording for KatibuAI');
  await expect(page.getByTestId('katibu-meter').locator('i.on').first()).toBeVisible({ timeout: 20_000 }); // sound is coming in
  await page.waitForTimeout(85_000); // the whole generated meeting (81 s)
  await expect(page.getByTestId('katibu-timer')).toHaveText(/01:2\d|01:3\d/);

  await page.locator('[data-esiri-id="meeting.leave"]').click();
  await page.getByTestId('minutes-offer-yes').click();

  // The job: live audio, uploaded in chunks, KatibuAI's meeting id, then READY.
  let job: any = null;
  await expect
    .poll(async () => {
      const jobs = await (await request.get(`${API}/api/katibu/jobs`, { headers: auth(token) })).json();
      job = jobs[0];
      return job?.journey?.recording?.source;
    }, { timeout: 60_000 })
    .toBe('live');
  expect(job.audio_source).toBe('live');
  expect(job.title).toBe('Kikao cha Kamati ya Bajeti'); // the meeting's name
  expect(job.journey.recording.seconds).toBeGreaterThan(60);
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    job = await (await request.get(`${API}/api/katibu/jobs/${job.id}`, { headers: auth(token) })).json();
    if (job.status === 'ready' || job.status === 'failed') break;
    await page.waitForTimeout(5000);
  }
  expect(job.status, JSON.stringify(job.error)).toBe('ready');
  expect(job.journey.upload.chunks_sent).toBe(job.journey.upload.chunks_total);
  expect(job.journey.upload.katibu_uid).toBe(job.katibu_meeting_uid);
  const minutes = JSON.stringify(job.minutes_en) + JSON.stringify(job.minutes_sw);
  expect(minutes).toMatch(/computer|kompyuta/i);
  expect(minutes).toMatch(/ten|kumi|\b10\b/i);

  // The journey panel shows the real path with the play button and KatibuAI's transcript.
  await page.goto(`/hub/minutes/${job.id}`);
  await expect(page.getByTestId('journey-source')).toHaveText('Live recording');
  await expect(page.getByTestId('journey-uid')).toHaveText(job.katibu_meeting_uid);
  await expect(page.getByTestId('journey-step')).toHaveCount(5);
  await expect(page.getByTestId('journey-step').last()).toHaveAttribute('data-state', 'done');
  if (job.journey.transcript?.excerpt) await expect(page.getByTestId('journey-transcript')).toContainText(/kompyuta|computer/i);
});
