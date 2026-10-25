# NURU v2 — demo script (CEO and senior leaders)

About 15 minutes. Each scene gives the exact sentence to say in Swahili (with the English alternative), which device does what, what the audience should see, and the fallback if something goes wrong.

## Before the audience arrives (15 minutes before)

1. **Start KatibuAI** on the server laptop (`cd ../KATIBU-AI/katibuAI-backend && make demo`). Check: `curl http://localhost:8000/healthz` returns `{"status": "ok"}`.
2. **Start NURU with sharing:** `./start.sh --share`. Note the `https://…trycloudflare.com/hub` URL and keep the QR code on screen.
3. **Devices**

   | Device | Who | How |
   |---|---|---|
   | **A** — laptop on the projector (Chrome) | `jolama` | `http://localhost:5173/hub` (or the tunnel URL) |
   | **B** — Jolama's phone (Android Chrome) | `jolama` | scan the QR code, sign in, tap **Gusa ili kuanza**, allow microphone and notifications; optionally **Mipangilio → Sakinisha programu** |
   | **C** — second laptop or phone | `halima` | tunnel URL, sign in as `halima`, tap **Gusa ili kuanza** |

   Password for all demo accounts: `Demo@2026` (demo only).
4. **Reset the data** on device A: **Ctrl+Shift+D → Rejesha data ya onyesho** → confirm. This re-seeds everything for all users: the meeting "Kikao cha Kamati ya Bajeti" now starts **12 minutes** later (its reminder fires after 7 minutes).
5. In the demo panel, check **KatibuAI: Imeunganishwa** (connected). Then check that KatibuAI is actually *processing*: on 25 October its jobs sat at TRANSCRIBE for hours. Run `npm run test:e2e:katibu` (or prepare minutes once from a short rehearsal meeting) and make sure they come back in about a minute. For a noisy or quiet hall, or if KatibuAI is slow, set the meeting audio to **Rekodi ya mfano** (sample recording) in the same panel: the sample is then **played aloud** in the meeting and the same file goes to KatibuAI.
6. Turn the volume up on A and B. Language: Swahili (default). Speak close to the laptop microphone.

**The demo panel** opens with **Ctrl+Shift+D** on a laptop, or by **tapping the NURU logo 5 times** on a phone. It is never visible unless opened.

---

## Scene 1 — Sign-in and greeting (A)

- Show the sign-in screen (stacked NURU logo), sign in as **jolama**.
- On **Leo** (Today): "Habari za asubuhi, Jolama", the large animated orb, the day's timeline with the moving "now" marker and the next item in orange.
- Click the orb or say nothing yet: point out the cards (next meeting countdown, tasks, unread e-mail, minutes).
- **Fallback:** if audio does not play, tap **Gusa ili kuanza** (open `/hub?unlock=1` to bring it back).

## Scene 2 — Morning briefing (A)

- Click **Mpango wa leo**. NURU says: *"Habari za asubuhi, Jolama. Una mipango gani leo?"*
- Say, in one go:
  > **"Saa nne asubuhi nina kikao na timu ya mifumo, saa nane mchana nitampigia simu Mkurugenzi, na saa kumi jioni nitaandaa ripoti ya wiki."**
  >
  > English: *"At 10 a.m. I have a meeting with the systems team, at 2 p.m. I'll call the Director, and at 4 p.m. I'll prepare the weekly report."*
- NURU shows the timetable (new items marked **mpya**, merged with existing meetings and tasks, time clashes in orange) and says *"Nimepanga mambo 3 leo… Nihifadhi mpango huu?"*
- Say **"Ndiyo."** NURU: *"Sawa, nitakukumbusha kila jambo kwa wakati wake."* The items appear on the timeline.
- **Fallback:** type the sentence into the box at the bottom of the sheet and press send, then type `ndiyo`.

## Scene 3 — Reminder, then "start as moderator and mute me" (A and B)

- Wait for the reminder (7 minutes after the reset), or open the demo panel and press **Toa kikumbusho kinachofuata sasa** (or **Mkutano baada ya dakika 2** for a fresh meeting).
- On **A and B at the same time**: a reminder card appears and NURU speaks: *"Jolama, una Kikao cha Kamati ya Bajeti baada ya dakika 5. Niuanzishe kwa niaba yako?"*
- Answer on A:
  > **"Ndiyo, anza kama msimamizi na uninyamazishe."**
  >
  > English: *"Yes, start as moderator and mute me."*
