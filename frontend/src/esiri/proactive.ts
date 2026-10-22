/**
 * Proactive NURU: reacts to server events (reminders, NURU-to-NURU announcements, Katibu progress),
 * speaks without being asked, and lets the user answer by voice or tap.
 */
import { onEvent, onReconnect, startEvents, stopEvents, type NuruEvent } from './events';
import { api, useSession } from './session';
import { useNuru, type ReminderCard } from './nuruStore';
import { useEsiri } from './esiriStore';
import { useApp } from '../store/appStore';
import { tr, type I18nKey } from '../i18n';
import { audioUnlocked, isMuted, speak, stopSpeaking, unlockAudio } from './tts';
import { listenOnce, stopListening, sttSupported } from './stt';
import { startMicLevel, stopMicLevel } from './audioLevel';
import { isStopUtterance, parseYesNo, sleep } from './util';
import { goTo, pageFromPath } from './nav';
import { useHub, type KatibuJobRow } from '../hub/hubStore';
import { logActivity, submit } from './controller';
import { briefingSeenToday, startBriefing } from './briefing';

const lang = () => useApp.getState().language;
const nuru = () => useNuru.getState();
const voiceOn = () => useSession.getState().user?.voice_enabled !== false;

function msg(e: { message_sw: string; message_en: string }): string {
  return lang() === 'sw' ? e.message_sw : e.message_en;
}

// ---------------------------------------------------------------------------
// Speech queue: proactive speech never talks over the agent or over itself.

let queue: Promise<void> = Promise.resolve();

function agentBusy(): boolean {
  const s = useEsiri.getState().status;
  return s === 'thinking' || s === 'acting' || s === 'awaiting_confirmation' || s === 'awaiting_answer' || s === 'listening';
}

async function waitIdle(maxMs = 60000): Promise<void> {
  const until = Date.now() + maxMs;
  while ((agentBusy() || useEsiri.getState().micOpen) && Date.now() < until) await sleep(300);
}

