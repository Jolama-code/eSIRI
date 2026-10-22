/**
 * Moderator mode in e-Mikutano: NURU keeps the user muted, turns on "Require moderator approval",
 * and admits the invitees who knock in the (simulated) lobby — visibly, with the ghost cursor — announcing each one.
 */
import { useApp, randomId, type AuditStep, type LobbyPerson } from '../store/appStore';
import { tr } from '../i18n';
import { useHub } from '../hub/hubStore';
import { currentPerson, useSession } from './session';
import { click } from './driver';
import { useEsiri } from './esiriStore';
import { announce } from './proactive';
import { logActivity } from './controller';
import { goTo, pageFromPath } from './nav';
import { rememberScheduledMeeting } from './meetingFlow';
import { sleep } from './util';
import { hideCursor } from './cursor';

const lang = () => useApp.getState().language;

interface ModSession {
  roomId: string;
  abort: AbortController;
  waiting: string[];
  timer: number;
  steps: AuditStep[];
  startedAt: number;
}

let mod: ModSession | null = null;

const FALLBACK = ['Neema Mwakalinga', 'Juma Hassan', 'Zawadi Kimaro'];

function inviteesFor(roomId: string): string[] {
  const me = useSession.getState().user;
  const meetings = useHub.getState().meetings.filter((m) => m.room_id === roomId && m.status !== 'ended');
  meetings.sort((a, b) => Math.abs(new Date(a.start_at).getTime() - Date.now()) - Math.abs(new Date(b.start_at).getTime() - Date.now()));
  const m = meetings[0];
  if (m) {
    const names = [m.organizer, ...m.invitees].filter((p): p is { id: number; display_name: string } => !!p && p.id !== me?.id).map((p) => p.display_name);
    if (names.length) return Array.from(new Set(names));
  }
  const room = useApp.getState().rooms.find((r) => r.id === roomId);
  const shared = room?.sharedUsers.map((id) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')) ?? [];
  return shared.length ? shared : FALLBACK;
}

export function moderatorActive(): boolean {
  return !!useApp.getState().live?.moderator;
}

function scheduleKnock(): void {
  if (!mod) return;
  const delay = 6000 + Math.random() * 4000; // every 6–10 seconds
  mod.timer = window.setTimeout(() => void knock(), delay);
}

async function knock(): Promise<void> {
  const s = mod;
  const live = useApp.getState().live;
  if (!s || !live || !live.moderator || live.roomId !== s.roomId) return;
  const name = s.waiting.shift();
  if (!name) return;
  const person: LobbyPerson = { id: `p-${randomId(5)}`, name, at: Date.now() };
  useApp.getState().updateLive({ lobby: [...(useApp.getState().live?.lobby ?? []), person] });
  void admitVisibly(person);
  if (s.waiting.length) scheduleKnock();
}

/** Wait until the agent is not using the cursor, then click "Ruhusu" for this person. */
async function admitVisibly(p: LobbyPerson): Promise<void> {
  const s = mod;
  if (!s) return;
  try {
    await sleep(1200, s.abort.signal);
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const st = useEsiri.getState().status;
      if (st !== 'acting' && st !== 'thinking') break;
      await sleep(300, s.abort.signal);
    }
    if (!useApp.getState().live?.lobby.some((x) => x.id === p.id)) return; // admitted by hand meanwhile
    const res = await click(`meeting.lobby.${p.id}.admit`, {
      signal: s.abort.signal,
      hasCredit: () => false,
      useCredit: () => undefined,
      appearWaitMs: 2500,
    });
    hideCursor();
    if (!res.ok && useApp.getState().live?.lobby.some((x) => x.id === p.id)) admit(p.id); // off-screen: admit anyway
  } catch {
    /* moderator mode ended */
  }
}

/** Admit someone from the lobby (button handler; also used by NURU's visible click). */
export function admit(id: string): void {
  const live = useApp.getState().live;
  if (!live) return;
  const p = live.lobby.find((x) => x.id === id);
  if (!p) return;
  useApp.getState().updateLive({
    lobby: live.lobby.filter((x) => x.id !== id),
    participants: [...live.participants, p],
    admittedWhileModerating: live.moderator ? [...live.admittedWhileModerating, p.name] : live.admittedWhileModerating,
  });
  if (live.moderator) {
    mod?.steps.push({ time: new Date().toISOString(), tool: 'admit', target: p.name, ok: true });
    void announce(tr(lang(), 'moderator.joined', { name: p.name }), { force: true });
  }
}