- The card disappears on B too. NURU opens e-Mikutano, starts the meeting, mutes Jolama, turns on "Require moderator approval", and shows the badge **Nuru ni msimamizi**. The red **Inarekodiwa kwa KatibuAI** label shows the recording.
- Every 6–10 seconds an invitee knocks in the waiting room; the cursor clicks **Ruhusu** and NURU says *"Dkt. Halima Said amejiunga na mkutano."*
- After two or three people, say **"Nimerudi"** (or click **Nimerudi** on the badge): *"Karibu tena. Watu 3 wamejiunga: …"*
- **Fallbacks:** tap **Anzisha kama msimamizi** on the card (same result, no voice needed); or type the sentence into the card's answer box.
- **Honest note:** the live microphone records the hall, including NURU's own voice.

## Scene 4 — Leave the meeting, Katibu prepares and sends the minutes (A)

- In the meeting, point at the badge **Inarekodiwa kwa KatibuAI**: the level meter moves when you speak and the timer counts. Talk for **at least 30 seconds** about the agenda, close to the laptop microphone. Mute, moderator mode and NURU's own listening do not stop the recording. The **Manukuu ya moja kwa moja** panel shows what is said (it pauses while NURU listens).
- **Sample mode** (setting from step 5): the player **Inacheza rekodi ya mfano** appears and the hall hears the sample meeting; let it play for a while.
- Say **"Ondoka kwenye kikao"** (*"Leave the meeting"*) → NURU asks for confirmation → **"Ndiyo"**. Or click the leave button.
- NURU: *"Mkutano umeisha. Ningependa kumwomba Katibu aandae kumbukumbu. Nianze?"* → **"Ndiyo."**
  - Alternative **during** the meeting: **"Mwombe Katibu aandae kumbukumbu."** NURU stops the recording and sends this meeting's audio (no second offer when you leave).
  - If the live recording is missing, too short or silent, NURU says so: *"Rekodi halisi ya kikao hiki haiwezi kutumika: … Nitumie rekodi ya mfano badala yake?"* → **"Ndiyo"** (sample) or **"Hapana"** (nothing is sent).
- NURU: *"Katibu anaandaa kumbukumbu. Nitakujulisha zikiwa tayari."* Open **Kumbukumbu** in the Hub and the meeting: the **Safari ya kumbukumbu** panel shows each step with its time:
  1. **Rekodi halisi** (or **Rekodi ya mfano** with the reason), duration and size. Press **▶** to let the audience hear exactly what was sent.
  2. Upload to KatibuAI: chunks sent and the **KatibuAI meeting ID**.
  3. Transcribing.
  4. Writing the minutes.
  5. Done, with an excerpt of **KatibuAI's own transcript** next to the minutes.
