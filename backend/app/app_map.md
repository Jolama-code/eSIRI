# NURU app map (NURU Hub, e-Mikutano, GMS, WERIS)

The signed-in user is in `snapshot.user` (name, role supervisor|staff, id). The UI language is English (en) or Swahili (sw); element ids never change with language, only labels do.

## People (directory, all @mfano.go.tz)
| user id | name | e-mail | notes |
|---|---|---|---|
| 1 | Jolama | jolama@mfano.go.tz | ICT Officer, staff (supervisor: Dkt. Halima Said) |
| 2 | Dkt. Halima Said | halima.said@mfano.go.tz | Head of Section, supervisor |
| 3 | Baraka Mollel | baraka.mollel@mfano.go.tz | Systems Officer, staff |
| 4 | Neema Mwakalinga | neema.mwakalinga@mfano.go.tz | Principal Systems Analyst |
| 5 | Juma Hassan | juma.hassan@mfano.go.tz | Planning Officer |
| 6 | Zawadi Kimaro | zawadi.kimaro@mfano.go.tz | Records Officer |
| 7 | Timu ya TEHAMA (the ICT team) | tehama@mfano.go.tz | group address |
| 8 | Dawati la Msaada la TEHAMA (ICT helpdesk) | helpdesk@mfano.go.tz | |
Only these addresses exist; sending outside mfano.go.tz is refused.

## Reading the snapshot
- `system`: hub | mikutano | gms | weris. `page`: see each system below (navigate tool page names are the same).
- e-Mikutano pages: landing | rooms | recordings | room | meeting | audit.
- `state.rooms`: every room with `id`, `name`, `token`, `last_session`. Use these ids to build element ids such as `room-card.{roomId}.open`.
- `state.current_room` (on room and meeting pages): `settings` toggles, `viewer_code`, `moderator_code`, `shared_users`, `presentation`, `recordings`.
- `state.meeting` (meeting page only): `live`, `recording`, `mic` (on/off; off = muted), `camera`, `screen_share`, `hand_raised`, `moderator_mode`, `lobby` (people waiting), `participants` (admitted), `panel`, `last_chat_messages`, `notes_length`.
- `state.open_reminders`: reminders NURU is showing right now (any system).
- `elements`: the actionable elements visible right now: `{id, role, label, state/value, disabled, sensitive}`. When a modal is open (`open_modal`), only the modal's elements are listed; close it or finish inside it first.
- `sensitive: true` elements can only be clicked after ask_confirmation was approved (each approval allows `covers` sensitive clicks).

## Pages and how to get there

### Landing page `/` (page = landing)
Entry screen of e-Mikutano. Shown when signed out.
- `landing.lang.sw` / `landing.lang.en`: switch the UI language (prefer the set_language tool instead).
- `landing.token-input`: meeting token field (tokens look like `BRD-4K7Q`, see `state.rooms[].token`).
- `landing.join-btn` ⚠: "Start meeting" – joins the meeting of the room whose token was typed (opens the meeting page). Sensitive.
- `landing.reserve-btn`: "Reserve a meeting" – signs Jolama in and opens the Rooms dashboard. Use it whenever you need rooms but are on the landing page.

### Rooms dashboard `/rooms` (page = rooms)
- `header.home`: e-Mikutano logo, goes to the Rooms dashboard.
- `header.user-menu`: opens the user dropdown containing `header.menu.audit-log` (opens the Audit Log), `header.menu.reset-demo` (resets all demo data) and `header.menu.sign-out` (signs out, goes to landing). The dropdown items only exist after clicking `header.user-menu`.
- `rooms.tab.rooms`, `rooms.tab.recordings`: tabs; Recordings opens `/recordings` with all recordings.
- `rooms.search`: filters the room cards by name.
- `rooms.new-room-btn`: "+ New Room" – opens the Create New Room modal.
- Per room card: `room-card.{roomId}.open` (opens the room page), `room-card.{roomId}.copy-link` (copies the join link), `room-card.{roomId}.start` ⚠ (starts the meeting immediately = sensitive).

### Create New Room modal (open_modal = create-room)
- `create-room.name-input`: the room name. Type the name exactly as the user said it (never translate it).
- `create-room.submit` ⚠: "Create Room" – creates the room and opens its room page with the toast "A new room has been created." Sensitive.
- `create-room.close`: closes the modal without creating.
- Typical flow: click `rooms.new-room-btn` and type_text `create-room.name-input` (its result says whether a room with exactly that name already exists), then ask_confirmation, then click `create-room.submit`. If the name is a duplicate, close the modal with `create-room.close` before asking the user what to do.

