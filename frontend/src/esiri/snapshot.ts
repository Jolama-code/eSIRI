import { useApp, formatDateLong, formatTime } from '../store/appStore';
import { userById } from '../store/data';
import { pageFromPath, roomIdFromPath, systemFromPath } from './nav';
import { useSession } from './session';
import { useHub } from '../hub/hubStore';
import { useGms } from '../gms/gmsStore';
import { useWeris, useTaskForm } from '../weris/Weris';
import { useReport, isComplete } from '../weris/Report';
import { useNuru } from './nuruStore';
import { hm } from '../hub/ui';

export interface ElementInfo {
  id: string;
  role: string;
  label: string;
  state?: string;
  value?: string;
  disabled?: boolean;
  sensitive?: boolean;
  options?: string[];
}

export function openModalEl(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>('[data-esiri-modal]');
  return modals.length ? modals[modals.length - 1] : null;
}

export function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** True if el is not hidden behind an open modal. */
export function isReachable(el: HTMLElement): boolean {
  const modal = openModalEl();
  return !modal || modal.contains(el);
}

export function roleOf(el: HTMLElement): string {
  const explicit = el.getAttribute('data-esiri-role') ?? el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return 'textbox';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'a') return 'link';
  return 'button';
}

export function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

export function labelOf(el: HTMLElement): string {
  return (el.getAttribute('data-esiri-label') ?? el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80);
}

export function describeElement(el: HTMLElement): ElementInfo {
  const info: ElementInfo = {
    id: el.getAttribute('data-esiri-id') ?? '',
    role: roleOf(el),
    label: labelOf(el),
  };
  const state = el.getAttribute('data-esiri-state');
  if (state) info.state = state;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) info.value = el.value.slice(0, el instanceof HTMLTextAreaElement ? 1500 : 160);
  if (el instanceof HTMLSelectElement) {
    info.role = 'select';
    const sel = el.selectedOptions[0];
    info.value = sel ? `${sel.value}${sel.textContent && sel.textContent !== sel.value ? ` (${sel.textContent.trim()})` : ''}` : '';
    info.options = Array.from(el.options).map((o) => (o.textContent?.trim() || o.value) + (o.value && o.value !== o.textContent?.trim() ? ` [${o.value}]` : '')).slice(0, 30);
  }
  if (isDisabled(el)) info.disabled = true;
  if (el.getAttribute('data-esiri-sensitive') === 'true') info.sensitive = true;
  return info;
}

export function visibleElements(): ElementInfo[] {
  const modal = openModalEl();
  const scope: ParentNode = modal ?? document;
  const out: ElementInfo[] = [];
  const seen = new Set<string>();
  scope.querySelectorAll<HTMLElement>('[data-esiri-id]').forEach((el) => {
    if (el.closest('.esiri-panel')) return;
    // Toasts never block anything; the close button is documented in the app map instead,
    // so the agent does not waste steps closing notifications.
    if (el.getAttribute('data-esiri-id') === 'toast.close') return;
    if (!isVisible(el)) return;
    const info = describeElement(el);
    if (seen.has(info.id)) return;
    seen.add(info.id);
    out.push(info);
  });
  return out;
}

function lastSessionText(iso: string | null): string {
  if (!iso) return 'none';
  return `${formatDateLong(iso, 'en')} ${formatTime(iso, 'en')}`;
}

