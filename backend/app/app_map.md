# e-Mikutano app map

The signed-in user is Jolama. The UI language is English (en) or Swahili (sw); element ids never change with language, only labels do.

## Reading the snapshot
- `page`: landing | rooms | recordings | room | meeting | audit.
- `state.rooms`: every room with `id`, `name`, `token`, `last_session`. Use these ids to build element ids such as `room-card.{roomId}.open`.
- `state.current_room` (on room and meeting pages): `settings` toggles, `viewer_code`, `moderator_code`, `shared_users`, `presentation`, `recordings`.
- `state.meeting` (meeting page only): `recording`, `mic` (on/off; off = muted), `camera`, `screen_share`, `hand_raised`, `panel`, `last_chat_messages`, `notes_length`.
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
- Top bar: `meeting.record-toggle` ⚠ (Start recording / Stop recording; sensitive both ways; disabled when the room's Allow recording setting is off), `meeting.leave` ⚠ (Leave meeting; sensitive).
- Bottom bar: `meeting.mic-toggle` (mute/unmute; state off = muted), `meeting.camera-toggle`, `meeting.screenshare-toggle`, `meeting.raise-hand` (raise/lower hand), `meeting.reactions-btn` opens the reactions picker with `meeting.reaction.thumbs`, `meeting.reaction.clap`, `meeting.reaction.laugh`, `meeting.reaction.heart`, `meeting.reaction.party`.

### Audit Log `/audit` (page = audit)
- Reached via `header.user-menu` → `header.menu.audit-log`.
- `audit.export-csv` downloads the log as CSV. `audit.clear` opens a confirmation (open_modal = clear-audit) with `audit.clear-confirm` ⚠ and `audit.clear-cancel`.
- Filter chips `audit.filter.all`, `audit.filter.completed`, `audit.filter.declined`, `audit.filter.cancelled`, `audit.filter.failed`.

### Always available
- `toast.close` closes the visible notification (it is not listed in `elements`; use it only when the user asks to close a notification and `toasts` is not empty).
- navigate tool: only when no visible element leads there (for example the landing page when signed out, or a room page when you are deep in another page). navigate to "room" or "meeting" needs `room_id`. Navigating into a meeting is sensitive (needs confirmation); you cannot navigate away from a meeting – use `meeting.leave`.

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