### Room page `/rooms/{roomId}` (page = room)
- `room.home-btn`: back to the Rooms dashboard.
- `room.copy-link`: copies the join link.
- `room.start-meeting` ⚠: "Start Meeting" – opens the meeting screen of this room. Sensitive.
- Tabs: `room.tab.recordings`, `room.tab.presentation`, `room.tab.access`, `room.tab.settings`. The tab contents below only exist after clicking the tab.

#### Recordings tab
- Lists this room's recordings (`state.current_room.recordings`): `recording.{recId}.play` (plays a preview), `recording.{recId}.delete` ⚠ (deletes the recording; sensitive).

#### Presentation tab
- Upload area for human users (drag and drop) – you cannot upload local files.
- "Add from e-Office documents": `presentation.sample.meeting-agenda.add` (Meeting_Agenda.pdf), `presentation.sample.budget-2026-27.add` (Budget_2026_27.pptx), `presentation.sample.previous-minutes.add` (Previous_Minutes.pdf). "The meeting agenda" means Meeting_Agenda.pdf, "the budget" means Budget_2026_27.pptx, "the previous minutes" means Previous_Minutes.pdf.
- Added files: `presentation.file.{fileId}.remove`. The first file in the list is the default presentation shown on the meeting's main slide.

#### Access tab
- `access.share-btn`: "Share Access" – opens the Share Access modal (open_modal = share-access).
- In the modal: `access.search-input` (filters the directory), `access.user.{userId}.add` (grants access), `access.modal.close` (closes the modal).
- Directory user ids: `juma-hassan` (Juma Hassan), `neema-mwakalinga` (Neema Mwakalinga), `baraka-temba` (Baraka Temba), `zawadi-kimaro` (Zawadi Kimaro), `daudi-mollel` (Daudi Mollel), `rehema-swai` (Rehema Swai). Users who already have access are not shown with an Add button.
- Typical batch: click `room.tab.access`, click `access.share-btn`, click `access.user.{userId}.add`, click `access.modal.close`.
- Shared users list: `access.shared.{userId}.remove` ⚠ (removes a person's access; sensitive).

#### Settings tab
- Toggles (state on/off; clicking flips it): `settings.toggle.mute-on-join` (Mute users on join), `settings.toggle.require-approval` (Require moderator approval before joining), `settings.toggle.anyone-can-start` (Allow any user to start this meeting), `settings.toggle.all-moderators` (All users join as moderators), `settings.toggle.allow-recording` (Allow recording, ON by default). Only click a toggle if its current state differs from what the user wants.
- Access codes: `settings.viewer-code.generate` / `settings.viewer-code.delete` and `settings.moderator-code.generate` / `settings.moderator-code.delete`. Generate creates a random 6-digit code (it replaces an existing one). The code value appears in `state.current_room.viewer_code` / `moderator_code` after the action; read it from there.
- Rename: `settings.room-name-input` then `settings.room-name-save`.
- `settings.delete-room` opens a confirmation modal (open_modal = delete-room) with `delete-room.confirm` ⚠ (deletes the room, goes to the Rooms dashboard) and `delete-room.cancel`.

### All recordings `/recordings` (page = recordings)
- Recordings from every room with `recording.{recId}.play` and `recording.{recId}.delete` ⚠. `rooms.tab.rooms` goes back to the rooms.

### Meeting screen `/rooms/{roomId}/meeting` (page = meeting)
- Left sidebar: `meeting.panel.public-chat` (shows Public Chat), `meeting.panel.shared-notes` (shows Shared Notes). Users list shows "Jolama (You)".
- Public Chat (visible when panel = chat): `meeting.chat-input` then `meeting.chat-send` to post a message. Typical batch: click `meeting.panel.public-chat` only if the chat panel is not already open, type_text `meeting.chat-input`, click `meeting.chat-send`.
- Shared Notes (visible when panel = notes): `meeting.notes-input` (type_text replaces the whole notes text).
- Moderator mode (moderator_mode tool): a badge "Nuru is moderating" with `meeting.moderator.handback` ("I'm back"; hands control back). A waiting-room panel lists people with `meeting.lobby.{id}.admit` and `meeting.lobby.{id}.deny`; in moderator mode NURU admits them by itself.
- A red "Recording for KatibuAI" label shows that the meeting audio is being recorded for the minutes.
- Top bar: `meeting.record-toggle` ⚠ (Start recording / Stop recording; sensitive both ways; disabled when the room's Allow recording setting is off), `meeting.leave` ⚠ (Leave meeting; sensitive).
- Bottom bar: `meeting.mic-toggle` (mute/unmute; state off = muted), `meeting.camera-toggle`, `meeting.screenshare-toggle`, `meeting.raise-hand` (raise/lower hand), `meeting.reactions-btn` opens the reactions picker with `meeting.reaction.thumbs`, `meeting.reaction.clap`, `meeting.reaction.laugh`, `meeting.reaction.heart`, `meeting.reaction.party`.

### Audit Log `/audit` (page = audit)
- Reached via `header.user-menu` → `header.menu.audit-log`.
- `audit.export-csv` downloads the log as CSV. `audit.clear` opens a confirmation (open_modal = clear-audit) with `audit.clear-confirm` ⚠ and `audit.clear-cancel`.
- Filter chips `audit.filter.all`, `audit.filter.completed`, `audit.filter.declined`, `audit.filter.cancelled`, `audit.filter.failed`.

## NURU Hub (system = hub)

### Today `/hub` (page hub_today)
- `state.today`: the day's items in time order (`key`, `time`, `title`, `kind`, `done`; meetings also `room_id`, `meeting_status`, `i_organize`). `state.my_tasks`, `state.unread_mail`, `state.minutes`.
- `hub.today.plan-btn`: "Plan my day" (morning briefing; the user talks, not you).
- Per item: `hub.item.{key}.start` ⚠ (start/join a meeting item), `hub.item.{key}.done` (mark done), `hub.item.{key}.delete` (briefing/manual items).
- Side navigation: `hub.nav.today`, `hub.nav.tasks`, `hub.nav.meetings`, `hub.nav.minutes`, `hub.nav.notifications`, `hub.nav.systems`, `hub.nav.activity`, `hub.nav.settings`.

### Tasks `/hub/tasks` (hub_tasks)
- `state.my_tasks` / `state.tasks_i_assigned`. Tabs `hub.tasks.tab.mine`, `hub.tasks.tab.assigned` (supervisors). Each of my tasks: `hub.task.{id}.status` (select: assigned, in_progress, done).

### Meetings `/hub/meetings` (hub_meetings)
- `state.meetings`. `hub.meeting.{id}.open` ⚠ opens the meeting in e-Mikutano (starts/joins it).

### Minutes `/hub/minutes` and `/hub/minutes/{jobId}` (hub_minutes, hub_minutes_detail)
- List rows `hub.minutes.{jobId}.open`. Detail: `state.open_minutes` (summary, decisions, deliveries), language `hub.minutes.lang.sw` / `hub.minutes.lang.en`, downloads `hub.minutes.download.{sw|en}.{pdf|docx}`, `hub.minutes.send` opens a confirmation modal (send-minutes) with `send-minutes.confirm` ⚠ and `send-minutes.cancel`. Prefer the katibu_send_minutes tool.

### Other Hub pages
- Notifications (hub_notifications): `hub.notifications.read-all`. Systems (hub_systems): `hub.systems.mikutano`, `hub.systems.gms`, `hub.systems.weris`. Activity (hub_activity): filters `hub.activity.filter.*`, `hub.activity.export`. Settings (hub_settings): `settings.language.sw|en`, `settings.voice` (switch), `settings.lead.{2|5|10|15}`, `settings.audio.live|sample`, `settings.wake` (switch).

## GMS — Government Mailing System (system = gms)

### Mailbox `/gms/{folder}` (gms_inbox, gms_drafts, gms_sent, gms_trash) and reading `/gms/{folder}/{id}` (gms_read)
- `state.messages`: the folder's messages (`id`, `from`, `from_addr`, `subject`, `date`, `unread`). `state.opened_email` (gms_read): `from`, `from_addr`, `to`, `cc`, `subject`, `date`, `body` (up to 2,000 characters).
- Folders `gms.folder.inbox`, `gms.folder.drafts`, `gms.folder.sent`, `gms.folder.junk`, `gms.folder.trash`; `gms.search`; `gms.refresh`; left rail `gms.nav.compose` (new e-mail), `gms.nav.mail`.
- Each message: `gms.message.{id}.open` (opens it; drafts open in compose).
- Reading toolbar (an e-mail is open): `gms.read.reply` (fills To and "Re: subject"), `gms.read.reply-all`, `gms.read.forward`, `gms.read.delete`.

### Compose `/gms/compose` (gms_compose)
- `state.compose`: `to`, `cc`, `subject`, `body`, `replying_to`, `draft_saved`, `send_error`.
- Fields: `gms.compose.to` (comma-separated addresses), `gms.compose.cc`, `gms.compose.subject`, `gms.compose.body` (ONLY the message text: greeting, message, closing — the signature and the quoted original are added automatically below it). type_text replaces the whole field; to change a draft, type the whole new body.
- `gms.compose.save` saves a draft (drafts also save automatically). `gms.compose.discard` throws the draft away.
- `gms.compose.send` ⚠ sends (sensitive). Afterwards the app opens Sent. If `send_error` is set (e.g. an address outside mfano.go.tz), tell the user.

## WERIS (system = weris)
- Navigation: `weris.nav.dashboard`, `weris.nav.projects`, `weris.nav.pdp`, `weris.nav.assignment` (special tasks), `weris.nav.reports`.
- Dashboard `/weris` (weris_dashboard): `state.dashboard` (counts by status and category, projects not reported this week).
- Projects `/weris/projects` (weris_projects): `state.projects`; filters `weris.projects.filter-status|filter-type|filter-maturity` (selects), `weris.projects.search`, `weris.projects.add` (modal weris-add-project: `weris.project.title`, `weris.project.submit`), `weris.projects.export`.
- PDP `/weris/pdp` (weris_pdp): tabs `weris.pdp.tab.pdp|projects|activities`, `weris.pdp.new` (modal: `weris.pdp.skill`, `weris.pdp.submit`).
- Reports `/weris/reports` (weris_reports): `state.reports`; `weris.reports.continue` (modal weris-report: `weris.report.content`, `weris.report.save`, `weris.report.submit`).

### Special tasks `/weris/tasks` (weris_tasks)
- `state.special_tasks`: `id`, `title`, `assigned_by`, `assigned_to`, `due`, `status`, `can_change_status` (true for the user's own tasks).
- `weris.tasks.add`: "Add Special Tasks" opens the modal weris-add-task with: `weris.task.assignee` (select; options are people with their user id as value), `weris.task.title`, `weris.task.description`, `weris.task.start-date` (YYYY-MM-DD, defaults to today), `weris.task.end-date` (YYYY-MM-DD), `weris.task.due-time` (HH:MM), `weris.task.submit` ⚠ (sensitive when the assignee is not the user), `weris.task.cancel`. `state.add_task_form` shows the values and any error.
- Row status select (own tasks only): `weris.task.{id}.status` with values assigned, in_progress, done. Changing it tells the assigner's NURU.

### Always available
- `toast.close` closes the visible notification (it is not listed in `elements`; use it only when the user asks to close a notification and `toasts` is not empty).
- navigate tool: jump to any page by name (hub_*, gms_*, weris_*, landing, rooms, recordings, audit, room, meeting). Within a system prefer visible clicks; use navigate (for example the landing page when signed out, or a room page when you are deep in another page). navigate to "room" or "meeting" needs `room_id`. Navigating into a meeting is sensitive (needs confirmation); you cannot navigate away from a meeting – use `meeting.leave`.

## Cause and effect
- Creating a room: rooms dashboard → `rooms.new-room-btn` → type name → `create-room.submit`. The app then shows the new room page. The new room's id appears in `state.rooms` afterwards.
- "Start the meeting" for a room: open its room page (or use its room card) and click `room.start-meeting` (or `room-card.{roomId}.start`). If the user names no room and you are on a room page or in its meeting, it means that room.
- Starting or leaving a meeting updates the room's last session.
- "Mute users on join" ON makes the mic start muted when the meeting starts.
- Recording requires "Allow recording" ON in the room's Settings. If `meeting.record-toggle` is disabled, tell the user to enable Allow recording in the room settings.
- Stopping a recording saves it to the room's Recordings tab (name "<room> – <date>", real duration). Leaving the meeting while recording also stops and saves the recording.
- Leaving a meeting returns to that room's page.
- Access codes live in the Settings tab of the room. Viewer and moderator codes are 6 digits.
- The default presentation (first presentation file) is shown on the meeting's main slide.
- Shared access and presentation files are per room.
- `rooms.new-room-btn` exists only on the Rooms dashboard. From a room page, click `room.home-btn` first.
- To act on a different room than the current one, go to the Rooms dashboard (`header.home` or `room.home-btn`) and open its card, or navigate with its room_id.
- Changing the language (set_language) changes every label but never the ids.
