# NURU v2 — feature checklist (from the code as built)

Built from the code at commit `30e3ff8`, **updated for v2.1** (branch `feature/v2.1`): the growing typing box, the honest KatibuAI recording with the minutes journey, and the WERIS weekly report (new section E). The presented version stays runnable in `../eSIRI-demo` (see `docs/DEMO_FALLBACK.md`). Use it to rehearse: tick each row once you have tried it.

**Test column legend**

| Mark | Meaning |
|---|---|
| ✅ | An automated test covers it and passed in the latest run |
| ⚠️ | An automated test covers it, but it was flaky or has not been re-run since the last fix |
| 🖐 | Implemented in code, but tested only by hand (or not at all) |
| ⛔ | **NOT SUPPORTED — do not try it on stage** |

**Test files** (full run on `feature/v2.1`, 25 October 2026, evening: 73 passed, 2 flaky, 2 failed)
- `v2.spec`: no LLM. 16 tests; all passed (1 flaky on a server error that is now fixed: the event stream held database connections).
- `v2-agent.spec`: `@llm`. All 8 passed (#4 flaky on the same server error).
- `agent.spec`: v1, `@llm`. 8 tests; all passed (the helper now resets the demo data first).
- `demo.spec`: `@llm`. Passed. It can still be flaky (about 1 run in 6).
- `ui.spec`, `screenshots*.spec`: passed.
- `mobile.spec`: 5 tests (new: typing on a phone). Passed.
- `typing.spec` (new): 4 tests; the growing typing box in the Hub, GMS, WERIS and e-Mikutano. Passed.
- `katibu-audio.spec` (new): 3 tests; honest audio, sample player, the question after Leave. Passed.
- `weris-report.spec` (new): 5 tests; no LLM. Passed.
- `weris-report-agent.spec` (new): `@llm`, 4 tests (A, B, C, confirm). Passed.
- `katibu.spec` and `katibu-live.spec` (`@katibu`, real KatibuAI): **failed because KatibuAI did not finish within 10 minutes** (its jobs sit at TRANSCRIBE today). Everything up to KatibuAI passed in `katibu-live`: live fake-microphone audio, the meter, the timer, a live job named after the meeting with more than 60 s of audio. Re-run them once KatibuAI is healthy.

**Accounts**
- `jolama`: staff, supervisor Dkt. Halima.
- `halima`: Dkt. Halima Said, supervisor.
- `baraka`: Baraka Mollel, staff.
- All three use the password `Demo@2026`.
- Neema, Juma and Zawadi exist in the directory but **have no account**: they never receive anything live.

**Today is Sunday 25 October 2026.** "Ijumaa" / "Friday" means **30 October**. "Kesho" / "tomorrow" means Monday 26 October.

---

## (A) WERIS and task assignment (NURU-to-NURU)

| ✓ | # | Scenario | Swahili (say or type) | English / clicks | Account · device | What happens on screen · what NURU says | Test | Limits / notes |
|---|---|---|---|---|---|---|---|---|
| ☐ | A1 | Supervisor assigns a task by voice | "Mpe Jolama kazi ya kuandaa ripoti ya bajeti ya robo ya tatu, iwe tayari Ijumaa saa nane mchana." | "Give Jolama the task of preparing the third-quarter budget report, due Friday at 2 p.m." | halima · C | The cursor does the steps: WERIS → Kazi Maalum → **Ongeza Kazi Maalum** → picks Jolama → types the title → end date (next Friday) → 14:00. NURU asks "Nimpe Jolama kazi hii…?" → **"Ndiyo"** → the row appears; NURU confirms in one sentence. | ⚠️ v2-agent #4 (passed in the isolated run; OpenAI 504s in the full run) | The model computes the date; check the date field before saying yes. Swahili clock phrases are converted in code. |
| ☐ | A2 | Assign a task by hand | — | WERIS → Kazi Maalum → **Ongeza Kazi Maalum** → Mhusika = Jolama, title, end date, time → **Wasilisha** | halima · C | The row appears in the list. No confirmation, because human clicks are never gated. | ✅ v2 "WERIS NURU-to-NURU" | With an end date but no time, the due time defaults to **17:00**. |
| ☐ | A3 | The assignee's NURU announces the task live | — | (happens after A1/A2) | jolama · A and B (every device signed in as jolama) | Within 3 s: a toast "Kazi mpya" plus speech: "Jolama, umepewa kazi mpya na Dkt. Halima Said: …, iwe tayari Ijumaa … saa nane mchana." Hub Tasks, the Today timeline and the notification bell refresh. | ✅ v2 (event in under 3 s, toast checked) | Speech needs audio unlocked ("Gusa ili kuanza"). A browser that is closed gets nothing: there is no web push. |
| ☐ | A4 | Staff reports "finished" by voice | "Mwambie Dkt. Halima nimemaliza kazi ya ripoti ya bajeti." | "Tell Dkt. Halima I've finished the budget report." | jolama · A or B | NURU finds the task in WERIS and sets the status select to **Done**. No confirmation. NURU confirms. Halima's device: toast plus speech "Dkt. Halima, Jolama amekamilisha kazi: …". | ⚠️ v2-agent #5 (as A1) | The task title must be recognisable from what you say. |
| ☐ | A5 | Staff reports "started" by voice | "Mwambie Dkt. Halima nimeanza kazi ya ripoti ya bajeti." | "Tell Dkt. Halima I've started the budget report." | jolama · B | Status → **In progress**. Halima hears "…Jolama ameanza kazi: …". | 🖐 (same code path as A4; only "done" is automated) | |
| ☐ | A6 | Change status by hand in the Hub | — | Hub → **Kazi** → status select on the row → Done / In progress | jolama · A or B | Halima gets a toast and speech, and her WERIS row shows DONE. | ✅ v2 | Only the assignee can change status in the UI. |
| ☐ | A7 | Change status by hand in WERIS | — | WERIS → Kazi Maalum → status select on own row | jolama · A | Same as A6. | 🖐 (same API as A6) | The select appears only on your own tasks (`can_change_status`). |
| ☐ | A8 | Confirmation gate on assigning | (A1, then say **"Hapana"**) | "No" | halima · C | Nothing is submitted; NURU acknowledges and does not ask again. The audit says **Declined**. | ✅ gate refuses submit without a yes (v2 "safety gates"); 🖐 the spoken decline in WERIS | Declining is automated for GMS and room delete, not for WERIS. |
| ☐ | A9 | Change request instead of yes/no | (at the confirmation) "Badilisha muda iwe saa tisa." | "Change the time to 3 p.m." | halima · C | An answer of 2+ words that is not yes/no is a change request: NURU edits the form and asks again. | 🖐 | |
| ☐ | A10 | Assign a task to yourself | "Nipe kazi ya kukagua seva kesho saa tano." | "Give me a task to check the servers tomorrow at 11." | any | No confirmation (not sensitive), no announcement. The task appears in My tasks. | ✅ the not-sensitive attribute is checked; 🖐 by voice | |
| ☐ | A11 | Staff assigns to the supervisor | "Mpe Dkt. Halima kazi ya kupitia rasimu ya sera, iwe tayari kesho saa nne." | "Give Dkt. Halima the task of reviewing the draft policy…" | jolama · A | Gated like A1; Halima's NURU announces it. | 🖐 | Allowed: there is no role check on who may assign. |
| ☐ | A12 | Task due-time reminder | (automatic) | — | assignee, all devices | **30 minutes** before the due time: a reminder card plus speech: "Jolama, kazi "…" inatakiwa iwe tayari baada ya dakika 30." **"Ndiyo"** opens WERIS tasks; **"Baadaye"** snoozes 5 min; **"Hapana"** closes it. | 🖐 (the reminder mechanics are automated for meetings) | Only tasks that have a due date. The lead time is fixed at 30 min (the Settings lead time applies to meetings and day items). |
| ☐ | A13 | "What are my tasks?" | "Nina kazi gani leo?" | "What tasks do I have?" | jolama | NURU answers from the screen data (title, due date, status) without opening anything. | 🖐 | Best asked from the Hub. |
| ☐ | A14 | Supervisor asks about progress | "Jolama amefikia wapi na kazi ya ripoti ya bajeti?" | "How far is Jolama with the budget report?" | halima · C | Answered from `tasks_i_assigned` (status, due). | 🖐 | Status only: there are no progress notes or percentages. |
| ☐ | A15 | Supervisor's "tasks I assigned" tab | — | Hub → Kazi → **Nilizogawa** tab | halima | Lists the tasks she gave, live. | ✅ screenshots only | Supervisors only. |
| ☐ | A16 | Missing information | "Mpe kazi ya kuandaa ripoti." (no name) | "Give a task to prepare a report." | halima | NURU asks one short question ("Nimpe nani?"), then continues with your answer. | 🖐 | |
| ☐ | A17 | Form validation by hand | — | Wasilisha with no assignee or no title | any | "Chagua kazi hii ni ya nani." / "Weka jina la kazi." | 🖐 | |
| ☐ | A18 | Two devices of the same user stay in sync | — | Change a status on A; watch B | jolama · A + B | B's Hub task list refreshes live. | ✅ (task events reach every session) | Through `--share`, phones use long-polling (about 1 s delay). |
| ☐ | A19 | Task for a person without an account | "Mpe Neema kazi ya …" | | halima | The task is saved in WERIS, but **no one is notified** (Neema has no account). | 🖐 | Don't use Neema/Juma/Zawadi for the live hand-off; use **jolama** or **baraka**. |
| ☐ | A20 | Weekly report in WERIS | see **section E** | | jolama | The old single text box is replaced by the individual report (Projects / Assignments / PDPs) that NURU fills. | ✅ weris-report.spec, weris-report-agent.spec | **Submitting is now a sensitive action** (`weris.report.submit`, gated in code): NURU asks "Niwasilishe ripoti hii?" first. Human clicks are not gated. |
| ☐ | A21 | Other WERIS pages | "Fungua miradi" / "Ongeza mradi uitwao …" / "Ongeza ujuzi kwenye PDP …" | Projects: filter, search, export, add; PDP: add an entry; Dashboard | any | They work visibly, by hand or by voice. | ✅ screenshots only; 🖐 by voice | Mock data. Export is CSV only. |
| ☐ | A22 | Task notifications in the bell | — | Hub → Taarifa | assignee | Stored notifications; **Weka zote zimesomwa** marks them read. | 🖐 | |
| ☐ | A23 | ⛔ Edit, re-assign or delete a task | — | — | — | **Not supported** in the UI or by voice. | ⛔ | |
| ☐ | A24 | ⛔ Supervisor changes the staff member's status | — | — | — | **Not supported** in the UI (the API allows it). | ⛔ | |
| ☐ | A25 | ⛔ One task for several people, recurring tasks, attachments, comments | — | — | — | **Not supported.** | ⛔ | |
| ☐ | A26 | ⛔ Announcement to a closed browser or a locked phone without the page open | — | — | — | **No web push.** A system notification appears only while the page is open in the background and notifications are allowed. | ⛔ | Keep B's browser open on the Hub. |

---

## (B) e-Mikutano meetings, moderator mode and KatibuAI minutes

| ✓ | # | Scenario | Swahili (say or type) | English / clicks | Account · device | What happens on screen · what NURU says | Test | Limits / notes |
|---|---|---|---|---|---|---|---|---|
| ☐ | B1 | Meeting reminder on every device | (automatic, 5 min before by default; or demo panel → **Toa kikumbusho kinachofuata sasa**) | — | jolama · A + B | A card plus speech: "Jolama, una Kikao cha Kamati ya Bajeti baada ya dakika 5. Niuanzishe kwa niaba yako?" After speaking, NURU listens for your answer. | ✅ v2 (both devices) | The seeded meeting starts 12 min after a reset, so the reminder comes about 7 min after it. |
| ☐ | B2 | OK on one device closes it everywhere | — | **Sawa** on A | jolama | The card disappears on B within 3 s. It never fires twice. | ✅ v2 | |
| ☐ | B3 | Snooze | "Baadaye" / "Nikumbushe baadaye" | "Later" / **Nikumbushe baadaye** button | jolama | The card closes everywhere; NURU says it will remind you in 5 minutes. | ✅ v2 (button); 🖐 voice | Fixed at 5 min. |
| ☐ | B4 | Decline the reminder | "Hapana" | "No" | jolama | The card closes; NURU: "Sawa." | 🖐 | Only a short "no" (up to 3 words). |
| ☐ | B5 | Start as moderator and mute me (voice) | "Ndiyo, anza kama msimamizi na uninyamazishe." | "Yes, start as moderator and mute me." | jolama · A | Opens the meeting; the mic is off; **Require approval** is on; the badge "Nuru ni msimamizi" appears; invitees knock and are admitted. There is no second confirmation (the reminder answer counts, and it is audited). | ⚠️ v2-agent #6 | Goes through the LLM (about 5–15 s). |
| ☐ | B6 | Start as moderator (tap) | — | **Anzisha kama msimamizi** on the card | jolama | Same as B5, instantly, with no LLM. | ✅ v2 | Best stage fallback. |
| ☐ | B7 | Plain "yes" to the reminder | "Ndiyo" | "Yes" | jolama (organizer) | Starts the meeting **without** moderator mode. | 🖐 | For an invitee, "yes" = connect (see B24). |
| ☐ | B8 | Fresh meeting in 2 minutes | — | Demo panel → **Mkutano baada ya dakika 2** | jolama | Creates the Budget Committee meeting and fires the reminder at once. | ✅ v2 | |
| ☐ | B9 | Start a meeting by voice | "Anzisha kikao cha Kamati ya Bajeti." | "Start the Budget Committee meeting." | any | Opens the room → asks "Nianzishe kikao…?" → yes → meeting screen. | ✅ agent.spec #4 (Board Meeting) | |
| ☐ | B10 | Turn moderator mode on inside a live meeting | "Washa hali ya msimamizi, uninyamazishe." | "Moderate the meeting for me and mute me." | in the meeting | Confirmation, then badge, mute and lobby admissions. | ✅ the gate (refused without a yes); 🖐 by voice | The meeting must be live first; otherwise NURU says to start it. |
| ☐ | B11 | Lobby: NURU admits people visibly | (automatic) | — | moderator on | Every 6–10 s someone knocks; the cursor clicks **Ruhusu**; NURU says "Dkt. Halima Said amejiunga na mkutano." | ✅ v2 | **The lobby is simulated**: the names come from the scheduled meeting's invitees; no real person is joining. |
| ☐ | B12 | Hand control back | "Nimerudi" | "I'm back" / **Nimerudi** button on the badge | jolama | Moderation stops; NURU: "Karibu tena. Watu 3 wamejiunga: …" | ✅ v2 (button); 🖐 voice | |
| ☐ | B13 | Admit or deny by hand | — | **Ruhusu** / **Kataa** in the waiting-room panel | jolama | The person joins or disappears. | 🖐 | NURU itself only ever admits; it never denies. |
| ☐ | B14 | Meeting chat by voice | "Waambie wote habari za asubuhi kwenye gumzo." | "Tell everyone good morning in the chat." | in the meeting | Opens chat → types → sends. | ✅ agent.spec #4 | |
| ☐ | B15 | e-Mikutano recording (Recordings tab) | "Anza kurekodi" / "Acha kurekodi" | "Start recording" / "Stop recording" | in the meeting | Asks to confirm each time; the recording is saved to the room's Recordings tab. | ✅ agent.spec #5 | This mock recording is separate from the KatibuAI audio (B17). Disabled when the room's "Allow recording" setting is off; NURU then says so. |
| ☐ | B16 | Leave the meeting | "Ondoka kwenye kikao." | "Leave the meeting." / leave button | jolama | Confirm → back on the room page. Moderation ends (audited as "ended by leaving"). The organizer's scheduled meeting is marked ended. | ✅ agent.spec #5 | NURU cannot *navigate* away from a meeting; it must use Leave. |
| ☐ | B17 | KatibuAI records the meeting automatically | (automatic) | — | the device in the meeting | A red **Inarekodiwa kwa KatibuAI** label with a **live level meter** and a **recording timer**. The microphone records from the moment the meeting page opens until Leave, on its own stream: the meeting's mute button, moderator mode and NURU's own listening do not stop it. | ✅ katibu-live.spec (fake microphone, meter and timer) when KatibuAI is fast enough | It records the hall, including NURU's voice. If the mic is unavailable, the label is greyed. |
| ☐ | B18 | Offer of minutes after Leave | "Ndiyo" (to "Ningependa kumwomba Katibu aandae kumbukumbu. Nianze?") | "Yes" / **Ndiyo, ziandae** on the card | jolama | NURU: "Katibu anaandaa kumbukumbu…"; a toast with a link. The minutes carry the meeting's name. | ✅ katibu-live.spec (UI flow, real KatibuAI); ✅ katibu-audio.spec | Not offered again if you already asked Katibu during the meeting (B27). |
| ☐ | B19 | Decline the minutes | "Hapana" | **Hapana** | jolama | Nothing is sent to Katibu; the audit says Declined. | 🖐 | |
| ☐ | B20 | Live progress | — | Hub → **Kumbukumbu** | jolama | Stage text and % move live. | ✅ katibu.spec (stages seen) | About **1 minute** for the 2-minute sample (59 s and 56 s measured). |
| ☐ | B21 | Minutes ready → announced and opened | (automatic) | — | jolama | "Kumbukumbu za … ziko tayari…" The page opens **only if you are on a Hub page or the room page**. Badge "Imeandaliwa na KatibuAI"; summary, decisions, action items. | 🖐 the UI; ✅ ready status (katibu.spec) | If you are elsewhere (e.g. GMS), only the toast and speech appear. |
| ☐ | B22 | Swahili/English minutes, PDF/DOCX | "Fungua kumbukumbu" | **SW / EN** switch; **PDF / DOCX** downloads | jolama | Language switch; downloads through NURU's backend. | ✅ SW PDF download (katibu.spec); 🖐 the rest | |
| ☐ | B23 | Send minutes by voice | "Zitume kwa washiriki." | "Send them to the participants." | jolama | "Nitume kumbukumbu hizi kwa mshiriki mmoja?" (one recipient) or "…kwa washiriki 3?" → "Ndiyo" → per-recipient delivery status (SENT). | ✅ the gate (refused without a yes); ✅ sending via the API; 🖐 by voice | Singular/plural fixed in Swahili and English. **Recipients are fixed** by `MINUTES_RECIPIENTS`. |
| ☐ | B24 | Send minutes by hand | — | **Tuma kwa washiriki** → confirm in the dialog | jolama | Same as B23. | 🖐 | |
| ☐ | B25 | Minutes land in GMS for the demo participants | (automatic after the send) | — | halima · C, baraka | An inbox message from **KatibuAI** "Kumbukumbu za kikao: …"; Halima's NURU announces it. | ✅ katibu.spec (GMS inbox) | Only participants with accounts (jolama, halima, baraka). |
| ☐ | B26 | Ask Katibu's progress | "Katibu amefikia wapi?" | "How are the minutes coming along?" | jolama | NURU reads the stage and %. | 🖐 | |
| ☐ | B27 | Ask Katibu during or right after the meeting | "Mwombe Katibu aandae kumbukumbu." | "Ask Katibu to prepare the minutes." | jolama, in or just after the meeting | NURU **stops the recording first** and sends **this meeting's** recording; the meeting continues without recording. Leave then does not offer minutes again. | 🖐 (same code as B18) | After a page reload the recording kept in memory is gone: then NURU says the live recording can't be used and asks about the sample (B28). |
| ☐ | B28 | Honest audio: never a silent fallback | (automatic) | — | jolama | In live mode, if the recording is missing, **shorter than 20 s**, silent or unreadable, NURU says so ("Rekodi halisi ya kikao hiki haiwezi kutumika: … Nitumie rekodi ya mfano badala yake?") and waits: **Ndiyo, tumia ya mfano** or **Hapana** (nothing is sent). | ✅ katibu-audio.spec | The sample is used without asking only when you chose **Rekodi ya mfano** (B39). |
| ☐ | B29 | KatibuAI down | — | Demo panel shows **KatibuAI** red | — | The job shows Failed; NURU says the minutes could not be prepared. | 🖐 | Time-out after 10 min. A demo reset during a job stops it cleanly (fixed). |
| ☐ | B30 | Audit log (not minutes) | "Fungua kumbukumbu za ukaguzi." | "Open the audit log." | any | e-Mikutano Audit Log: filters, CSV export, clear (gated). | ✅ demo.spec, ui.spec | "Kumbukumbu za ukaguzi" = audit log; "kumbukumbu (za kikao)" = minutes. |
| ☐ | B31 | v1 room work by voice | "Tengeneza chumba kiitwacho Kikao cha Bodi." / "Washa kunyamazisha watumiaji wanapojiunga na unipe namba ya mtazamaji." / "Mpe Neema Mwakalinga ruhusa." / "Ongeza ajenda ya kikao kwenye wasilisho." | "Create a room called Board Meeting." / settings + viewer code / share access / add the agenda | jolama | Visible cursor; confirmation for create; codes are read out digit by digit. | ✅ agent.spec #1–3, #6; demo.spec | Duplicate names make NURU ask (only for exact duplicates). |
| ☐ | B32 | Decline and Esc | "Futa chumba cha Board Meeting" → "Hapana"; press **Esc** / say "acha" while NURU acts | "Delete the Board Meeting room" → "No" | any | Nothing deleted, audit Declined; Esc cancels at once, audit Cancelled. | ✅ agent.spec #7, #8 | |
| ☐ | B33 | e-Mikutano by hand | — | token join, rooms, tabs, access codes, presentation, chat, notes, reactions, raise hand, camera/screen toggles, recordings, rename, delete | any | All work. | ✅ ui.spec | |
| ☐ | B34 | Join from the Hub | — | Hub → Leo → **Anza/Jiunge** on the meeting, or Hub → Mikutano → open | any | Opens the meeting (by voice it needs a confirmation). | 🖐 | |
| ☐ | B35 | ⛔ Real audio or video between people / a second device joining the same meeting | — | — | — | **Not supported.** e-Mikutano is a per-browser mock: Halima's "connect me" opens **her own copy** of the room. Rooms created on A do not appear on B. | ⛔ | Never show two devices "in the same meeting". |
| ☐ | B36 | ⛔ Schedule a new meeting with invitees by voice | — | — | — | **Not supported** (no tool, no UI). Use the demo panel's "meeting in 2 minutes". | ⛔ | |
| ☐ | B37 | ⛔ Choose minutes recipients, edit minutes, or send them to a named person | — | — | — | **Not supported.** The recipient list is fixed. | ⛔ | |
| ☐ | B39 | Sample mode plays the sample aloud | — | Demo panel or Settings → **Rekodi ya mfano**, then start the meeting | jolama · A | The meeting shows a player **Inacheza rekodi ya mfano** (▶/⏸, progress) and the room hears the sample meeting; the badge reads **Rekodi ya mfano kwa KatibuAI**. The same file goes to KatibuAI, so the minutes match what the audience heard. | ✅ katibu-audio.spec (player and badge; muted in tests) | Turn the volume up on A. Pausing the player does not change what is sent (always the whole sample). |
| ☐ | B40 | Safari ya kumbukumbu (the minutes journey) | "Fungua kumbukumbu" | Hub → **Kumbukumbu** → a meeting | jolama | Five steps with times, from real backend data: (1) **Rekodi halisi** or **Rekodi ya mfano** (+ reason), duration, size, waveform and ▶ to hear **exactly** the WAV that was sent; (2) upload: chunks sent/total and the **KatibuAI meeting ID**; (3) transcribing; (4) writing; (5) done, with an excerpt of **KatibuAI's own transcript**. | ✅ katibu-live.spec when KatibuAI finishes | KatibuAI has **no web screen** for meetings (only its Django admin and the mobile app), so there is no "Ona kwenye KatibuAI" link. |
| ☐ | B41 | Live captions in the meeting | (speak in the room) | — | the device in the meeting | A small panel **Manukuu ya moja kwa moja** shows what is said (Swahili or English, from the UI language). It pauses ("yamesitishwa NURU inaposikiliza") while NURU listens, then resumes. | 🖐 (Web Speech is not available in automated Chromium) | Browser speech recognition (Chrome sends audio to Google). Captions are for the audience only; KatibuAI uses the recording. |
| ☐ | B38 | ⛔ NURU uploads a file from the laptop to the presentation | — | — | — | **Not supported** (only the three e-Office sample documents). | ⛔ | A human can drag and drop. |

---

## (C) GMS e-mail

| ✓ | # | Scenario | Swahili (say or type) | English / clicks | Account · device | What happens on screen · what NURU says | Test | Limits / notes |
|---|---|---|---|---|---|---|---|---|
| ☐ | C1 | Reply to an e-mail by voice | "Jibu barua ya Dkt. Halima kuhusu mapitio ya bajeti, mwambie nitahudhuria na nitaleta takwimu mpya." | "Reply to Dkt. Halima's e-mail about the budget review; tell her I'll attend and bring the new figures." | jolama · A | Opens the inbox → the e-mail → **Jibu** (To and "Re:" filled) → types a 2–4 sentence formal reply above the signature → summarises it and asks "Nitume barua hii?" → "Ndiyo" → Sent. | ⚠️ v2-agent #1: **flaky** (once it stopped after the draft with no question); the prompt was fixed, not re-run | If it stops at the draft, say "Ituma" / "Send it". |
| ☐ | C2 | The recipient is told live | (automatic) | — | halima · C | Within about 3 s: toast plus speech "Umepokea barua pepe mpya kutoka kwa Jolama: Re: …"; the inbox refreshes; the Hub unread count updates. | ✅ v2; ⚠️ v2-agent #1 | |
| ☐ | C3 | New e-mail by voice | "Mwandikie Baraka barua pepe kuhusu matengenezo ya mfumo kesho saa nne asubuhi." | "Write an email to baraka.mollel@mfano.go.tz about tomorrow's system maintenance at 10 am." | jolama | Compose → To, Subject, Body → confirm → send → Baraka is notified. | ⚠️ v2-agent #2 (English; passed isolated) | Names are resolved from the directory; the Swahili variant is not automated. |
| ☐ | C4 | Decline the send | (at "Nitume barua hii?") "Hapana" | "No" | jolama | Nothing sent; **the draft stays in Rasimu**; audit Declined; not asked again. | ⚠️ v2-agent #3 | |
| ☐ | C5 | Change request before sending | "Ifanye rasmi zaidi." / "Iandike kwa Kiingereza." | "Make it more formal." / "Write it in English." | jolama | NURU retypes the whole body, then asks again. | 🖐 | |
| ☐ | C6 | Only a draft | "Andaa rasimu ya jibu kwa Neema, usiitume." | "Draft a reply to Neema, don't send it." | jolama | Draft typed and saved; no confirmation; finish. | 🖐 | |
| ☐ | C7 | Read, reply and send by hand | — | Inbox → open → **Jibu** → type → **Tuma** | jolama | "Rasimu imehifadhiwa" (auto-save after about 1 s); signature and quoted original added; goes to Sent; the draft disappears. | ✅ v2 | |
| ☐ | C8 | External address refused | "Tuma barua kwa someone@gmail.com …" | (or type it by hand) | any | Red error: "Kutuma nje ya mfumo kumezimwa katika onyesho hili." NURU reports the error. | ✅ v2 (by hand); 🖐 by voice | Only `@mfano.go.tz`. |
| ☐ | C9 | Other send errors | — | Send with no recipient, an invalid address or no subject | any | "Weka angalau mpokeaji mmoja." / "… si anwani sahihi…" / "Weka kichwa cha barua." | 🖐 | |
| ☐ | C10 | Confirmation gate | — | (internal) | — | `gms.compose.send` is refused without a yes. | ✅ v2 "safety gates" | Human clicks are not gated. |
| ☐ | C11 | Reply-all, Forward, CC | "Isambaze barua ya Neema kwa Baraka." | "Forward Neema's e-mail to Baraka." / **Jibu wote**, **Sambaza**, CC field | jolama | Compose prefilled ("Fwd:" plus the quoted original); confirm; send. | 🖐 | |
| ☐ | C12 | Ask about the mail | "Nina barua ngapi ambazo sijasoma?" / "Barua ya Neema inasema nini?" | "How many unread e-mails do I have?" / "What does Neema's e-mail say?" | jolama | Answered from the screen data (unread count; the opened e-mail's body, up to 2,000 characters). | 🖐 | To summarise an e-mail, it opens it first. |
| ☐ | C13 | Folders, search, refresh, delete | "Fungua barua zilizotumwa." / "Futa barua hii." | Inbox, Rasimu, Zilizotumwa, Taka, Zilizofutwa; search box; refresh; **Futa** | any | Works. Delete moves the e-mail to Trash; deleting from Trash is permanent. | 🖐 | Delete is **not** gated. |
| ☐ | C14 | Discard a draft | "Tupa rasimu hii." | "Discard this draft." / **Tupa** | any | The draft is removed. | 🖐 | |
| ☐ | C15 | One sign-in | — | Open `/gms/login` while signed in to the Hub | halima | Goes straight to her inbox as halima.said@mfano.go.tz. | ✅ v2 | |
| ☐ | C16 | Minutes arrive from KatibuAI | (after B23) | — | halima, baraka, jolama | An inbox message from "KatibuAI". | ✅ katibu.spec | |
| ☐ | C17 | Language of the reply | — | — | — | It writes in the language you ask for; otherwise the language of the e-mail being answered; otherwise yours. | 🖐 | |
| ☐ | C18 | Mail to a directory person without an account | "Mwandikie Neema…" | | jolama | Sent and listed in Sent, but **nobody receives it live** (no account). | 🖐 | Use halima or baraka for live receipt. |
| ☐ | C19 | ⛔ Attachments, rich text, sending outside `mfano.go.tz`, real SMTP | — | — | — | **Not supported.** | ⛔ | |
| ☐ | C20 | ⛔ Recall, Junk, Mark, What's new, More toolbar buttons | — | — | — | Shown but **"Not available in this demo"**. | ⛔ | |
| ☐ | C21 | ⛔ NURU invents facts in an e-mail | — | — | — | By design it uses only your words and the e-mail being answered; check the summary before saying yes. | — | |

---

## (D) NURU as a reminder

**How reminders work (from the code)**
- NURU reminds you **before** an item, never at its exact time:
  - day items and meetings: the **lead time** before (default 5 min; Settings 2/5/10/15);
  - WERIS tasks: **30 min** before the due time (fixed).
- The server checks every **10 s**. An item that starts within the lead time is reminded on the next check, with "baada ya dakika N", where N is the real number of minutes left.
- An item whose start time has **already passed** is saved, but it **never** gets a reminder.
- `schedule_reminder` takes `HH:MM` (meaning **today**) or `YYYY-MM-DDTHH:MM`.
- Swahili clock phrases containing "saa …" are converted to 24 h **in code**, and the model is told the result. English times and relative times ("in 10 minutes") are worked out by the model from the current time in its prompt.

| ✓ | # | Scenario | Swahili (say or type) | English / clicks | Account · device | What happens on screen · what NURU says | Test | Limits / notes |
|---|---|---|---|---|---|---|---|---|
| ☐ | D1 | Personal reminder at a clock time | "Nikumbushe kumpigia Mkurugenzi saa nane mchana." | "Remind me to call the Director at 2 pm." | jolama · A | A 14:00 item (kind call) appears on the Today timeline. NURU: "Sawa, nitakukumbusha saa nane mchana." At **13:55** (lead 5), a card plus speech on every device: "Jolama, baada ya dakika 5: Kumpigia Mkurugenzi." | ⚠️ v2-agent #7 (passed isolated; OpenAI 504s in the full run) | Not sensitive, so no confirmation. The card comes 5 min **before** 14:00, not at 14:00. |
| ☐ | D2 | Relative time | "Nikumbushe baada ya dakika 10 kuangalia barua pepe." | "Remind me in 10 minutes to check my e-mail." | jolama | The model adds 10 min to the current time and saves the item. With lead 5, the card comes about **5 min** later: "baada ya dakika 5: …". | 🖐 | The arithmetic is done by the model, not in code. For "in 2/3 minutes" (less than the lead time), the card comes within 10 s. **Best for the stage: "baada ya dakika 6–7"** (card about 1–2 min later), or set the lead to 2 min. |
| ☐ | D3 | Relative hours | "Nikumbushe baada ya saa moja kuandaa ripoti." | "Remind me in an hour to prepare the report." | jolama | As D2 (now + 60 min). | 🖐 | **Risk:** "baada ya saa moja" contains "saa moja", which the code converts to **07:00** and passes to the model as a hint. The model may pick 07:00 instead of now + 1 h. Prefer "baada ya dakika 60" or a clock time. |
| ☐ | D4 | Another day | "Kesho saa tatu asubuhi nikumbushe kikao cha bajeti." / "Ijumaa saa nane mchana nikumbushe ripoti." | "Tomorrow at 9 am remind me about the budget meeting." | jolama | Saved with a full date (`YYYY-MM-DDTHH:MM`). It is **not on Today's timeline** (that shows today only); the reminder fires on that day. | 🖐 | Weekdays mean the **next** one (today is Sunday 25 Oct: kesho = Mon 26, Ijumaa = Fri 30). It can't be checked on screen until that day. |
| ☐ | D5 | Plan my day by voice | Click **Mpango wa leo** → "Saa nne asubuhi nina kikao na timu ya mifumo, saa nane mchana nitampigia simu Mkurugenzi, na saa kumi jioni nitaandaa ripoti ya wiki." → "Ndiyo" | "Plan my day" → "At 10 am I have a meeting with the systems team, at 2 pm I'll call the Director, at 4 pm I'll prepare the weekly report." → "Yes" | jolama · A | Greeting "Habari za asubuhi, Jolama. Una mipango gani leo?". It listens until 2.5 s of silence, then shows the timetable: new rows marked **mpya**, existing items shown dashed, overlaps in orange. NURU: "Nimepanga mambo 3 leo. La kwanza ni …, saa nne asubuhi. Nihifadhi mpango huu?" → "Sawa, nitakukumbusha kila jambo kwa wakati wake." Each item gets its own reminder. | ✅ parse test (v2 `@key`: 10:00/14:00/16:00, the call kind); ⚠️ v2-agent #8 (typed flow) | A guided flow, not the agent. The times come from your own words, converted in code. |
| ☐ | D6 | Plan my day by typing | Type the same sentence in the sheet's box → send → type "ndiyo" | | jolama | Same as D5. | ⚠️ v2-agent #8 | The stage fallback for a noisy hall. |
| ☐ | D7 | Edit the plan before saving | — | Change a row's time (24 h field) or title; **×** removes a row; the mic button listens again | jolama | The edits are saved when you say yes. | ✅ screenshots only; 🖐 | You can't edit by voice inside the sheet; say it again or type it. |
| ☐ | D8 | Vague time in the briefing | "Baada ya chakula cha mchana nitapitia ripoti." | "After lunch I'll review the report." | jolama | Placed at a sensible time (after lunch = 14:00, morning = 09:00, evening = 17:00), and NURU adds a question ("Je, saa nane mchana ni sawa?"). | 🖐 | The question is spoken, but your answer does **not** change the item; edit the time field instead. |
| ☐ | D9 | Decline the plan | (at "Nihifadhi mpango huu?") "Hapana" | "No" / close the sheet | jolama | "Sawa, sijahifadhi mpango." Nothing is saved; the audit says Declined. | 🖐 | An answer that is neither yes nor no gets "Tafadhali sema ndiyo au hapana." once, then waits for a tap or typing. |
| ☐ | D10 | Automatic morning briefing | (automatic) | Open Hub → **Leo** for the first time today | jolama | After the "Gusa ili kuanza" tap, the briefing starts by itself about 1 s later. | 🖐 | Once per day **per device** (stored in the browser). Never with `?mute=1`. |
| ☐ | D11 | Briefing prompt from the demo panel | — | Ctrl+Shift+D → **morning briefing** button | jolama | The briefing opens on **every device** signed in as that user. | 🖐 | Close it on the devices you don't use. |
| ☐ | D12 | Meeting reminder (organizer) | (automatic) | — | jolama · A + B | "Jolama, una Kikao cha Kamati ya Bajeti baada ya dakika 5. Niuanzishe kwa niaba yako?" with buttons **Sawa**, **Nikumbushe baadaye** and **Anzisha kama msimamizi**, and an answer box. | ✅ v2 | The answers are in B3–B7. |
| ☐ | D13 | Meeting reminder (invitee) | (automatic) | — | halima · C | "…Ungependa nikuunganishe?" "Ndiyo" opens **her own copy** of the meeting (see ⛔ B35). | 🖐 | Halima is the organizer of tomorrow's "Kikao cha Wiki cha Idara". |
| ☐ | D14 | Meeting reminder closes when the meeting goes live | (automatic) | Start the meeting from anywhere | organizer | The open card disappears on every device. | 🖐 | |
| ☐ | D15 | Task due reminder | (automatic) | — | assignee | 30 min before: "Jolama, kazi "…" inatakiwa iwe tayari baada ya dakika 30." "Ndiyo" opens WERIS Kazi Maalum. Marking the task Done cancels the reminder. | 🖐 | Tasks with a due date only. Fixed at 30 min. |
| ☐ | D16 | OK | "Sawa" (button) | **Sawa** / "OK" | any | The card closes on every device; it never fires again. | ✅ v2 | |
| ☐ | D17 | Snooze | "Baadaye" / "Nikumbushe baadaye" / "Subiri" | "Later" / "Remind me later" / "Snooze" / button | any | Closes everywhere: "Sawa, nitakukumbusha tena baada ya dakika 5." It fires again 5 min later. | ✅ v2 (button, re-armed in 4–5.5 min); 🖐 voice | **Always 5 min.** "Nikumbushe baada ya dakika 15" while the card is open is not understood (the card keeps waiting). |
| ☐ | D18 | Decline | "Hapana" / "Acha" | "No" | any | The card closes; NURU: "Sawa." | 🖐 | Only short answers (up to 3 words); longer ones are treated as a request. |
| ☐ | D19 | Plain yes | "Ndiyo" / "Sawa" | "Yes" | any | Meeting: starts or joins it. Task: opens WERIS tasks. Day item: opens the Hub. | 🖐 | |
| ☐ | D20 | Answer by typing | Type in the card's box, e.g. "Ndiyo, anza kama msimamizi na uninyamazishe" | | any | Same rules as speaking. | ⚠️ v2-agent #6 | Works with the microphone off. |
| ☐ | D21 | Spoken answer right after the reminder | (speak after NURU finishes) | | any | NURU listens once after speaking the reminder. | 🖐 | It doesn't listen while it is busy with another task. If nothing is heard, the card waits for a tap. |
| ☐ | D22 | Multi-device | — | Two browsers signed in as jolama | jolama · A + B | The card appears on both within 3 s; OK, snooze or decline on one closes it on the other. | ✅ v2 (both devices, OK and snooze) | Through `--share`, phones use long-polling (about 1 s). |
| ☐ | D23 | Reload safety | — | Reload the page (or lose the network briefly) | any | Reminders that fired in the **last 30 min** and are still open come back as cards; the day refreshes. | 🖐 | Older open reminders are not shown again. |
| ☐ | D24 | Audio locked when a reminder fires | (automatic) | Tap **Gusa ili kuanza** | any | The overlay appears; after the tap NURU greets you and **re-speaks the open reminder**. | ✅ the overlay (v2); 🖐 the re-speak | |
| ☐ | D25 | Background / system notification | (automatic) | Allow notifications; keep NURU open in a background tab or minimised | any | A system notification "Kikumbusho"; clicking it opens NURU. Tasks, e-mail and minutes do the same. | 🖐 | Only while the page is **open in the background** and the permission was granted. |
| ☐ | D26 | Voice off | — | Hub → Mipangilio → voice switch off | any | Cards and pop-ups only, with no speech or listening. | 🖐 | |
| ☐ | D27 | Lead time | "Nikumbushe dakika 10 kabla." (on Settings) | Hub → Mipangilio → **2 / 5 / 10 / 15** | any | All your meeting and day-item reminders are re-scheduled at once. | 🖐 | Task reminders stay at 30 min. By voice it works only by clicking the setting (no tool); untested. |
| ☐ | D28 | "What's on my day?" | "Nina nini leo?" / "Ratiba yangu ya leo ni ipi?" / "Kikao changu kijacho ni saa ngapi?" | "What's on my day?" / "When is my next meeting?" | any | NURU answers from the Today data (times, titles, done), in one or two sentences. | 🖐 | Today only; there is no "what's tomorrow". Best asked from the Hub. |
| ☐ | D29 | Mark a day item done | "Weka kumpigia Mkurugenzi kama imekamilika." | "Mark calling the Director as done." / ✓ on the row | any | The row is ticked and its reminder cancelled. | 🖐 | Not gated. |
| ☐ | D30 | Delete a day item | "Futa kikumbusho cha kumpigia Mkurugenzi." | "Delete the reminder to call the Director." / 🗑 on the row | any | The row and its reminder are removed. | 🖐 | **Not gated** (no confirmation). Only items you added (briefing or reminders), not meetings or tasks. Only items **on today's timeline**. |
| ☐ | D31 | Demo panel: fire the next reminder | — | Ctrl+Shift+D (or 5 taps on the logo) → **Toa kikumbusho kinachofuata sasa** | any | Fires your **earliest** upcoming reminder now. | ✅ v2 | After a reset this is the Budget Committee meeting. Later it may be a task or a day item instead. |
| ☐ | D32 | Demo panel: meeting in 2 minutes | — | **Mkutano baada ya dakika 2** | jolama | A fresh Budget Committee meeting, with its reminder fired at once. | ✅ v2 | |
| ☐ | D33 | Demo panel: reset | — | **Rejesha data ya onyesho** → confirm | any | Re-seeds everything for every user. Open cards close on every device. The Budget meeting reminder comes about 7 min later. | ✅ used before every test | It also clears the reminders and day items you added. |
| ☐ | D34 | A time already passed today | "Nikumbushe saa mbili asubuhi …" (said at 15:00) | "Remind me at 8 am…" (in the afternoon) | any | The item is saved **today in the past**, and **there is no reminder**. NURU may still say "nitakukumbusha". | 🖐 | Say "kesho saa mbili asubuhi" for tomorrow. |
| ☐ | D35 | ⛔ Reminder at the exact time ("at 14:00, not before") | — | — | — | **Not supported.** It is always lead-time minutes before (minimum 2). | ⛔ | |
| ☐ | D36 | ⛔ Recurring reminders | "Nikumbushe kila siku saa mbili…" | "Every day at…" | — | **Not supported** (one-off only). The model may create a single item. | ⛔ | |
| ☐ | D37 | ⛔ Rename or move a day item | "Badilisha kikumbusho kiwe saa tisa." | "Move it to 3 pm." | — | **No tool or UI** (only delete, then create again). | ⛔ | |
| ☐ | D38 | ⛔ Remind another person | "Mkumbushe Baraka…" | "Remind Baraka…" | — | **Not supported** (reminders are your own). Use a WERIS task with a due time (A1); it reminds them 30 min before. | ⛔ | |
| ☐ | D39 | ⛔ Snooze for a chosen time, list or cancel all reminders, see tomorrow's plan | — | — | — | **Not supported.** | ⛔ | |
| ☐ | D40 | ⛔ Plan tomorrow in the briefing | "Kesho saa nne…" (in Mpango wa leo) | | — | **The briefing is for today only**; "kesho" items land on today. Use D4 for other days. | ⛔ | |
| ☐ | D41 | ⛔ Reminder with the browser closed | — | — | — | **No web push** and no SMS: a closed browser or app gets nothing. | ⛔ | Keep NURU open on every device you show. |

### Swahili clock conversion (exactly as coded in `llm.py`)

The Swahili hour **N** counts from 06:00, so base = (N + 6) mod 12. The period word then picks the half of the day.

| Phrase | Result | Rule / edge |
|---|---|---|
| saa moja / mbili / tatu / nne / tano **asubuhi** | 07 / 08 / 09 / 10 / 11:00 | asubuhi = morning |
| saa kumi na mbili asubuhi | 06:00 | |
| saa sita **mchana** / saa saba / saa nane / saa tisa / saa kumi mchana | 12 / 13 / 14 / 15 / 16:00 | mchana: base ≤ 6 → afternoon. "saa tano mchana" = 11:00 |
| saa kumi **jioni** / kumi na moja / kumi na mbili jioni | 16 / 17 / 18:00 | |
| saa moja / mbili / tatu jioni | 19 / 20 / 21:00 | |
| saa mbili / tatu / nne / tano **usiku** | 20 / 21 / 22 / 23:00 | usiku: base ≥ 7 → evening |
| saa moja usiku | 19:00 | |
| **saa sita usiku** (midnight) | **00:00 today**, which has already passed → **no reminder** | ⚠️ For tonight's midnight, say "saa tano na dakika 59 usiku" or give a date |
| saa saba / tisa usiku | 01:00 / 03:00 **today** (already passed in the daytime) | ⚠️ Needs "kesho" and a date |
| saa kumi / kumi na moja / kumi na mbili **alfajiri** | 04 / 05 / 06:00 | ⚠️ Today's dawn has usually passed; say "kesho alfajiri" |
| **no period word**: saa moja, mbili … tano | 07–11:00 | Office-hours guess: "saa mbili" = **08:00**, never 20:00. Add "usiku" for the evening |
| no period word: saa sita, saba … kumi na mbili | 12–18:00 | |
| saa nne **na nusu** asubuhi | 10:30 | |
| saa nne **na robo** asubuhi | 10:15 | |
| saa tatu **kasoro robo** asubuhi | 08:45 | |
| saa nane **na dakika 10** mchana | 14:10 | ⚠️ **Digits only**: "na dakika kumi" (in words) loses the minutes in code |
| saa nane **kasoro dakika 5** mchana | 13:55 | Digits only, as above |
| ⚠️ saa nne **asubuhi na nusu** | 10:00 (the half hour is lost) | The fraction must come **before** the period word: "saa nne na nusu asubuhi" |
| ⚠️ **saa 4** asubuhi (a digit after "saa") | **10:00** | A digit after "saa" is read as a *Swahili* hour. "saa 4" means 10:00, not 04:00 |
| ⚠️ saa 4:30 | 10:00 (the ":30" is lost) | Say "saa nne na nusu" |
| saa 14:00 / saa 16 | not converted in code (more than 12) | The model reads it as 24 h, which is usually correct |
| ⚠️ saa sita **jioni** | 12:00 (wrong; nobody says it) | Avoid |
| 4 pm / 4:30 p.m. / 16:00 / 16.00 | 16:00 / 16:30 / 16:00 / 16:00 | English and 24 h, converted in the briefing; in agent requests the model handles them |
| "half past four", "quarter to five", "noon", "midnight" | model only | Not converted in code; usually right, but untested |

The conversion was checked once by hand against 24 phrases from the build prompt, and all were correct. There is **no committed unit test**; the briefing parse test (✅) covers 10:00, 14:00 and 16:00.

**Other edge cases**
- **Backend restart:** reminders that fell due while it was down fire on start-up and say "baada ya dakika 1", even if the item has already started.
- **Snooze past the start time:** the second card also says "baada ya dakika 1".

---

## (E) WERIS weekly report, filled by NURU

How it works:
- **The page:** WERIS → **Reports** → **Individual (Interns) Reports** (`/weris/reports/individual`). The header is this ISO week, computed from today: on **Monday 26 October** it reads **"Weekly Report — 2026-W44 (2026-10-26 → 2026-11-01)"**. Tabs **Projects 0/6 · Assignments 0/2 · PDPs 0/2**.
- **Items:** Jolama's six projects (SGRFasta, FAKE PRODUCT DETECTOR, GoPost, MuhtasariAI, MtotoCare, Swahili sentiment Analysis Tool), each with **last week's promise** taken from last week's submitted report; his WERIS special tasks; his PDP entries "In Progress"/"Not Started".
- **NURU fills it with ONE structured model call** (all items at once, as JSON), then the cursor fills the cards tab by tab and clicks **Save Draft**. The report text is **always English**; NURU talks to you in your language. Inputs: your words, each promise, and this week's real data (special tasks, PDP entries, NURU's activity log). It never invents numbers, dates or results that are not in your words or the data.
- **Chips:** every field NURU wrote shows **✦ Imeandaliwa na NURU**, plus **· Hakiki** when the wording is generic (please review). Editing a field removes its chip.
- Use account **jolama**; Dkt. Halima (**halima**) receives the submission.

| ✓ | # | Scenario | Swahili (say or type) | English / clicks | Account · device | What happens on screen · what NURU says | Test | Limits / notes |
|---|---|---|---|---|---|---|---|---|
| ☐ | E1 | Open the report | "Fungua ripoti yangu ya wiki." | WERIS → Reports → **Individual (Interns) Reports** | jolama · A | The landing shows **Project Reports**, **Individual (Interns) Reports** and the **Security Reports** link ("Not available in this demo"). | ✅ weris-report.spec | Project Reports is not in this demo either. |
| ☐ | E2 | The form as on the real WERIS | — | — | jolama | Header with the ISO week, **Status: DRAFT**, **← Back**, tabs with done/total counters, the promise box with **Done / Partially Done / Not Done**, "This week's progress *", "Plan for next week *", "Blockers / Risks (optional)", Attachments, sticky footer "10 items need progress before you can submit." | ✅ weris-report.spec | |
| ☐ | E3 | Validation and live counters by hand | — | type progress and plan in one card | jolama | The card turns **complete**, the tab counter becomes 1/6, the footer "9 items need progress…". **Submit Weekly Report** stays disabled until every item has progress **and** plan. | ✅ weris-report.spec | |
| ☐ | E4 | Save Draft | — | **Save Draft** | jolama | "Draft saved." Reload: everything is still there. | ✅ weris-report.spec | NURU saves the draft by itself after filling. |
| ☐ | E5 | **A — one overview for everything** | "Jaza ripoti yangu ya wiki: SGRFasta nimemaliza kuboresha injini ya AI, GoPost bado nahangaika na API ya TikTok, mingine yote inaendelea vizuri." | "Fill my weekly report: SGRFasta I finished improving the AI engine, GoPost I'm still struggling with the TikTok API, everything else is going well." | jolama · A | Steps "Ninaandaa ripoti (kwa Kiingereza)", then "Ninajaza kipengele 1…10" while the cursor fills each card (SGRFasta → **Done**; GoPost's blockers mention the TikTok API). NURU summarises in Swahili and asks **"Niwasilishe ripoti hii?"** | ✅ weris-report-agent A | About 30–60 s in total (one model call plus visible typing). |
| ☐ | E6 | **B — together, card by card** | "Tujaze ripoti pamoja." → answer each question → "Ruka" (skip) → "Mengine yote yaendelee vizuri." / "Acha" (stop) | "Let's fill the report together." / "skip" / "fill the rest" / "stop" | jolama · A | NURU reads each promise in Swahili ("SGRFasta: wiki iliyopita uliahidi improving the AI engine. Ilienda vipi, na mpango wa wiki ijayo ni upi?"), fills that card from your answer, and moves on. "Mengine yote…" fills every remaining item; "Acha" stops (the draft is saved). | ✅ weris-report-agent B (two items + "mengine yote"); 🖐 "ruka" and "acha" | Each answer is one model step plus one fill call (5–10 s). |
| ☐ | E7 | **C — "do it for me"** | "Niandikie ripoti yangu ya wiki." | "Write my weekly report for me" / "just write nice words for every project" | jolama · A | Every item is filled: real data where it exists (special tasks, PDP), otherwise modest wording built on last week's promise, marked **· Hakiki**. | ✅ weris-report-agent C (all filled, review chips, no digits in project text) | Generic wording is deliberately non-specific; review before submitting. |
| ☐ | E8 | One item only | "Jaza GoPost tu: nimeanza kutumia API mpya ya TikTok, wiki ijayo nitaimaliza." | "Fill only GoPost: …" | jolama | Only the GoPost card changes. | 🖐 | |
| ☐ | E9 | Edit one field | "Badilisha mpango wa MtotoCare uwe kuanza majaribio ya API." | "Change MtotoCare's plan to start testing the API." | jolama | Only MtotoCare's plan changes (in English); the draft is saved. | 🖐 (the fill call was checked directly) | |
| ☐ | E10 | Chips disappear when you edit | — | edit a field NURU wrote | jolama | That field's **Imeandaliwa na NURU** chip disappears; the others stay. Chips are saved with the draft. | ✅ weris-report.spec | |
| ☐ | E11 | **Submit by voice (new sensitive action)** | "Ndiyo" to "Niwasilishe ripoti hii?" | "Yes" | jolama · A; halima · C | Status **SUBMITTED**, the form becomes read-only. Halima's device: toast and speech **"Jolama amewasilisha ripoti ya wiki 2026-W44."** and a notification. | ✅ weris-report-agent (confirm); ✅ the code gate (weris-report.spec) | Cannot be undone (demo reset only). |
| ☐ | E12 | Decline the submit | "Hapana" | "No" | jolama | Nothing is submitted; the saved draft stays (Status DRAFT). | ✅ weris-report-agent A | |
| ☐ | E13 | Submit by hand | — | **Submit Weekly Report** | jolama | Same as E11; a human click is not gated. | ✅ weris-report.spec | Enabled only when every item is complete. |
| ☐ | E14 | Demo reset | — | Demo panel → **Rejesha data ya onyesho** | — | This week's report is an empty DRAFT again; last week's promises are back. | ✅ weris-report.spec | |
| ☐ | E15 | ⛔ Attachments by NURU, Project Reports, Security Reports, supervisor comments/approval, other weeks | — | — | — | **Not supported.** NURU never uploads files (a human can choose a file, but it is not stored). | ⛔ | |

---

## Hidden or less obvious capabilities

- **Wake word "Nuru"**: Hub → Settings → wake switch. With it on, saying "Nuru, …" starts a command without clicking the orb. Tested by hand only; avoid it in a noisy hall.
- **Demo panel**:
  - Opens with **Ctrl+Shift+D**, or **5 taps on the NURU logo** on a phone.
  - Buttons: meeting in 2 minutes, fire the next reminder now, morning-briefing prompt, reset all demo data (for every user, with live refresh on every device).
  - Also: the live/sample audio switch and the KatibuAI connection state.
- **`/hub?unlock=1`** brings back "Gusa ili kuanza". **`?mute=1`** silences everything (no speech, mic or briefing).
- **Answer a reminder by typing** in the card's box: same rules as voice ("Ndiyo, anza kama msimamizi…", "baadaye", "hapana").
- **One yes for several actions**: "start the meeting and moderate" asks once (`covers` = 2).
- **Activity log**:
  - Every task, including non-agent flows (moderation, snooze, minutes), appears in Hub → **Shughuli**.
  - Each entry shows the steps, confirmations and outcome.
  - Filters and CSV export are available.
- **Reload-safe reminders**: after a reload or reconnect, open reminder cards come back.
- **Install as an app (PWA)**: Chrome menu → Install. A browser notification appears when the page is in the background and notifications are allowed.
- **Memory**: follow-ups such as "Actually, turn it off again" work (the last 12 requests per session).
- **Language switch by voice**: "Ongea Kiingereza" / "Speak Swahili". The whole UI, speech and replies switch; user data is never translated.
- **Access codes are read digit by digit**: "What is the viewer code?"
- **Lead time**: Settings → 2/5/10/15 minutes changes when meeting and day-item reminders fire (all of them are re-scheduled at once).

## Known risks for the stage

1. **LLM steps take 5–15 s each**, and OpenAI 504 time-outs happened in one test window. For B5, the tap (B6) is the safe fallback; every flow also has a by-hand path.
2. **C1 can stop at the draft** (seen once before the prompt fix). Say "Ituma" if it happens.
3. **e-Mikutano is per device** (B35). Halima's device cannot see Jolama's meeting.
4. **Minutes go to `MINUTES_RECIPIENTS`** (a real Gmail address) outside test mode.
7. **KatibuAI was very slow on 25 October**: today's jobs sat at TRANSCRIBE / IDENTIFY_SPEAKERS for hours (its Celery workers idle). Check `katibu.spec` or the demo panel's KatibuAI state before the audience arrives; if it is slow, use the sample mode (B39) and show minutes from the rehearsal.
5. **Phones through `--share`** use long-polling: about 1 s slower, but working. The microphone, speaker and PWA install on a real phone have not been tested.
6. The `coral` voice has not been auditioned in Swahili.