function trim(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}… [trimmed]` : text;
}

function mikutanoState(page: string, path: string): Record<string, unknown> {
  const s = useApp.getState();
  const roomId = roomIdFromPath(path);
  const room = roomId ? s.rooms.find((r) => r.id === roomId) : undefined;
  const state: Record<string, unknown> = {
    rooms: s.rooms.map((r) => ({ id: r.id, name: r.name, token: r.token, last_session: lastSessionText(r.lastSession) })),
  };
  if (room && (page === 'room' || page === 'meeting')) {
    state.current_room = {
      id: room.id,
      name: room.name,
      settings: {
        mute_on_join: room.settings.muteOnJoin ? 'on' : 'off',
        require_approval: room.settings.requireApproval ? 'on' : 'off',
        anyone_can_start: room.settings.anyoneCanStart ? 'on' : 'off',
        all_moderators: room.settings.allModerators ? 'on' : 'off',
        allow_recording: room.settings.allowRecording ? 'on' : 'off',
      },
      viewer_code: room.viewerCode ?? 'none',
      moderator_code: room.moderatorCode ?? 'none',
      shared_users: room.sharedUsers.map((id) => ({ id, name: userById(id)?.name ?? id })),
      presentation: room.presentation.map((f, i) => ({ id: f.id, name: f.name, default: i === 0 })),
      recordings: s.recordings.filter((r) => r.roomId === room.id).map((r) => ({ id: r.id, name: r.name, duration_sec: r.durationSec })),
    };
    const tab = document.querySelector('[data-esiri-id^="room.tab."][data-esiri-state="selected"]');
    if (tab) state.current_tab = tab.getAttribute('data-esiri-id')?.replace('room.tab.', '');
  }
  if (page === 'meeting' && s.live && room) {
    const m = s.meetings[room.id] ?? { chat: [], notes: '' };
    state.meeting = {
      live: 'yes',
      recording: s.live.recording ? 'on' : 'off',
      mic: s.live.mic ? 'on' : 'off (muted)',
      camera: s.live.camera ? 'on' : 'off',
      screen_share: s.live.screenShare ? 'on' : 'off',
      hand_raised: s.live.handRaised ? 'yes' : 'no',
      moderator_mode: s.live.moderator ? 'on (NURU admits people and announces them)' : 'off',
      lobby: s.live.lobby.map((p) => p.name),
      participants: s.live.participants.map((p) => p.name),
      panel: s.live.panel,
      last_chat_messages: m.chat.slice(-5).map((c) => `${c.author}: ${c.text}`),
      notes_length: m.notes.length,
    };
  }
  if (page === 'recordings') {
    state.all_recordings = s.recordings.map((r) => ({ id: r.id, name: r.name, room: s.rooms.find((x) => x.id === r.roomId)?.name ?? r.roomId }));
  }
  if (page === 'audit') state.audit_records = s.audit.length;
  return state;
}

function hubState(page: string): Record<string, unknown> {
  const h = useHub.getState();
  const state: Record<string, unknown> = {
    today: h.day.items.map((i) => ({
      key: i.key, time: hm(i.start_at), title: i.title, kind: i.kind, done: i.done,
      ...(i.type === 'meeting' ? { room_id: i.room_id, meeting_status: i.status, i_organize: i.is_organizer } : {}),
    })),
    unread_mail: h.mailUnread,
    minutes: h.jobs.slice(0, 6).map((j) => ({ job_id: j.id, title: j.title, status: j.status, progress: j.progress, audio: j.audio_source })),
  };
  if (page === 'hub_tasks' || page === 'hub_today') {
    state.my_tasks = h.tasksMine.map((t) => ({ id: t.id, title: t.title, from: t.assigned_by?.display_name, due: t.due_local, status: t.status }));
    if (h.tasksAssigned.length) state.tasks_i_assigned = h.tasksAssigned.map((t) => ({ id: t.id, title: t.title, to: t.assigned_to?.display_name, due: t.due_local, status: t.status }));
  }
  if (page === 'hub_meetings') {
    state.meetings = h.meetings.map((m) => ({ id: m.id, title: m.title, room_id: m.room_id, start: m.start_at, status: m.status }));
  }
  if (page === 'hub_minutes_detail') {
    const id = Number(window.location.pathname.split('/').pop());
    const j = h.jobs.find((x) => x.id === id);
    if (j) {
      const m = useApp.getState().language === 'sw' ? j.minutes_sw : j.minutes_en;
      state.open_minutes = {
        job_id: j.id, title: j.title, status: j.status, recipients_default: j.default_recipients?.length ?? 1,
        summary: trim(m.summary ?? '', 600), decisions: (m.decisions ?? []).slice(0, 6).map((d) => d.text),
        deliveries: j.deliveries.map((d) => `${d.email}: ${d.status}`),
      };
    }
  }
  return state;
}

function gmsState(page: string): Record<string, unknown> {
  const g = useGms.getState();
  const state: Record<string, unknown> = {
    folder: g.folder,
    unread: g.unread,
    note: 'NURU only drafts; sending needs ask_confirmation. Use only facts from the user and the opened e-mail.',
  };
  if (page !== 'gms_compose') {
    state.messages = g.messages.slice(0, 20).map((m) => ({
      id: m.id, from: m.from_name, from_addr: m.from_addr, to: m.to.map((x) => x.email).join(', '), subject: m.subject, date: m.sent_at?.slice(0, 16), unread: !m.read,
    }));
  }
  if (page === 'gms_read' && g.opened) {
    const m = g.opened;
    state.opened_email = { id: m.id, from: m.from_name, from_addr: m.from_addr, to: m.to.map((x) => x.email), cc: m.cc.map((x) => x.email), subject: m.subject, date: m.sent_at, body: trim(m.body, 2000) };
  }
  if (page === 'gms_compose') {
    const c = g.compose;
    state.compose = {
      to: c.to, cc: c.cc, subject: c.subject, body: c.body,
      replying_to: c.inReplyTo, draft_saved: c.saved === 'saved', send_error: c.error || null,
      note: 'compose body = only the message text (greeting … closing). The signature and the quoted original are added automatically below it.',
    };
  }
  return state;
}

function werisState(page: string): Record<string, unknown> {
  const w = useWeris.getState();
  const me = useSession.getState().user;
  const state: Record<string, unknown> = {};
  if (page === 'weris_tasks') {
    state.special_tasks = w.tasks.map((t) => ({
      id: t.id, title: t.title, assigned_by: t.assigned_by?.display_name, assigned_to: t.assigned_to?.display_name,
      due: t.due_local, status: t.status, can_change_status: t.assigned_to?.id === me?.id,
    }));
    const f = useTaskForm.getState();
    if (f.open) state.add_task_form = { ...f.form, error: f.error || null, note: 'assignee is a user id (see the select options). Submitting for someone else is sensitive.' };
  }
  if (page === 'weris_dashboard' && w.dashboard) state.dashboard = w.dashboard;
  if (page === 'weris_projects') state.projects = w.projects.map((p) => ({ id: p.id, title: p.title, types: p.types.join(', '), status: p.status }));
  if (page === 'weris_reports' && w.reports) state.reports = { current_week: w.reports.current_week, current_status: w.reports.current?.status, total_submitted: w.reports.total_submitted };
  const r = useReport.getState().report;
  if (page === 'weris_report' && r) {
    const cut = (x: string) => (x.length > 140 ? `${x.slice(0, 140)}…` : x);
    state.report = {
      week: r.week, status: r.status, open_tab: useReport.getState().tab,
      incomplete: r.items.filter((i) => !isComplete(i)).length,
      items: r.items.map((i) => ({
        key: i.key, kind: i.kind, name: i.name, last_week_promise: i.promise || null, outcome: i.outcome || null,
        progress: cut(i.progress), plan: cut(i.plan), blockers: cut(i.blockers), complete: isComplete(i),
        needs_review: Object.values(i.nuru).includes('review'),
      })),
      note: 'Fill it with the weris_report tool. Submitting (weris.report.submit) is sensitive.',
    };
  }
  return state;
}

export function buildSnapshot(): Record<string, unknown> {
  const s = useApp.getState();
  const path = window.location.pathname;
  const page = pageFromPath(path);
  const system = systemFromPath(path);
  const user = useSession.getState().user;

  let state: Record<string, unknown>;
  if (system === 'hub') state = hubState(page);
  else if (system === 'gms') state = gmsState(page);
  else if (system === 'weris') state = werisState(page);
  else state = mikutanoState(page, path);
  state.signed_in = !!user;
  const reminders = useNuru.getState().reminders;
  if (reminders.length) state.open_reminders = reminders.map((r) => ({ id: r.id, kind: r.kind, message: s.language === 'sw' ? r.message_sw : r.message_en }));

  const modal = openModalEl();
  return {
    system,
    page,
    route: path,
    language: s.language,
    user: user ? { name: user.display_name, role: user.role, username: user.username, id: user.id } : null,
    open_modal: modal?.getAttribute('data-esiri-modal') ?? null,
    toasts: s.toasts.map((t) => t.text),
    state,
    elements: visibleElements(),
  };
}
