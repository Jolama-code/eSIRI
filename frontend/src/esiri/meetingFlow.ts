/**
 * The meeting ↔ Hub link: scheduled meetings, the live microphone recording for KatibuAI,
 * and the "meeting ended → shall Katibu prepare the minutes?" flow.
 */
import { create } from 'zustand';
import { api, authFetch, useSession } from './session';
import { useApp } from '../store/appStore';
import { tr } from '../i18n';
import { useHub, type KatibuJobRow } from '../hub/hubStore';
import { useNuru } from './nuruStore';
import { goTo } from './nav';
import { isMuted } from './tts';
import { logActivity } from './controller';

const lang = () => useApp.getState().language;

// ---------------------------------------------------------------------------
// Scheduled meeting links (room id → scheduled meeting id)

const LINK_KEY = 'nuru-meeting-links';

function links(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(LINK_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function rememberScheduledMeeting(roomId: string, meetingId: number | null): void {
  if (!meetingId) return;
  try {
    sessionStorage.setItem(LINK_KEY, JSON.stringify({ ...links(), [roomId]: meetingId }));
  } catch {
    /* ignore */
  }
}

/** The scheduled meeting for a room: the remembered link, else today's closest one I'm part of. */
export function scheduledMeetingFor(roomId: string): { id: number; title: string } | null {
  const linked = links()[roomId];
  const meetings = useHub.getState().meetings.filter((m) => m.room_id === roomId);
  const byId = meetings.find((m) => m.id === linked);
  if (byId) return { id: byId.id, title: byId.title };
  const today = meetings
    .filter((m) => m.status !== 'ended' && Math.abs(new Date(m.start_at).getTime() - Date.now()) < 12 * 3600 * 1000)
    .sort((a, b) => Math.abs(new Date(a.start_at).getTime() - Date.now()) - Math.abs(new Date(b.start_at).getTime() - Date.now()));
  return today[0] ? { id: today[0].id, title: today[0].title } : null;
}

/** Hub "Start" / "Join" on a timeline meeting (human click). */
export function startScheduledMeeting(roomId: string, meetingId: number): void {
  if (!roomId) return;
  rememberScheduledMeeting(roomId, meetingId);
  goTo(`/rooms/${roomId}/meeting`);
}

/** Called when the meeting page opens: mark the scheduled meeting live (organizer). */
export async function onMeetingOpened(roomId: string): Promise<void> {
  if (!useSession.getState().token) return;
  if (!useHub.getState().meetingsLoaded) await useHub.getState().loadMeetings();
  const sm = scheduledMeetingFor(roomId);
  if (!sm) return;
  rememberScheduledMeeting(roomId, sm.id);
  const row = useHub.getState().meetings.find((m) => m.id === sm.id);
  if (row?.is_organizer && row.status === 'scheduled') {
    await api(`/api/meetings/${sm.id}`, { method: 'PATCH', body: { status: 'live' } }).catch(() => undefined);
    void useHub.getState().loadMeetings();
  }
}

// ---------------------------------------------------------------------------
// Live recording for KatibuAI (MediaRecorder, Opus in WebM)

interface RecState {
  active: boolean;
  roomId: string | null;
  startedAt: number;
  unavailable: boolean;
}

export const useRecorder = create<RecState>()(() => ({ active: false, roomId: null, startedAt: 0, unavailable: false }));

let recorder: MediaRecorder | null = null;
let recGen = 0;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
const lastRecording = new Map<string, Blob>();

export async function startMeetingRecording(roomId: string): Promise<void> {
  if (recorder || useRecorder.getState().active) return;
  const my = ++recGen;
  useRecorder.setState({ active: true, roomId, startedAt: Date.now(), unavailable: false });
  if (isMuted() || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    useRecorder.setState({ unavailable: true });
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (my !== recGen || !useRecorder.getState().active) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      return;
    }
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start(1000);
  } catch {
    useRecorder.setState({ unavailable: true });
  }
}

export function stopMeetingRecording(): Promise<Blob | null> {
  const roomId = useRecorder.getState().roomId;
  recGen++;
  useRecorder.setState({ active: false });
  const r = recorder;
  recorder = null;
  const finish = (): Blob | null => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (!chunks.length) return null;
    const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
    chunks = [];
    if (roomId) lastRecording.set(roomId, blob);
    return blob;
  };
  if (!r || r.state === 'inactive') return Promise.resolve(finish());
  return new Promise((resolve) => {
    r.onstop = () => resolve(finish());
    try {
      r.stop();
    } catch {
      resolve(finish());
    }
  });
}