export function deny(id: string): void {
  const live = useApp.getState().live;
  if (!live) return;
  useApp.getState().updateLive({ lobby: live.lobby.filter((x) => x.id !== id) });
}

export interface ModeratorResult {
  ok: boolean;
  error?: string;
  code?: 'invalid';
  [k: string]: unknown;
}

/** Turn moderator mode on for the live meeting (the caller has already checked consent). */
export function enableModerator(muteUser: boolean): ModeratorResult {
  const app = useApp.getState();
  const live = app.live;
  if (!live || pageFromPath(window.location.pathname) !== 'meeting') {
    return { ok: false, code: 'invalid', error: 'The meeting is not live. Start the meeting first (room.start-meeting, after confirmation), then turn on moderator mode.' };
  }
  stopModeratorTimers();
  const room = app.rooms.find((r) => r.id === live.roomId);
  if (room && !room.settings.requireApproval) app.setSetting(room.id, 'requireApproval', true);
  app.updateLive({ moderator: true, admittedWhileModerating: [], ...(muteUser ? { mic: false } : {}) });
  const already = new Set([...live.participants.map((p) => p.name), ...live.lobby.map((p) => p.name)]);
  mod = {
    roomId: live.roomId,
    abort: new AbortController(),
    waiting: inviteesFor(live.roomId).filter((n) => !already.has(n) && n !== currentPerson().name),
    timer: 0,
    steps: [],
    startedAt: Date.now(),
  };
  scheduleKnock();
  return {
    ok: true,
    moderator: 'on',
    muted: muteUser || !live.mic,
    require_approval: 'on',
    expected_people: mod.waiting,
    note: 'Moderator mode is on. NURU admits people from the lobby by itself and announces them. Finish with a short confirmation.',
  };
}

function stopModeratorTimers(): void {
  if (mod) {
    window.clearTimeout(mod.timer);
    mod.abort.abort();
  }
}

/** Hand control back: stop admitting and summarise who joined. */
export function disableModerator(reason: 'handback' | 'left' = 'handback'): ModeratorResult {
  const live = useApp.getState().live;
  const names = live?.admittedWhileModerating ?? [];
  const s = mod;
  stopModeratorTimers();
  mod = null;
  if (live?.moderator) useApp.getState().updateLive({ moderator: false, admittedWhileModerating: [] });
  const summary = tr(lang(), names.length ? 'moderator.summary' : 'moderator.summaryNone', { n: names.length, names: names.join(', ') });
  if (s && live?.moderator) {
    logActivity({
      system: 'mikutano',
      request: tr(lang(), 'moderator.auditRequest'),
      outcome: 'Completed',
      finalMessage: reason === 'left' ? tr(lang(), 'moderator.endedLeft') : summary,
      steps: s.steps,
      startedAt: s.startedAt,
    });
  }
  return { ok: true, moderator: 'off', admitted: names, summary, note: 'Say the summary to the user with finish.' };
}

/** Human "Nimerudi" button on the moderator badge. */
export function handBack(): void {
  const r = disableModerator();
  void announce(String(r.summary), { force: true });
}

/** From a reminder card or a plain spoken yes: open the meeting, optionally mute and moderate. */
export async function startModerated(roomId: string, meetingId: number | null, opts: { moderator: boolean; mute: boolean }, reminderText: string): Promise<void> {
  const started = Date.now();
  rememberScheduledMeeting(roomId, meetingId);
  const steps: AuditStep[] = [];
  if (useApp.getState().live?.roomId !== roomId || pageFromPath(window.location.pathname) !== 'meeting') {
    goTo(`/rooms/${roomId}/meeting`);
    steps.push({ time: new Date().toISOString(), tool: 'navigate', target: `meeting (${roomId})`, ok: true });
  }
  for (let i = 0; i < 40 && !(useApp.getState().live?.roomId === roomId && pageFromPath(window.location.pathname) === 'meeting'); i++) await sleep(100);
  if (opts.mute) useApp.getState().updateLive({ mic: false });
  let line = tr(lang(), 'moderator.started');
  if (opts.moderator) {
    const r = enableModerator(opts.mute);
    steps.push({ time: new Date().toISOString(), tool: 'moderator_mode', target: 'on', ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    line = tr(lang(), opts.mute ? 'moderator.onMuted' : 'moderator.on');
  }
  logActivity({
    system: 'mikutano',
    request: reminderText,
    outcome: 'Completed',
    finalMessage: line,
    inputMode: 'auto',
    confirmations: [{ summary: reminderText, result: 'approved' }],
    steps,
    startedAt: started,
  });
  void announce(line, { force: true });
}
