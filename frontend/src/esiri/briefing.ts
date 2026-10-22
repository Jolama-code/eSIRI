/**
 * The morning briefing: a guided flow (not the general agent loop) so it is reliable on stage.
 * Speak greeting → listen long (or type) → POST /api/briefing/parse → review timetable → "Nihifadhi mpango huu?"
 * → on yes POST /api/briefing/save (creates the items and their reminders).
 */
import { api, HttpError, useSession } from './session';
import { emptyBriefing, useNuru, type BriefingItem } from './nuruStore';
import { useApp } from '../store/appStore';
import { tr } from '../i18n';
import { isMuted, speak, stopSpeaking } from './tts';
import { listenLong, listenOnce, stopListening, sttSupported } from './stt';
import { startMicLevel, stopMicLevel } from './audioLevel';
import { parseYesNo } from './util';
import { logActivity } from './controller';
import { useEsiri } from './esiriStore';
import { useHub } from '../hub/hubStore';
import { spokenClock, todayLocal } from '../hub/ui';

const lang = () => useApp.getState().language;
const b = () => useNuru.getState().briefing;
const setB = (p: Parameters<ReturnType<typeof useNuru.getState>['setBriefing']>[0]) => useNuru.getState().setBriefing(p);

let run = 0;
let startedAt = 0;

function voiceOk(): boolean {
  return sttSupported() && !isMuted();
}

async function say(text: string): Promise<void> {
  const es = useEsiri.getState();
  es.setStatus('speaking');
  await speak(text, lang());
  if (useEsiri.getState().status === 'speaking') es.setStatus('idle');
}

export function briefingSeenKey(): string {
  const uid = useSession.getState().user?.id ?? 0;
  return `nuru-briefing-${uid}-${todayLocal()}`;
}

export function markBriefingSeen(): void {
  try {
    localStorage.setItem(briefingSeenKey(), '1');
  } catch {
    /* ignore */
  }
}

export function briefingSeenToday(): boolean {
  try {
    return localStorage.getItem(briefingSeenKey()) === '1';
  } catch {
    return false;
  }
}

export async function startBriefing(): Promise<void> {
  const my = ++run;
  stopListening();
  markBriefingSeen();
  startedAt = Date.now();
  const name = useSession.getState().user?.first_name ?? '';
  setB({ ...emptyBriefing, stage: 'greeting' });
  await say(tr(lang(), 'briefing.greeting', { name }));
  if (my !== run || b().stage !== 'greeting') return;
  await listenForPlans(my);
}

async function listenForPlans(my: number): Promise<void> {
  setB({ stage: 'listening', interim: '' });
  if (!voiceOk()) return; // typed input in the sheet
  useEsiri.getState().setMicOpen(true);
  void startMicLevel();
  const res = await listenLong(lang(), (txt) => setB({ interim: txt }), { silenceMs: 2500 });
  stopMicLevel();
  useEsiri.getState().setMicOpen(false);
  if (my !== run || b().stage !== 'listening') return;
  if (res.text) void submitTranscript(res.text);
  else setB({ interim: '' }); // nothing heard: wait for typing or the mic button
}

/** Mic button inside the sheet. */
export function listenAgain(): void {
  if (b().stage === 'listening' || b().stage === 'review' || b().stage === 'error') void listenForPlans(++run);
}

export async function submitTranscript(text: string): Promise<void> {
  const transcript = text.trim();
  if (!transcript) return;
  const my = ++run;
  stopListening();
  setB({ stage: 'parsing', transcript, interim: '' });
  try {
    const res = await api<{ items: BriefingItem[]; questions: string[]; existing: { key: string; time: string; title: string; kind: string; start_at: string }[] }>(
      '/api/briefing/parse',
      { body: { transcript, language: lang() } },
    );
    if (my !== run) return;
    setB({ stage: 'review', items: res.items, questions: res.questions, existing: res.existing });
    await confirmPlan(my);
  } catch (e) {
    if (my !== run) return;
    const msg = e instanceof HttpError ? (lang() === 'sw' ? e.messageSw : e.message) : String(e);
    setB({ stage: 'error', error: msg });
    void say(tr(lang(), 'briefing.parseFailed'));
  }
}

function summary(): string {
  const items = [...b().items].sort((x, y) => x.start.localeCompare(y.start));
  const l = lang();
  if (!items.length) return tr(l, 'briefing.nothing');
  const first = items[0];
  let s = tr(l, 'briefing.summary', { n: items.length, title: first.title, time: spokenClock(first.start, l) });
  if (b().questions.length) s += ' ' + b().questions[0];
  return s;
}

