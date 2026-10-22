/**
 * Real KatibuAI, end to end with the sample recording. Sends ONLY to KATIBU_TEST_RECIPIENT:
 * the backend forces that address in test mode (NURU_TEST_MODE=1 and the X-Nuru-Test header).
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, auth, resetDemo } from './helpers';

test('KatibuAI: sample recording → READY minutes → sent to the test recipient only @katibu', async ({ request }) => {
  test.setTimeout(900_000);
  await resetDemo(request);
  const { token } = await apiLogin(request, 'jolama');
  const status = await (await request.get(`${API}/api/katibu/status`, { headers: auth(token) })).json();
  test.skip(!status.signed_in, `KatibuAI is not reachable or sign-in failed (${status.last_error || status.base_url}).`);

  const started = Date.now();
  const created = await request.post(`${API}/api/katibu/jobs`, {
    headers: auth(token),
    multipart: { room_id: 'kamati-ya-bajeti-k7b2', use_sample: 'true' },
  });
  expect(created.status()).toBe(200);
  let job = await created.json();
  expect(job.audio_source).toBe('sample');

  const deadline = Date.now() + 10 * 60_000;
  const stages = new Set<string>();
  while (Date.now() < deadline) {
    job = await (await request.get(`${API}/api/katibu/jobs/${job.id}`, { headers: auth(token) })).json();
    if (job.stage) stages.add(job.stage);
    if (job.status === 'ready' || job.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  expect(job.status, JSON.stringify(job.error)).toBe('ready');
  console.log(`KatibuAI processing time: ${job.processing_seconds} s (wall ${Math.round((Date.now() - started) / 1000)} s); stages seen: ${[...stages].join(', ')}`);
  expect(job.minutes_sw.summary?.length).toBeGreaterThan(20);
  expect(job.minutes_en.summary?.length).toBeGreaterThan(20);
  expect(job.documents.some((d: { format: string }) => d.format === 'PDF')).toBe(true);

  // The PDF downloads through NURU's backend.
  const pdf = await request.get(`${API}/api/katibu/jobs/${job.id}/documents/SW/PDF`, { headers: auth(token) });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  // Send: only the test recipient, whatever is asked for.
  const sent = await request.post(`${API}/api/katibu/jobs/${job.id}/send`, { headers: auth(token), data: { recipients: ['someone-else@example.com'] } });
  expect(sent.status()).toBe(200);
  job = await sent.json();
  expect(job.recipients).toHaveLength(1);
  expect(job.recipients).toEqual(job.default_recipients);
  expect(job.recipients[0]).not.toBe('someone-else@example.com');
  expect(job.gms_users).toEqual(expect.arrayContaining([1, 2, 3]));

  // The delivery is recorded.
  await expect
    .poll(async () => {
      const j = await (await request.get(`${API}/api/katibu/jobs/${job.id}`, { headers: auth(token) })).json();
      return j.deliveries.map((d: { email: string; status: string }) => `${d.email}:${d.status}`);
    }, { timeout: 90_000, intervals: [3000] })
    .toEqual([`${job.recipients[0]}:SENT`]);

  // Demo participants received the minutes in GMS.
  const inbox = await (await request.get(`${API}/api/mail?folder=inbox`, { headers: auth(token) })).json();
  expect(inbox.messages.some((m: { from_name: string; subject: string }) => m.from_name === 'KatibuAI' && m.subject.startsWith('Kumbukumbu za kikao'))).toBe(true);
});