// ---------------------------------------------------------------------------
// Katibu jobs

export async function createKatibuJob(roomId: string, opts: { blob?: Blob | null; title?: string; meetingId?: number | null; useSample?: boolean } = {}): Promise<KatibuJobRow> {
  const fd = new FormData();
  fd.append('room_id', roomId);
  const sm = opts.meetingId ? { id: opts.meetingId, title: opts.title ?? '' } : scheduledMeetingFor(roomId);
  const room = useApp.getState().rooms.find((r) => r.id === roomId);
  fd.append('title', opts.title || sm?.title || room?.name || 'Kikao');
  if (sm?.id) fd.append('scheduled_meeting_id', String(sm.id));
  const blob = opts.blob === undefined ? lastRecording.get(roomId) ?? null : opts.blob;
  if (opts.useSample) fd.append('use_sample', 'true');
  if (blob) fd.append('audio', blob, 'meeting.webm');
  const r = await authFetch('/api/katibu/jobs', { method: 'POST', body: fd });
  const j = (await r.json()) as KatibuJobRow & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  useHub.getState().upsertJob(j);
  return j;
}

/** After the meeting ended: offer Katibu minutes (voice or tap). */
export async function offerMinutes(roomId: string, blob: Blob | null): Promise<void> {
  if (!useSession.getState().token) return;
  const sm = scheduledMeetingFor(roomId);
  const room = useApp.getState().rooms.find((r) => r.id === roomId);
  const title = sm?.title ?? room?.name ?? 'Kikao';
  useNuru.getState().setMinutesOffer({ roomId, title, meetingId: sm?.id ?? null });
  const { askYesNo } = await import('./proactive');
  const yes = await askYesNo(tr(lang(), 'minutes.offer'));
  useNuru.getState().setMinutesOffer(null);
  if (!yes) {
    logActivity({ system: 'katibu', request: tr(lang(), 'minutes.offer'), outcome: 'Declined', finalMessage: tr(lang(), 'minutes.offerDeclined'), confirmations: [{ summary: tr(lang(), 'minutes.offer'), result: 'declined' }] });
    return;
  }
  await prepareMinutes(roomId, { blob, title, meetingId: sm?.id ?? null, confirmed: true });
}

export async function prepareMinutes(
  roomId: string,
  opts: { blob?: Blob | null; title?: string; meetingId?: number | null; confirmed?: boolean } = {},
): Promise<KatibuJobRow | null> {
  const { announce } = await import('./proactive');
  const started = Date.now();
  try {
    const job = await createKatibuJob(roomId, opts);
    logActivity({
      system: 'katibu',
      request: tr(lang(), 'minutes.auditPrepare', { title: job.title }),
      outcome: job.status === 'failed' ? 'Failed' : 'Completed',
      finalMessage: tr(lang(), 'minutes.preparing'),
      confirmations: opts.confirmed ? [{ summary: tr(lang(), 'minutes.offer'), result: 'approved' }] : [],
      steps: [{ time: new Date().toISOString(), tool: 'katibu_prepare_minutes', target: `${job.title} (${job.audio_source})`, ok: job.status !== 'failed' }],
      startedAt: started,
    });
    useNuru.getState().pushToast({ kind: 'katibu', title: tr(lang(), 'minutes.toastTitle'), body: tr(lang(), 'minutes.preparing'), link: `/hub/minutes/${job.id}` });
    void announce(tr(lang(), 'minutes.preparing'), { force: true });
    return job;
  } catch (e) {
    void announce(tr(lang(), 'minutes.prepareFailed'), { force: true });
    logActivity({ system: 'katibu', request: tr(lang(), 'minutes.auditPrepare', { title: opts.title ?? roomId }), outcome: 'Failed', finalMessage: String((e as Error).message), startedAt: started });
    return null;
  }
}
