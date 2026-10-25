/**
 * The meeting ↔ Hub link: scheduled meetings, the live microphone recording for KatibuAI,
 * and the "meeting ended → shall Katibu prepare the minutes?" flow.
 */
import { create } from 'zustand';
import { api, authFetch, useSession } from './session';
import { useApp } from '../store/appStore';
import { tr, type I18nKey } from '../i18n';
import { useHub, type KatibuJobRow } from '../hub/hubStore';
import { useNuru } from './nuruStore';
import { goTo } from './nav';
import { isMuted } from './tts';
import { audioContext } from './audioLevel';
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
// Recording for KatibuAI
//
// Live mode: a MediaRecorder (Opus in WebM) on its OWN microphone stream for the whole meeting. The meeting's
// mute button, moderator mode and NURU's speech recognition never touch this stream.
// Sample mode (Settings or the demo panel): the sample meeting is PLAYED aloud in the room with a visible player,
// and that same recording is what goes to KatibuAI.

interface RecState {
  active: boolean;
  roomId: string | null;
  startedAt: number;
  unavailable: boolean;
  mode: 'live' | 'sample';
  /** 0..1, for the level meter next to "Inarekodiwa kwa KatibuAI". */
  level: number;
  samplePlaying: boolean;
  samplePos: number;
  sampleDuration: number;
}

export const useRecorder = create<RecState>()(() => ({
  active: false, roomId: null, startedAt: 0, unavailable: false, mode: 'live', level: 0, samplePlaying: false, samplePos: 0, sampleDuration: 0,
}));

let recorder: MediaRecorder | null = null;
let recGen = 0;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let sampleAudio: HTMLAudioElement | null = null;
let stopMeter: (() => void) | null = null;
const lastRecording = new Map<string, Blob>();
const sampleRooms = new Set<string>();
/** Rooms whose minutes were already requested during the meeting (no second offer on Leave). */
const requestedRooms = new Set<string>();

/** Publishes an analyser's level to the recorder state (~10 times a second). */
function meter(source: AudioNode, ctx: AudioContext): () => void {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let raf = 0;
  let last = 0;
  let smooth = 0;
  const tick = (ts: number) => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    smooth = smooth * 0.7 + Math.min(1, Math.sqrt(sum / buf.length) * 4) * 0.3;
    if (ts - last > 100) {
      last = ts;
      useRecorder.setState({ level: smooth });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    try {
      source.disconnect(analyser);
    } catch {
      /* ignore */
    }
    useRecorder.setState({ level: 0 });
  };
}

async function startSample(roomId: string, my: number): Promise<void> {
  sampleRooms.add(roomId);
  lastRecording.delete(roomId);
  if (isMuted()) return; // automated tests: show the player, play nothing
  try {
    const r = await authFetch('/api/katibu/sample');
    if (!r.ok || my !== recGen) return;
    const a = new Audio(URL.createObjectURL(await r.blob()));
    sampleAudio = a;
    a.onloadedmetadata = () => useRecorder.setState({ sampleDuration: a.duration || 0 });
    a.ontimeupdate = () => useRecorder.setState({ samplePos: a.currentTime });
    a.onplay = () => useRecorder.setState({ samplePlaying: true });
    a.onpause = () => useRecorder.setState({ samplePlaying: false });
    a.onended = () => useRecorder.setState({ samplePlaying: false });
    const ctx = audioContext();
    if (ctx) {
      const src = ctx.createMediaElementSource(a);
      src.connect(ctx.destination);
      stopMeter = meter(src, ctx);
    }
    await a.play().catch(() => useRecorder.setState({ samplePlaying: false }));
  } catch {
    /* the player stays visible; the sample still goes to KatibuAI */
  }
}

/** The ▶/⏸ button of the visible sample player. */
export function toggleSamplePlayback(): void {
  const a = sampleAudio;
  if (!a) return;
  if (a.paused) void a.play().catch(() => undefined);
  else a.pause();
}

