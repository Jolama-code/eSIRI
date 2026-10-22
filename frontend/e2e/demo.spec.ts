/**
 * The README demo script as one continuous conversation (memory across tasks,
 * follow-ups, state questions, language switch). Needs OPENAI_API_KEY.
 */
import { test, expect } from '@playwright/test';
import { askEsiri, esiriId, roomByName, startSignedIn, store } from './helpers';

test('demo script end to end (English + Swahili) @llm', async ({ page, request }) => {
  const health = await (await request.get('http://localhost:8010/api/health')).json();
  test.skip(!health.has_key, 'needs OPENAI_API_KEY in .env');
  test.setTimeout(600_000);
  await startSignedIn(page);

  // 1
  await askEsiri(page, 'Create a room called Board Meeting.');
  const room = (await roomByName(page, 'Board Meeting'))!;
  expect(room).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));

  // 2
  await askEsiri(page, 'Open the settings, turn on mute users on join, and give me a viewer access code.');
  let r = (await roomByName(page, 'Board Meeting'))!;
  expect(r.settings.muteOnJoin).toBe(true);
  expect(r.viewerCode).toMatch(/^\d{6}$/);

  // state question answered from the snapshot, digits spoken separately
  await askEsiri(page, 'What is the viewer code?');
  const reply = (await page.getByTestId('esiri-reply').last().textContent()) ?? '';
  expect(reply.replace(/\D/g, '')).toContain(r.viewerCode!);

  // follow-up relying on conversation memory
  await askEsiri(page, 'Actually, turn it off again.');
  r = (await roomByName(page, 'Board Meeting'))!;
  expect(r.settings.muteOnJoin).toBe(false);
  await askEsiri(page, 'Turn mute users on join back on.');
  r = (await roomByName(page, 'Board Meeting'))!;
  expect(r.settings.muteOnJoin).toBe(true);

  // 3
  await askEsiri(page, 'Share access with Neema Mwakalinga.');
  r = (await roomByName(page, 'Board Meeting'))!;
  expect(r.sharedUsers).toContain('neema-mwakalinga');

  // 4
  await askEsiri(page, 'Add the meeting agenda to the presentation.');
  r = (await roomByName(page, 'Board Meeting'))!;
  expect(r.presentation.map((f) => f.name)).toContain('Meeting_Agenda.pdf');

  // 5
  await askEsiri(page, 'Start the meeting and tell everyone good morning in the chat.');
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}/meeting$`));
  await expect(page.getByTestId('chat-messages')).toContainText(/good morning/i);
  await expect(page.getByTestId('slide-title')).toHaveText('Meeting_Agenda.pdf');
  await expect(page.locator(esiriId('meeting.mic-toggle'))).toHaveAttribute('data-esiri-state', 'off');

  // 6
  await askEsiri(page, 'Start recording.');
  await expect(page.locator(esiriId('meeting.record-toggle'))).toHaveAttribute('data-esiri-state', 'on');
  await page.waitForTimeout(2000);
  await askEsiri(page, 'Stop recording and leave the meeting.');
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
  expect((await store(page)).recordings.filter((x) => x.roomId === room.id)).toHaveLength(1);

  // 7
  await askEsiri(page, 'Speak Swahili.');
  expect((await store(page)).language).toBe('sw');
  await askEsiri(page, 'Tengeneza chumba kiitwacho Kikao cha Bodi.');
  expect(await roomByName(page, 'Kikao cha Bodi')).toBeTruthy();

  // 8
  await askEsiri(page, 'Fungua kumbukumbu za ukaguzi.');
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByTestId('audit-row').first()).toBeVisible();

  const audit = (await store(page)).audit;
  expect(audit.length).toBeGreaterThanOrEqual(12);
  expect(audit.every((a) => a.outcome === 'Completed')).toBe(true);
});