async function confirmPlan(my: number): Promise<void> {
  if (!b().items.length) {
    await say(tr(lang(), 'briefing.nothing'));
    return;
  }
  setB({ stage: 'confirm' });
  await say(`${summary()} ${tr(lang(), 'briefing.ask')}`);
  if (my !== run || b().stage !== 'confirm' || !voiceOk()) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    useEsiri.getState().setMicOpen(true);
    void startMicLevel();
    const res = await listenOnce(lang(), (txt) => setB({ interim: txt }));
    stopMicLevel();
    useEsiri.getState().setMicOpen(false);
    setB({ interim: '' });
    if (my !== run || b().stage !== 'confirm') return;
    if (res.text) {
      if (answerBriefing(res.text)) return;
    } else if (res.error && res.error !== 'no-speech') return;
    if (attempt === 0) await say(tr(lang(), 'esiri.sayYesNo'));
  }
}

/** A spoken or typed answer while the plan waits for confirmation. Returns true if understood. */
export function answerBriefing(text: string): boolean {
  if (b().stage !== 'confirm' && b().stage !== 'review') return false;
  const yn = parseYesNo(text);
  if (yn === 'yes') {
    void saveBriefing();
    return true;
  }
  if (yn === 'no') {
    declineBriefing();
    return true;
  }
  return false;
}

export async function saveBriefing(): Promise<void> {
  const my = ++run;
  stopListening();
  stopSpeaking();
  const items = b().items;
  setB({ stage: 'saving' });
  try {
    await api('/api/briefing/save', { body: { items } });
    if (my !== run) return;
    setB({ stage: 'done' });
    void useHub.getState().loadDay();
    logActivity({
      system: 'hub',
      request: `${tr(lang(), 'briefing.auditRequest')}: ${b().transcript}`,
      outcome: 'Completed',
      finalMessage: tr(lang(), 'briefing.saved'),
      inputMode: voiceOk() ? 'voice' : 'text',
      confirmations: [{ summary: tr(lang(), 'briefing.ask'), result: 'approved' }],
      steps: items.map((i) => ({ time: new Date().toISOString(), tool: 'schedule_item', target: `${i.start} ${i.title}`, ok: true })),
      startedAt,
    });
    await say(tr(lang(), 'briefing.saved'));
    window.setTimeout(() => {
      if (b().stage === 'done') closeBriefing();
    }, 1800);
  } catch (e) {
    if (my !== run) return;
    setB({ stage: 'error', error: e instanceof HttpError ? e.message : String(e) });
  }
}

export function declineBriefing(): void {
  ++run;
  stopListening();
  logActivity({
    system: 'hub',
    request: `${tr(lang(), 'briefing.auditRequest')}: ${b().transcript}`,
    outcome: 'Declined',
    finalMessage: tr(lang(), 'briefing.notSaved'),
    confirmations: [{ summary: tr(lang(), 'briefing.ask'), result: 'declined' }],
    startedAt,
  });
  void say(tr(lang(), 'briefing.notSaved'));
  closeBriefing();
}

export function closeBriefing(): void {
  ++run;
  stopListening();
  stopMicLevel();
  useEsiri.getState().setMicOpen(false);
  setB({ ...emptyBriefing });
}

export function editBriefingItem(index: number, patch: Partial<BriefingItem>): void {
  setB({ items: b().items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
}

export function removeBriefingItem(index: number): void {
  setB({ items: b().items.filter((_, i) => i !== index) });
}

// ---------------------------------------------------------------------------
// Merge + conflicts for the review screen

export interface PlanRow {
  key: string;
  title: string;
  start: string;
  end: string;
  kind: string;
  isNew: boolean;
  index: number;
  conflict: boolean;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function mergedPlan(items: BriefingItem[], existing: { key: string; time: string; title: string; kind: string }[]): PlanRow[] {
  const rows: PlanRow[] = [
    ...existing.map((e) => ({ key: e.key, title: e.title, start: e.time, end: '', kind: e.kind, isNew: false, index: -1, conflict: false })),
    ...items.map((it, i) => ({ key: `new-${i}`, title: it.title, start: it.start, end: it.end ?? '', kind: it.kind, isNew: true, index: i, conflict: false })),
  ];
  const span = (r: PlanRow) => {
    const s = toMin(r.start);
    const e = r.end ? toMin(r.end) : s + (r.isNew ? (items[r.index]?.duration_min ?? 30) : 30);
    return [s, Math.max(e, s + 1)];
  };
  for (const a of rows) {
    for (const c of rows) {
      if (a === c) continue;
      const [as, ae] = span(a);
      const [cs, ce] = span(c);
      if (as < ce && cs < ae) a.conflict = true;
    }
  }
  return rows.sort((x, y) => x.start.localeCompare(y.start));
}