export async function startMeetingRecording(roomId: string): Promise<void> {
  if (recorder || useRecorder.getState().active) return;
  const my = ++recGen;
  const mode = useSession.getState().user?.meeting_audio_source === 'sample' ? 'sample' : 'live';
  useRecorder.setState({ active: true, roomId, startedAt: Date.now(), unavailable: false, mode, level: 0, samplePlaying: false, samplePos: 0, sampleDuration: 0 });
  if (mode === 'sample') {
    await startSample(roomId, my);
    return;
  }
  sampleRooms.delete(roomId);
  requestedRooms.delete(roomId);
  if (isMuted() || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    useRecorder.setState({ unavailable: true });
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
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
    const ctx = audioContext();
    if (ctx) stopMeter = meter(ctx.createMediaStreamSource(stream), ctx);
  } catch {
    useRecorder.setState({ unavailable: true });
  }
}

export function stopMeetingRecording(): Promise<Blob | null> {
  const roomId = useRecorder.getState().roomId;
  recGen++;
  useRecorder.setState({ active: false, samplePlaying: false });
  stopMeter?.();
  stopMeter = null;
  if (sampleAudio) {
    sampleAudio.pause();
    URL.revokeObjectURL(sampleAudio.src);
    sampleAudio = null;
  }
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

/** The live recording can't be used (missing, too short, silent, unreadable): the user decides about the sample. */
export class LiveUnusable extends Error {
  constructor(public reason: string, public seconds: number) {
    super(`live_unusable: ${reason}`);
  }
}

export async function createKatibuJob(
  roomId: string,
  opts: { blob?: Blob | null; title?: string; meetingId?: number | null; useSample?: boolean; allowSample?: boolean } = {},
): Promise<KatibuJobRow> {
  const fd = new FormData();
  fd.append('room_id', roomId);
  const sm = opts.meetingId ? { id: opts.meetingId, title: opts.title ?? '' } : scheduledMeetingFor(roomId);
  const room = useApp.getState().rooms.find((r) => r.id === roomId);
  // The minutes carry the meeting's name.
  fd.append('title', opts.title || sm?.title || room?.name || 'Kikao');
  if (sm?.id) fd.append('scheduled_meeting_id', String(sm.id));
  const blob = opts.blob === undefined ? lastRecording.get(roomId) ?? null : opts.blob;
  if (opts.useSample || sampleRooms.has(roomId)) fd.append('use_sample', 'true');
  if (opts.allowSample) fd.append('allow_sample', 'true');
  if (blob) fd.append('audio', blob, 'meeting.webm');
  const r = await authFetch('/api/katibu/jobs', { method: 'POST', body: fd });
  const j = (await r.json()) as KatibuJobRow & { error?: string; code?: string; reason?: string; seconds?: number };
  if (r.status === 422 && j.code === 'live_unusable') throw new LiveUnusable(j.reason ?? 'no_recording', j.seconds ?? 0);
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  useHub.getState().upsertJob(j);
  return j;
}

/** After the meeting ended: offer Katibu minutes (voice or tap). */
export async function offerMinutes(roomId: string, blob: Blob | null): Promise<void> {
  if (!useSession.getState().token) return;
  if (requestedRooms.delete(roomId)) return; // Katibu is already preparing this meeting's minutes
  const sm = scheduledMeetingFor(roomId);
  const room = useApp.getState().rooms.find((r) => r.id === roomId);
  const title = sm?.title ?? room?.name ?? 'Kikao';
  const { askYesNo } = await import('./proactive');
  useNuru.getState().setMinutesOffer({ roomId, title, meetingId: sm?.id ?? null });
  const yes = await askYesNo(tr(lang(), 'minutes.offer'));
  useNuru.getState().setMinutesOffer(null);
  if (!yes) {
    logActivity({ system: 'katibu', request: tr(lang(), 'minutes.offer'), outcome: 'Declined', finalMessage: tr(lang(), 'minutes.offerDeclined'), confirmations: [{ summary: tr(lang(), 'minutes.offer'), result: 'declined' }] });
    return;
  }
  await prepareMinutes(roomId, { blob, title, meetingId: sm?.id ?? null, confirmed: true, interactive: true });
}

export async function prepareMinutes(
  roomId: string,
  opts: { blob?: Blob | null; title?: string; meetingId?: number | null; confirmed?: boolean; interactive?: boolean; useSample?: boolean; allowSample?: boolean } = {},
): Promise<KatibuJobRow | LiveUnusable | null> {
  const { announce, askYesNo } = await import('./proactive');
  const started = Date.now();
  // Asked during the meeting (or with the recorder still running): stop it first and use THIS meeting's recording.
  let blob = opts.blob;
  if (useRecorder.getState().active && useRecorder.getState().roomId === roomId) {
    blob = await stopMeetingRecording();
    requestedRooms.add(roomId);
  }
  const audit = (job: KatibuJobRow | null, outcome: 'Completed' | 'Failed' | 'Declined', msg: string, extra: { summary: string; result: 'approved' | 'declined' }[] = []) =>
    logActivity({
      system: 'katibu',
      request: tr(lang(), 'minutes.auditPrepare', { title: job?.title ?? opts.title ?? roomId }),
      outcome,
      finalMessage: msg,
      confirmations: [...(opts.confirmed ? [{ summary: tr(lang(), 'minutes.offer'), result: 'approved' as const }] : []), ...extra],
      steps: job ? [{ time: new Date().toISOString(), tool: 'katibu_prepare_minutes', target: `${job.title} (${job.audio_source}${job.audio_note ? `: ${job.audio_note}` : ''})`, ok: job.status !== 'failed' }] : [],
      startedAt: started,
    });
  try {
    let job: KatibuJobRow;
    try {
      job = await createKatibuJob(roomId, { ...opts, blob });
    } catch (e) {
      if (!(e instanceof LiveUnusable)) throw e;
      // Never fall back to the sample silently: say why and let the user decide.
      if (!opts.interactive) return e;
      const room = useApp.getState().rooms.find((r) => r.id === roomId);
      const q = tr(lang(), 'minutes.liveUnusable', { reason: tr(lang(), `minutes.note.${e.reason}` as I18nKey) });
      useNuru.getState().setMinutesOffer({ roomId, title: opts.title ?? room?.name ?? '', meetingId: opts.meetingId ?? null, question: q, yesLabel: tr(lang(), 'minutes.useSample') });
      const yes = await askYesNo(q);
      useNuru.getState().setMinutesOffer(null);
      if (!yes) {
        audit(null, 'Declined', tr(lang(), 'minutes.liveUnusableDeclined'), [{ summary: q, result: 'declined' }]);
        void announce(tr(lang(), 'minutes.liveUnusableDeclined'), { force: true });
        return null;
      }
      job = await createKatibuJob(roomId, { ...opts, blob, allowSample: true });
      audit(job, job.status === 'failed' ? 'Failed' : 'Completed', tr(lang(), 'minutes.preparing'), [{ summary: q, result: 'approved' }]);
      useNuru.getState().pushToast({ kind: 'katibu', title: tr(lang(), 'minutes.toastTitle'), body: tr(lang(), 'minutes.preparing'), link: `/hub/minutes/${job.id}` });
      void announce(tr(lang(), 'minutes.preparing'), { force: true });
      return job;
    }
    audit(job, job.status === 'failed' ? 'Failed' : 'Completed', tr(lang(), 'minutes.preparing'));
    useNuru.getState().pushToast({ kind: 'katibu', title: tr(lang(), 'minutes.toastTitle'), body: tr(lang(), 'minutes.preparing'), link: `/hub/minutes/${job.id}` });
    void announce(tr(lang(), 'minutes.preparing'), { force: true });
    return job;
  } catch (e) {
    void announce(tr(lang(), 'minutes.prepareFailed'), { force: true });
    audit(null, 'Failed', String((e as Error).message));
    return null;
  }
}