- After about **one minute** (when KatibuAI is healthy), NURU announces *"Kumbukumbu za Kikao cha Kamati ya Bajeti ziko tayari. Ungependa kuziona?"* and opens them: badge **Imeandaliwa na KatibuAI**, Swahili/English switch, summary, decisions, action items, PDF/DOCX.
- Say **"Zitume kwa washiriki"** (*"Send them to the participants"*) → NURU: *"Nitume kumbukumbu hizi kwa mshiriki mmoja?"* (one recipient) → **"Ndiyo."** Or tap **Tuma kwa washiriki** and confirm.
- The delivery status per recipient appears; the minutes go by e-mail to `MINUTES_RECIPIENTS` (jolama0001@gmail.com) and land in the GMS inbox of each demo participant (Halima's device announces it).
- **Fallbacks:** if KatibuAI is slow, keep talking about the journey panel (steps 1–2 are real and immediate) and show minutes from the rehearsal (they stay in the Hub).

## Scene 5 — Reply to Dkt. Halima's e-mail in GMS (A)

- Open **Mifumo → GMS** (or say "Fungua barua pepe").
- Say:
  > **"Jibu barua ya Dkt. Halima kuhusu mapitio ya bajeti, mwambie nitahudhuria na nitaleta takwimu mpya."**
  >
  > English: *"Reply to Dkt. Halima's e-mail about the budget review; tell her I'll attend and bring the new figures."*
- NURU opens the e-mail, clicks **Jibu**, types a short formal reply above the signature, reads it in brief and asks *"Nitume barua hii?"*
- Optional: say **"Ifanye rasmi zaidi"** (*"make it more formal"*) or **"Iandike kwa Kiingereza"** (*"write it in English"*); NURU retypes and asks again.
- Say **"Ndiyo."** The e-mail moves to **Zilizotumwa**; Halima's device (C) announces *"Umepokea barua pepe mpya kutoka kwa Jolama…"*
- Point out: it only used facts from the request and the original e-mail, and it could not send without the "ndiyo" (enforced in code). Saying **"Hapana"** leaves a draft.
- **Fallback:** type the request into the NURU panel (Alt+S).

## Scene 6 — Halima assigns a task; Jolama's phone announces it; Jolama reports back (C, then B)

- On **C (Halima)**, open NURU and say:
  > **"Mpe Jolama kazi ya kuandaa ripoti ya bajeti ya robo ya tatu, iwe tayari Ijumaa saa nane mchana."**
  >
  > English: *"Give Jolama the task of preparing the third-quarter budget report, due Friday at 2 p.m."*
- Her NURU opens WERIS → Kazi Maalum → **Ongeza Kazi Maalum**, fills the form (assignee, title, Friday, 14:00) and asks for confirmation → **"Ndiyo."**
- **Within 3 seconds, B (Jolama's phone)** speaks: *"Jolama, umepewa kazi mpya na Dkt. Halima Said: …, iwe tayari Ijumaa saa nane mchana."* and shows the toast.
- On **B**, say:
  > **"Mwambie Dkt. Halima nimeanza kazi ya ripoti ya bajeti."** (or *"…nimemaliza…"*)
  >
  > English: *"Tell Dkt. Halima I've started on the budget report."*
- Halima's device announces *"Dkt. Halima, Jolama ameanza kazi: …"*
- **Fallback:** do it by hand in WERIS (Ongeza Kazi Maalum; the status select on the row). The announcements are the same.

## Scene 6b — The weekly report, written by NURU (A, then C)

- On A (jolama), open WERIS → **Reports** → **Individual (Interns) Reports**: "Weekly Report — 2026-W44 (2026-10-26 → 2026-11-01)", six projects with **last week's promise**, the footer "10 items need progress before you can submit."
- Say (or type) **exactly**: **"Jaza ripoti yangu ya wiki: SGRFasta nimemaliza kuboresha injini ya AI, GoPost bado nahangaika na API ya TikTok, mingine yote inaendelea vizuri."**
- NURU writes the report **in English** with one call, then the cursor fills card after card (Projects, then Assignments and PDPs), clicks **Done** for SGRFasta and saves the draft. Point at the chips **✦ Imeandaliwa na NURU** (and **· Hakiki** on generic wording).
- NURU summarises in Swahili and asks **"Niwasilishe ripoti hii?"** → **"Ndiyo."** Status becomes **SUBMITTED**; on C, Dkt. Halima's NURU says **"Jolama amewasilisha ripoti ya wiki 2026-W44."**
- Alternatives: **"Tujaze ripoti pamoja."** (card by card; answer each question, then **"Mengine yote yaendelee vizuri."**) or **"Niandikie ripoti yangu ya wiki."** (NURU writes everything; generic items are marked **Hakiki**).
- **Fallback:** say "Hapana" to the submit question (the draft stays), or fill one card by hand and click **Save Draft**.

## Scene 7 — The activity log (A)

- Open **Shughuli** in the Hub. Every task is listed with its system, the steps NURU took, the confirmations asked and the answers, the outcome and the duration. Expand one row. **Pakua CSV** exports it.

---

## If something goes wrong

| Problem | Do this |
|---|---|
| NURU does not speak | Tap **Gusa ili kuanza** (`/hub?unlock=1`); check the volume; NURU still writes everything in the panel |
| The microphone does not hear | Use Google Chrome; allow the microphone in the address bar; type instead (Alt+S opens the panel) |
| Reminder too slow | Demo panel → **Toa kikumbusho kinachofuata sasa** |
| Phone stopped announcing | Pull to refresh; it reconnects and shows open reminders |
| Katibu not connected | Start KatibuAI; demo panel shows the connection state |
| Data in a strange state | Demo panel → **Rejesha data ya onyesho** |
| KatibuAI slow (stuck at a stage) | Switch to **Rekodi ya mfano** for the next meeting; show the rehearsal minutes and the journey panel |
| The new version misbehaves | Stop it (Ctrl+C) and run the stable copy: `cd ../eSIRI-demo && ./start.sh` (see `docs/DEMO_FALLBACK.md`) |