/** Speak a proactive message after the agent is idle. Resolves when spoken (or skipped). */
export function announce(text: string, opts: { force?: boolean } = {}): Promise<void> {
  const job = queue.then(async () => {
    if (!text || (!voiceOn() && !opts.force)) return;
    await waitIdle();
    const es = useEsiri.getState();
    const prev = es.status;
    es.setStatus('speaking');
    await speak(text, lang());
    if (useEsiri.getState().status === 'speaking') es.setStatus(prev === 'speaking' ? 'idle' : prev);
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Listen for one answer with orb visuals (no-op when voice input is unavailable). */
async function hear(): Promise<string | null> {
  if (!sttSupported() || isMuted()) return null;
  const es = useEsiri.getState();
  es.setMicOpen(true);
  void startMicLevel();
  const res = await listenOnce(lang(), (txt) => es.setInterim(txt));
  stopMicLevel();
  es.setMicOpen(false);
  es.setInterim('');
  return res.text ?? null;
}

/**
 * Ask a yes/no question out loud with a card (used after a meeting ends).
 * Resolves true/false, or null if unanswered by voice (the card then waits for a tap).
 */
let yesNoResolve: ((v: boolean) => void) | null = null;

export function answerYesNo(v: boolean): void {
  const r = yesNoResolve;
  yesNoResolve = null;
  stopListening();
  r?.(v);
}

export async function askYesNo(question: string): Promise<boolean> {
  const answer = new Promise<boolean>((resolve) => {
    yesNoResolve = resolve;
  });
  void (async () => {
    await announce(question, { force: true });
    for (let attempt = 0; attempt < 2 && yesNoResolve; attempt++) {
      const text = await hear();
      if (!yesNoResolve) return;
      if (!text) return; // wait for a tap
      const yn = parseYesNo(text);
      if (yn) {
        answerYesNo(yn === 'yes');
        return;
      }
      if (attempt === 0) await announce(tr(lang(), 'esiri.sayYesNo'), { force: true });
    }
  })();
  return answer;
}

// ---------------------------------------------------------------------------
// Reminders

function systemNotify(title: string, body: string, link?: string): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/favicon-48.png', tag: title });
    n.onclick = () => {
      window.focus();
      if (link) goTo(link);
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
    void navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(title, { body, icon: '/icons/icon-192.png' })).catch(() => undefined);
  }
}

const LATER = /\b(baadaye|later|nikumbushe baadaye|remind me later|snooze|subiri)\b/i;

async function onReminder(e: NuruEvent): Promise<void> {
  const d = e.data as ReminderCard['data'] & { reminder_id: number; kind: ReminderCard['kind'] };
  const card: ReminderCard = { id: d.reminder_id, kind: d.kind, message_sw: e.message_sw, message_en: e.message_en, data: d, state: 'waiting' };
  nuru().addReminder(card);
  void useHub.getState().loadNotifications();
  systemNotify(tr(lang(), 'reminder.title'), msg(e), e.link);
  if (!voiceOn()) return;
  if (!audioUnlocked()) nuru().setUnlockNeeded(true);
  await announce(msg(e));
  // Listen for a spoken answer right after speaking (like confirmations).
  if (!nuru().reminders.some((r) => r.id === card.id && r.state === 'waiting')) return;
  if (agentBusy()) return;
  const text = await hear();
  if (!text || !nuru().reminders.some((r) => r.id === card.id && r.state === 'waiting')) return;
  await handleReminderAnswer(card.id, text, 'voice');
}

/** A spoken or typed answer to a reminder card. Unclear answers leave the card waiting for a tap. */
export async function handleReminderAnswer(id: number, text: string, mode: 'voice' | 'text'): Promise<void> {
  const card = nuru().reminders.find((r) => r.id === id);
  if (!card) return;
  if (isStopUtterance(text)) return;
  const clean = text.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  if (LATER.test(clean)) {
    await snoozeReminder(id);
    return;
  }
  const yn = parseYesNo(text);
  if (yn === 'no' && words.length <= 3) {
    await dismissReminder(id);
    void announce(tr(lang(), 'reminder.okNoted'));
    return;
  }
  if (yn === 'yes' && words.length <= 2) {
    // A plain "yes" to "Shall I start it / connect you?"
    if (card.kind === 'meeting') await startMeetingFromReminder(id, { moderator: false, mute: false });
    else await openReminderTarget(id);
    return;
  }
  if (card.kind === 'meeting' && (yn === 'yes' || /\b(anza|anzisha|start|nyamazisha|mute|msimamizi|moderator|unganisha|join)\b/.test(clean))) {
    // A richer answer ("Ndiyo, anza kama msimamizi na uninyamazishe"): the agent handles it, with the reminder as context.
    claimReminder(card);
    const ctx =
      `[Context: NURU has just reminded the user: "${msg(card)}". Scheduled meeting "${card.data.title ?? ''}" ` +
      `(meeting id ${card.data.meeting_id ?? '?'}) is in e-Mikutano room id "${card.data.room_id ?? ''}"; the user is ` +
      `${card.data.organizer ? 'its organizer' : 'an invitee'}.` +
      (yn === 'yes'
        ? ' The user ALREADY APPROVED starting/joining this meeting and moderator mode by answering the reminder: do not call ask_confirmation again for those.]'
        : ']');
    useEsiri.getState().setPanelOpen(true);
    void submit(text, mode, {
      context: ctx,
      preapproved: yn === 'yes' ? { summary: msg(card), covers: 3 } : undefined,
    });
    return;
  }
  // Not understood: keep the card waiting for a tap.
}

function claimReminder(card: ReminderCard): void {
  nuru().patchReminder(card.id, { state: 'handling' });
  void api(`/api/reminders/${card.id}/dismiss`, { method: 'POST' }).catch(() => undefined);
  window.setTimeout(() => nuru().removeReminder(card.id), 600);
}

export async function snoozeReminder(id: number): Promise<void> {
  nuru().removeReminder(id);
  stopListening();
  await api(`/api/reminders/${id}/snooze`, { body: { minutes: 5 } }).catch(() => undefined);
  logActivity({ system: 'hub', request: tr(lang(), 'reminder.auditSnooze'), outcome: 'Completed', finalMessage: tr(lang(), 'reminder.snoozed') });
  void announce(tr(lang(), 'reminder.snoozed'));
}

export async function dismissReminder(id: number): Promise<void> {
  nuru().removeReminder(id);
  stopListening();
  await api(`/api/reminders/${id}/dismiss`, { method: 'POST' }).catch(() => undefined);
}

export async function openReminderTarget(id: number): Promise<void> {
  const card = nuru().reminders.find((r) => r.id === id);
  if (!card) return;
  claimReminder(card);
  if (card.kind === 'task') goTo('/weris/tasks');
  else goTo('/hub');
}

/** "Anzisha kama msimamizi" / a plain yes: start (or join) the meeting, optionally in moderator mode. */
export async function startMeetingFromReminder(id: number, opts: { moderator: boolean; mute: boolean }): Promise<void> {
  const card = nuru().reminders.find((r) => r.id === id);
  if (!card || !card.data.room_id) return;
  claimReminder(card);
  stopListening();
  stopSpeaking();
  const { startModerated } = await import('./moderator');
  await startModerated(card.data.room_id, card.data.meeting_id ?? null, opts, msg(card));
}

// ---------------------------------------------------------------------------
// NURU-to-NURU announcements and refreshes

function toastFor(e: NuruEvent, kind: string): void {
  const title = lang() === 'sw' ? e.title_sw ?? '' : e.title_en ?? '';
  nuru().pushToast({ kind, title, body: msg(e), link: e.link });
}

async function onKatibuReady(e: NuruEvent): Promise<void> {
  const job = (e.data.job ?? null) as KatibuJobRow | null;
  if (job) useHub.getState().upsertJob(job);
  toastFor(e, 'katibu_ready');
  systemNotify(lang() === 'sw' ? e.title_sw ?? '' : e.title_en ?? '', msg(e), e.link);
  void useHub.getState().loadNotifications();
  await announce(msg(e));
  // The minutes open in the Hub (unless NURU is in the middle of something).
  if (job && !agentBusy() && pageFromPath(window.location.pathname) !== 'meeting') goTo(`/hub/minutes/${job.id}`);
}

let wired = false;
const unsubs: (() => void)[] = [];

export function initProactive(): void {
  if (wired) return;
  wired = true;
  const refreshAll = () => void useHub.getState().loadAll();
  unsubs.push(
    onEvent('reminder', (e) => void onReminder(e)),
    onEvent('reminder_closed', (e) => nuru().removeReminder(Number(e.data.reminder_id))),
    onEvent('task_assigned', (e) => {
      toastFor(e, 'task');
      systemNotify(lang() === 'sw' ? e.title_sw ?? '' : e.title_en ?? '', msg(e), e.link);
      void useHub.getState().loadTasks();
      void useHub.getState().loadDay();
      void useHub.getState().loadNotifications();
      window.dispatchEvent(new CustomEvent('nuru:tasks'));
      void announce(msg(e));
    }),
    onEvent('task_updated', (e) => {
      void useHub.getState().loadTasks();
      void useHub.getState().loadDay();
      window.dispatchEvent(new CustomEvent('nuru:tasks'));
      if (e.announce) {
        toastFor(e, 'task');
        void useHub.getState().loadNotifications();
        systemNotify(lang() === 'sw' ? e.title_sw ?? '' : e.title_en ?? '', msg(e), e.link);
        void announce(msg(e));
      }
    }),
    onEvent('mail_received', (e) => {
      void useHub.getState().loadMailCount();
      window.dispatchEvent(new CustomEvent('nuru:mail'));
      if (e.announce) {
        toastFor(e, 'mail');
        void useHub.getState().loadNotifications();
        systemNotify(lang() === 'sw' ? e.title_sw ?? '' : e.title_en ?? '', msg(e), e.link);
        void announce(msg(e));
      }
    }),
    onEvent('katibu_progress', (e) => {
      const job = e.data.job as KatibuJobRow | undefined;
      if (job) useHub.getState().upsertJob(job);
    }),
    onEvent('katibu_delivery', (e) => {
      const job = e.data.job as KatibuJobRow | undefined;
      if (job) useHub.getState().upsertJob(job);
      const sent = Number(e.data.sent ?? 0);
      const failed = Number(e.data.failed ?? 0);
      if (job) void announce(tr(lang(), failed ? 'minutes.deliveryMixed' : 'minutes.deliveryOk', { sent, failed }));
    }),
    onEvent('katibu_ready', (e) => void onKatibuReady(e)),
    onEvent('katibu_failed', (e) => {
      const job = e.data.job as KatibuJobRow | undefined;
      if (job) useHub.getState().upsertJob(job);
      toastFor(e, 'katibu_failed');
      void announce(msg(e));
    }),
    onEvent('katibu_sent', (e) => {
      const job = e.data.job as KatibuJobRow | undefined;
      if (job) useHub.getState().upsertJob(job);
      void useHub.getState().loadNotifications();
    }),
    onEvent('day_updated', () => void useHub.getState().loadDay()),
    onEvent('briefing_prompt', () => void startBriefing()),
    onEvent('demo_reset', () => {
      nuru().reminders.forEach((r) => nuru().removeReminder(r.id));
      refreshAll();
      window.dispatchEvent(new CustomEvent('nuru:mail'));
      window.dispatchEvent(new CustomEvent('nuru:tasks'));
    }),
    onReconnect(() => {
      refreshAll();
      void restoreOpenReminders();
    }),
  );
}

/** Cards for reminders that fired recently and are still open (after a reload or reconnect). */
export async function restoreOpenReminders(): Promise<void> {
  try {
    const r = await api<{ open: { id: number; kind: ReminderCard['kind']; message_sw: string; message_en: string; data: ReminderCard['data'] }[] }>('/api/reminders');
    for (const o of r.open) {
      if (!nuru().reminders.some((x) => x.id === o.id)) nuru().addReminder({ ...o, state: 'waiting' });
    }
  } catch {
    /* ignore */
  }
}

export function stopProactive(): void {
  stopEvents();
}

/** Called when a session becomes active (login or reload with a token). */
export function onSignedIn(): void {
  initProactive();
  startEvents();
  void useHub.getState().loadAll();
  void restoreOpenReminders();
}

// ---------------------------------------------------------------------------
// First-use audio unlock ("Gusa ili kuanza")

const UNLOCK_KEY = 'nuru-unlocked-v1';

export function unlockSeen(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function shouldShowUnlock(): boolean {
  let forced = false;
  try {
    forced = new URLSearchParams(window.location.search).get('unlock') === '1';
  } catch {
    /* ignore */
  }
  if (forced) return true;
  if (isMuted()) return false;
  return !unlockSeen();
}

/** The big "Gusa ili kuanza" button: unlock audio, ask for microphone + notifications, greet. */
export async function completeUnlock(): Promise<void> {
  await unlockAudio();
  try {
    localStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* ignore */
  }
  nuru().setUnlockNeeded(false);
  if (!isMuted() && navigator.mediaDevices?.getUserMedia) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((tr2) => tr2.stop());
    } catch {
      /* denied: typing still works */
    }
  }
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  } catch {
    /* ignore */
  }
  const name = useSession.getState().user?.first_name ?? '';
  await announce(tr(lang(), 'unlock.greeting' as I18nKey, { name }), { force: true });
  // Re-speak an open reminder that may have been missed while audio was locked.
  const open = nuru().reminders.find((r) => r.state === 'waiting');
  if (open) await announce(msg(open));
  else if (pageFromPath(window.location.pathname) === 'hub_today' && !briefingSeenToday()) void startBriefing();
}

window.addEventListener('nuru:audio-locked', () => {
  if (!isMuted()) nuru().setUnlockNeeded(true);
});
