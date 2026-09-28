import { useApp, formatDateLong, formatTime } from '../store/appStore';
import { userById } from '../store/data';
import { pageFromPath, roomIdFromPath } from './nav';

export interface ElementInfo {
  id: string;
  role: string;
  label: string;
  state?: string;
  value?: string;
  disabled?: boolean;
  sensitive?: boolean;
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
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) info.value = el.value.slice(0, 120);
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

export function buildSnapshot(): Record<string, unknown> {
  const s = useApp.getState();
  const path = window.location.pathname;
  const page = pageFromPath(path);
  const roomId = roomIdFromPath(path);
  const room = roomId ? s.rooms.find((r) => r.id === roomId) : undefined;

  const state: Record<string, unknown> = {
    signed_in: s.signedIn,
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
      recordings: s.recordings
        .filter((r) => r.roomId === room.id)
        .map((r) => ({ id: r.id, name: r.name, duration_sec: r.durationSec })),
    };
    const tab = document.querySelector('[data-esiri-id^="room.tab."][data-esiri-state="selected"]');
    if (tab) state.current_tab = tab.getAttribute('data-esiri-id')?.replace('room.tab.', '');
  }

  if (page === 'meeting' && s.live && room) {
    const m = s.meetings[room.id] ?? { chat: [], notes: '' };
    state.meeting = {
      recording: s.live.recording ? 'on' : 'off',
      mic: s.live.mic ? 'on' : 'off (muted)',
      camera: s.live.camera ? 'on' : 'off',
      screen_share: s.live.screenShare ? 'on' : 'off',
      hand_raised: s.live.handRaised ? 'yes' : 'no',
      panel: s.live.panel,
      last_chat_messages: m.chat.slice(-5).map((c) => `${c.author}: ${c.text}`),
      notes_length: m.notes.length,
    };
  }

  if (page === 'recordings') {
    state.all_recordings = s.recordings.map((r) => ({
      id: r.id,
      name: r.name,
      room: s.rooms.find((x) => x.id === r.roomId)?.name ?? r.roomId,
    }));
  }

  if (page === 'audit') {
    state.audit_records = s.audit.length;
  }

  const modal = openModalEl();
  return {
    page,
    route: path,
    language: s.language,
    open_modal: modal?.getAttribute('data-esiri-modal') ?? null,
    toasts: s.toasts.map((t) => t.text),
    state,
    elements: visibleElements(),
  };
}
