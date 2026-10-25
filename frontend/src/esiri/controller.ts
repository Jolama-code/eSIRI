/**
 * eSiri agent controller: runs the snapshot → LLM → tool calls → visible actions loop,
 * the confirmation gate, cancellation, listening and the audit trail.
 */
import { useApp, randomId, type AuditConfirmation, type AuditRecord, type AuditStep, type Language, type Outcome } from '../store/appStore';
import { currentPerson } from './session';
import { t, tr, type I18nKey } from '../i18n';
import { useEsiri, type Status, type StepIcon } from './esiriStore';
import { agentStep, ApiError, postAudit, type ToolCall } from './api';
import { buildSnapshot, describeElement } from './snapshot';
import { click, elementPresent, navigate, selectOption, typeText, type ActionResult, type DriverContext } from './driver';
import { api, HttpError } from './session';
import { enableModerator, disableModerator } from './moderator';
import { LiveUnusable, prepareMinutes } from './meetingFlow';
import { sendMinutes } from './katibuActions';
import { useHub } from '../hub/hubStore';
import { goTo, pageFromPath } from './nav';
import { hideCursor } from './cursor';
import { systemFromPath } from './nav';
import { isMuted, speak, stopSpeaking } from './tts';
import { listenOnce, stopListening, sttSupported, type ListenResult } from './stt';
import { startMicLevel, stopMicLevel } from './audioLevel';
import { isAbort, isStopUtterance, parseYesNo } from './util';

const MAX_TOOL_EXECUTIONS = 30;
const MAX_SAME_FAILURES = 3;

interface Task {
  id: string;
  request: string;
  inputMode: 'voice' | 'text';
  language: Language;
  startedAt: number;
  steps: AuditStep[];
  confirmations: AuditConfirmation[];
  credits: number;
  toolExecs: number;
  failKey: string;
  failCount: number;
  declined: boolean;
  abort: AbortController;
  done: boolean;
}

let current: Task | null = null;
let awaitingAnswer = false;
type ConfirmAnswer = boolean | { change: string };
let pendingConfirm: { resolve: (v: ConfirmAnswer) => void; msgId: string } | null = null;

const es = () => useEsiri.getState();
const app = () => useApp.getState();
const lang = () => app().language;
const setStatus = (s: Status) => es().setStatus(s);

export function isBusy(): boolean {
  const s = es().status;
  return s === 'thinking' || s === 'acting' || s === 'speaking' || s === 'awaiting_confirmation';
}

export function hasPendingTask(): boolean {
  return current !== null;
}

// ---------------------------------------------------------------------------
// Speech helpers

async function say(text: string): Promise<void> {
  const prev = es().status;
  setStatus('speaking');
  await speak(text, lang());
  if (es().status === 'speaking') setStatus(prev === 'speaking' ? 'idle' : prev);
}

export function voiceAvailable(): boolean {
  return sttSupported() && !isMuted();
}

/** Listen once with orb/mic visuals. Keeps the status unless `asStatus` is given. */
async function listen(asStatus?: Status): Promise<ListenResult> {
  if (asStatus) setStatus(asStatus);
  es().setMicOpen(true);
  void startMicLevel();
  const res = await listenOnce(lang(), (txt) => es().setInterim(txt));
  stopMicLevel();
  es().setMicOpen(false);
  es().setInterim('');
  return res;
}

function sttErrorNotice(err: ListenResult['error']): void {
  const key: I18nKey | null =
    err === 'not-allowed'
      ? 'esiri.sttNotAllowed'
      : err === 'network'
        ? 'esiri.sttNetwork'
        : err === 'unsupported'
          ? 'esiri.sttUnsupported'
          : err === 'other'
            ? 'esiri.sttError'
            : null;
  if (key) {
    es().addMsg({ kind: 'notice', text: t(key), tone: 'error' });
    es().flashError();
  }
}

// ---------------------------------------------------------------------------
// Activation / listening

/** Orb click or Alt+S. */
export function activate(): void {
  const status = es().status;
  if (isBusy()) {
    cancel();
    return;
  }
  if (status === 'listening' || es().micOpen) {
    stopListening();
    return;
  }
  es().setPanelOpen(true);
  void listenForCommand();
}

export async function listenForCommand(): Promise<void> {
  if (isMuted()) {
    // Test mode (?mute=1): no microphone, typed input only.
    focusInput();
    return;
  }
  if (!sttSupported()) {
    if (!es().sttNoticeShown) {
      es().addMsg({ kind: 'notice', text: t('esiri.sttUnsupported'), tone: 'info' });
      useEsiri.setState({ sttNoticeShown: true });
    }
    focusInput();
    return;
  }
  const back: Status = awaitingAnswer ? 'awaiting_answer' : 'idle';
  const res = await listen('listening');
  if (es().status !== 'listening') return; // cancelled meanwhile
  setStatus(back);
  if (res.text) {
    if (isStopUtterance(res.text)) {
      cancel();
      return;
    }
    void submit(res.text, 'voice');
    return;
  }
  if (res.error && res.error !== 'no-speech' && res.error !== 'aborted') {
    sttErrorNotice(res.error);
    focusInput();
  }
}

function focusInput(): void {
  window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid="esiri-input"]')?.focus(), 50);
}

// ---------------------------------------------------------------------------
// Messages from the user

export interface SubmitOptions {
  /** Extra context for the model (e.g. the reminder the user is answering). */
  context?: string;
  /**
   * The user already said yes to a NURU question that is itself the confirmation (a reminder's
   * "Shall I start it for you?"). Grants credits scoped to this new task only, and is audited.
   */
  preapproved?: { summary: string; covers: number };
}

export async function submit(rawText: string, mode: 'voice' | 'text', opts: SubmitOptions = {}): Promise<void> {
  const text = rawText.trim();
  if (!text) return;

  // Answer to an open confirmation card (typed or spoken).
  if (pendingConfirm) {
    es().addMsg({ kind: 'user', text, mode });
    const yn = parseYesNo(text);
    if (yn) answerConfirmation(yn === 'yes');
    else if (isChangeRequest(text)) answerChange(text);
    else void say(t('esiri.sayYesNo'));
    return;
  }

  if (isBusy()) return;

  if (isStopUtterance(text)) {
    es().addMsg({ kind: 'user', text, mode });
    cancel();
    return;
  }

  es().addMsg({ kind: 'user', text, mode });

  if (current && awaitingAnswer && !opts.preapproved) {
    awaitingAnswer = false;
    current.request = `${current.request} → ${text}`;
  } else {
    if (current) finalizeTask(current, 'Cancelled', '');
    awaitingAnswer = false;
    current = newTask(text, mode);
    if (opts.preapproved) {
      current.credits += Math.max(1, Math.min(5, opts.preapproved.covers));
      current.confirmations.push({ summary: opts.preapproved.summary, result: 'approved' });
    }
  }
  const message = opts.context ? `${text}\n${opts.context}` : text;
  await runLoop(current, { user_message: message, input_mode: mode });
}

function newTask(request: string, inputMode: 'voice' | 'text'): Task {
  return {
    id: `task-${Date.now()}-${randomId(4)}`,
    request,
    inputMode,
    language: lang(),
    startedAt: Date.now(),
    steps: [],
    confirmations: [],
    credits: 0,
    toolExecs: 0,
    failKey: '',
    failCount: 0,
    declined: false,
    abort: new AbortController(),
    done: false,
  };
}

// ---------------------------------------------------------------------------
// The loop

interface ExecOutcome {
  result: Record<string, unknown>;
  failed?: boolean;
  stopBatch?: boolean;
  end?: 'finish' | 'ask_user' | 'abort';
}

async function runLoop(task: Task, first: Record<string, unknown>): Promise<void> {
  let body = first;
  try {
    for (;;) {
      if (task.done) return;
      setStatus('thinking');
      const resp = await agentStep(
        { ...body, session_id: app().sessionId, language: lang(), snapshot: buildSnapshot() },
        task.abort.signal,
      );
      if (task.done) return;

      if (!resp.tool_calls.length) {
        await finishTask(task, resp.text.trim() || t('esiri.errorGeneric'));
        return;
      }

      const results: { tool_call_id: string; result: unknown }[] = [];
      let stopBatch = false;
      let end: ExecOutcome['end'] | undefined;
      const batchPath = window.location.pathname;
      for (const call of resp.tool_calls) {
        if (stopBatch || end) {
          results.push({ tool_call_id: call.id, result: { skipped: true } });
          continue;
        }
        // After a page change inside a batch, silently skip predictions that are not on the new page.
        const target = call.arguments.element_id;
        if (
          window.location.pathname !== batchPath &&
          (call.name === 'click' || call.name === 'type_text') &&
          typeof target === 'string' &&
          !(await elementPresent(target, task.abort.signal))
        ) {
          results.push({
            tool_call_id: call.id,
            result: { skipped: true, note: 'The page changed; this element is not on the new page. Re-plan from the new snapshot.' },
          });
          stopBatch = true;
          continue;
        }
        if (task.toolExecs >= MAX_TOOL_EXECUTIONS) {
          await failTask(task, t('esiri.tooManySteps'));
          return;
        }
        task.toolExecs++;
        const out = await execute(task, call, results.length === 0 ? 150 : 1500);
        if (task.done && out.end !== 'finish') return;
        results.push({ tool_call_id: call.id, result: out.result });
        if (out.failed) {
          const key = `${call.name}:${JSON.stringify(call.arguments.element_id ?? call.arguments.page ?? '')}`;
          if (key === task.failKey) task.failCount++;
          else {
            task.failKey = key;
            task.failCount = 1;
          }
          if (task.failCount >= MAX_SAME_FAILURES) {
            await failTask(task, t('esiri.repeatedFailure', { error: String(out.result.error ?? '') }));
            return;
          }
          stopBatch = true;
        } else if (call.name !== 'ask_confirmation') {
          task.failKey = '';
          task.failCount = 0;
        }
        if (out.stopBatch) stopBatch = true;
        if (out.end) end = out.end;
      }
      if (end === 'finish' || end === 'abort') return;
      if (end === 'ask_user') {
        awaitingAnswer = true;
        setStatus('awaiting_answer');
        if (voiceAvailable()) {
          const res = await listen();
          if (current !== task || !awaitingAnswer) return;
          if (res.text) {
            if (isStopUtterance(res.text)) cancel();
            else void submit(res.text, 'voice');
          }
        }
        return;
      }
      body = { tool_results: results };
    }
  } catch (e) {
    if (task.done || isAbort(e)) return;
    const err = e instanceof ApiError ? e : new ApiError('other', (e as Error)?.message ?? String(e));
    const key: I18nKey =
      err.code === 'network'
        ? 'esiri.errorNetwork'
        : err.code === 'model_not_found'
          ? 'esiri.errorModel'
          : err.code === 'no_key'
            ? 'esiri.errorNoKey'
            : 'esiri.errorGeneric';
    es().addMsg({ kind: 'notice', text: err.message, tone: 'error' });
    es().flashError();
    await failTask(task, t(key));
  }
}

function driverCtx(task: Task): DriverContext {
  return {
    signal: task.abort.signal,
    hasCredit: () => task.credits > 0,
    useCredit: () => {
      task.credits = Math.max(0, task.credits - 1);
    },
  };
}

function stepLine(text: string, icon: StepIcon): string {
  return es().addMsg({ kind: 'step', text, status: 'pending', icon });
}

function record(task: Task, tool: string, target: string, res: ActionResult, text?: string): void {
  task.steps.push({
    time: new Date().toISOString(),
    tool,
    target,
    ...(text !== undefined ? { text } : {}),
    ok: res.ok,
    ...(res.error ? { error: res.error } : {}),
  });
}

function pageLabel(page: string): string {
  const key = `page.${page}` as I18nKey;
  return t(key);
}

async function execute(task: Task, call: ToolCall, appearWaitMs: number): Promise<ExecOutcome> {
  const a = call.arguments as Record<string, unknown>;
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  const ctx = { ...driverCtx(task), appearWaitMs };

  switch (call.name) {
    case 'click': {
      setStatus('acting');
      const id = str('element_id');
      const el = document.querySelector<HTMLElement>(`[data-esiri-id="${CSS.escape(id)}"]`);
      const info = el ? describeElement(el) : null;
      const label = info?.label || id;
      let text: string;
      let icon: StepIcon = 'click';
      if (info?.role === 'tab') {
        text = t('esiri.step.tab', { label });
        icon = 'tab';
      } else if (info?.role === 'switch') {
        text = t('esiri.step.toggle', { label, state: t(info.state === 'on' ? 'esiri.off' : 'esiri.on') });
        icon = 'toggle';
      } else text = t('esiri.step.click', { label });
      const msgId = stepLine(text, icon);
      const res = await click(id, ctx);
      if (res.code === 'confirmation_required') es().patchMsg(msgId, { text: t('esiri.step.blocked', { label }), icon: 'blocked' });
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'click', label, res);
      return { result: res, failed: !res.ok };
    }
    case 'type_text': {
      setStatus('acting');
      const id = str('element_id');
      const value = str('text');
      const el = document.querySelector<HTMLElement>(`[data-esiri-id="${CSS.escape(id)}"]`);
      const label = el ? describeElement(el).label || id : id;
      const msgId = stepLine(t('esiri.step.type', { text: value }), 'type');
      let res = await typeText(id, value, ctx);
      if (res.ok && id === 'create-room.name-input') {
        // Deterministic duplicate check (exact name, ignoring case/punctuation) so the model never guesses.
        const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const dup = app().rooms.find((r) => norm(r.name) === norm(value));
        res = dup
          ? { ...res, duplicate_of: { id: dup.id, name: dup.name }, note: 'A room with exactly this name already exists. Ask the user (ask_user) whether to open it or create another one.' }
          : { ...res, duplicate_of: null, note: 'No room with this exact name exists. Continue creating it.' };
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'type_text', label, res, value);
      return { result: res, failed: !res.ok };
    }
    case 'navigate': {
      setStatus('acting');
      const page = str('page');
      const msgId = stepLine(t('esiri.step.navigate', { page: pageLabel(page) }), 'navigate');
      const res = await navigate(page, str('room_id') || undefined, ctx);
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'navigate', page + (str('room_id') ? ` (${str('room_id')})` : ''), res);
      return { result: res, failed: !res.ok };
    }
    case 'set_language': {
      const l: Language = str('language') === 'sw' ? 'sw' : 'en';
      app().setLanguage(l);
      const msgId = stepLine(t('esiri.step.language', { lang: t(l === 'sw' ? 'esiri.langName.sw' : 'esiri.langName.en') }), 'language');
      es().patchMsg(msgId, { status: 'ok' });
      const res = { ok: true, language: l };
      record(task, 'set_language', l, res);
      return { result: res };
    }
    case 'ask_confirmation': {
      hideCursor();
      if (task.declined) {
        // The user already said no in this task: never ask again, end here.
        await finishTask(task, t('esiri.declinedAck'));
        return { result: { ok: true, confirmed: false }, end: 'finish' };
      }
      const summary = str('summary') || '…';
      const covers = Math.max(1, Math.min(10, Math.round(Number(a.covers ?? 1)) || 1));
      const answer = await askConfirmation(task, summary);
      if (task.done) return { result: { ok: false, cancelled: true }, end: 'abort' };
      if (typeof answer === 'object') {
        // Not a yes or no: the user asked for a change (e.g. "make it more formal"). Not a decline.
        task.confirmations.push({ summary, result: 'changed' });
        setStatus('thinking');
        return {
          result: {
            ok: true,
            confirmed: false,
            change_request: answer.change,
            note: 'The user did not approve yet; they asked for this change. Apply it (for an e-mail, retype the whole body with type_text), then call ask_confirmation again. Do not perform the sensitive action now.',
          },
          stopBatch: true,
        };
      }
      const confirmed = answer;
      task.confirmations.push({ summary, result: confirmed ? 'approved' : 'declined' });
      if (confirmed) task.credits += covers;
      else task.declined = true;
      setStatus('thinking');
      const note = confirmed
        ? `Approved for ${covers} sensitive click(s). Continue with the approved action now.`
        : 'The user said NO. Do not perform this action and do not ask again. Call finish now with a short acknowledgement in the current language.';
      return { result: { ok: true, confirmed, note }, stopBatch: !confirmed };
    }
    case 'ask_user': {
      hideCursor();
      const q = str('question') || '…';
      es().addMsg({ kind: 'assistant', text: q });
      await say(q);
      record(task, 'ask_user', q, { ok: true });
      return { result: { ok: true, note: "The user's answer will arrive as the next user message." }, end: 'ask_user' };
    }
    case 'finish': {
      await finishTask(task, str('message') || '✓');
      return { result: { ok: true }, end: 'finish' };
    }
    case 'select_option': {
      setStatus('acting');
      const id = str('element_id');
      const value = str('value');
      const el = document.querySelector<HTMLElement>(`[data-esiri-id="${CSS.escape(id)}"]`);
      const label = el ? describeElement(el).label || id : id;
      const msgId = stepLine(t('esiri.step.select', { label, value }), 'select');
      let res = await selectOption(id, value, ctx);
      const taskSel = /^(?:hub|weris)\.task\.(\d+)\.status$/.exec(id);
      if (!res.ok && res.code === 'not_found' && taskSel && ['assigned', 'in_progress', 'done'].includes(value)) {
        // The task list is not on this page: set the status directly (same effect, the assigner is told).
        try {
          await api(`/api/tasks/${taskSel[1]}`, { method: 'PATCH', body: { status: value }, signal: task.abort.signal });
          void useHub.getState().loadTasks();
          window.dispatchEvent(new CustomEvent('nuru:tasks'));
          res = { ok: true, status: value, note: 'The task list was not on screen, so the status was set directly.' };
        } catch (e) {
          if (isAbort(e)) throw e;
        }
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'select_option', label, res, value);
      return { result: res, failed: !res.ok };
    }
    case 'moderator_mode': {
      setStatus('acting');
      const enabled = a.enabled !== false;
      const mute = a.mute_user === true;
      const msgId = stepLine(t(enabled ? 'esiri.step.moderatorOn' : 'esiri.step.moderatorOff'), 'moderator');
      let res: ActionResult;
      if (enabled) {
        // Enabling it acts in the meeting on the user's behalf: needs an approved confirmation (enforced here).
        if (task.credits <= 0) {
          res = { ok: false, code: 'confirmation_required', error: 'confirmation_required: moderator mode acts on the user\'s behalf. Call ask_confirmation first.' };
        } else {
          res = enableModerator(mute);
          if (res.ok) task.credits = Math.max(0, task.credits - 1);
        }
      } else res = disableModerator();
      if (res.code === 'confirmation_required') es().patchMsg(msgId, { icon: 'blocked' });
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'moderator_mode', enabled ? `on${mute ? ' (mute)' : ''}` : 'off', res);
      return { result: res, failed: !res.ok };
    }
    case 'schedule_reminder': {
      setStatus('acting');
      const title = str('title');
      const at = str('at');
      const kind = ['meeting', 'task', 'call', 'personal', 'other'].includes(str('kind')) ? str('kind') : 'other';
      const msgId = stepLine(t('esiri.step.reminder', { title, at }), 'reminder');
      let res: ActionResult;
      try {
        const item = await api<{ id: number; time: string; date: string }>('/api/day/items', { body: { title, at, kind }, signal: task.abort.signal });
        res = { ok: true, item_id: item.id, date: item.date, time: item.time, note: 'Saved on the user\'s day with a reminder before it.' };
        void useHub.getState().loadDay();
      } catch (e) {
        if (isAbort(e)) throw e;
        res = { ok: false, code: 'invalid', error: e instanceof HttpError ? e.message : String(e) };
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'schedule_reminder', `${at} ${title}`, res);
      return { result: res, failed: !res.ok };
    }
    case 'update_task_status': {
      setStatus('acting');
      const taskId = Number(a.task_id);
      const status = str('status');
      const msgId = stepLine(t('esiri.step.taskStatus', { status: t(`task.status.${status}` as I18nKey) }), 'select');
      let res: ActionResult;
      const selId = `weris.task.${taskId}.status`;
      const onScreen = document.querySelector(`[data-esiri-id="${CSS.escape(selId)}"]`);
      if (!['assigned', 'in_progress', 'done'].includes(status)) res = { ok: false, code: 'invalid', error: 'status must be assigned, in_progress or done' };
      else if (onScreen) res = await selectOption(selId, status, ctx);
      else {
        try {
          await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: { status }, signal: task.abort.signal });
          res = { ok: true, status };
          void useHub.getState().loadTasks();
          window.dispatchEvent(new CustomEvent('nuru:tasks'));
        } catch (e) {
          if (isAbort(e)) throw e;
          res = { ok: false, code: 'invalid', error: e instanceof HttpError ? e.message : String(e) };
        }
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'update_task_status', `${taskId} → ${status}`, res);
      return { result: res, failed: !res.ok };
    }
    case 'katibu_prepare_minutes': {
      setStatus('acting');
      const live = app().live;
      const roomId = str('room_id') || live?.roomId || (pageFromPath(window.location.pathname) === 'room' ? window.location.pathname.split('/')[2] : '');
      const msgId = stepLine(t('esiri.step.katibuPrepare'), 'katibu');
      let res: ActionResult;
      if (!roomId) res = { ok: false, code: 'invalid', error: 'Which meeting? Give room_id (from state.rooms).' };
      else {
        const job = await prepareMinutes(roomId, { confirmed: false, allowSample: a.use_sample === true });
        res =
          job instanceof LiveUnusable
            ? { ok: false, code: 'invalid', error: 'live_unusable', live_unusable: true, reason: job.reason, seconds: job.seconds, note: 'The live recording cannot be used. Tell the user why and ask_user whether to use the sample recording; on yes call katibu_prepare_minutes with use_sample true.' }
            : job
              ? { ok: true, job_id: job.id, title: job.title, status: job.status, audio_source: job.audio_source, audio_note: job.audio_note, note: 'Katibu is preparing the minutes of this meeting from its own recording; NURU will announce when they are ready.' }
              : { ok: false, error: 'Katibu could not start.' };
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'katibu_prepare_minutes', roomId, res);
      return { result: res, failed: !res.ok };
    }
    case 'katibu_status': {
      await useHub.getState().loadJobs();
      const jobs = useHub.getState().jobs.slice(0, 5).map((j) => ({ job_id: j.id, title: j.title, status: j.status, stage: j.stage, progress: j.progress, audio_source: j.audio_source }));
      const res = { ok: true, jobs };
      record(task, 'katibu_status', '', res);
      return { result: res };
    }
    case 'katibu_open_minutes': {
      setStatus('acting');
      await useHub.getState().loadJobs();
      const jobs = useHub.getState().jobs;
      const id = Number(a.job_id) || jobs[0]?.id;
      const msgId = stepLine(t('esiri.step.navigate', { page: t('hub.nav.minutes') }), 'navigate');
      let res: ActionResult;
      if (!id) res = { ok: false, code: 'invalid', error: 'There are no minutes yet.' };
      else if (pageFromPath(window.location.pathname) === 'meeting') res = { ok: false, code: 'invalid', error: 'Leave the meeting first.' };
      else {
        goTo(`/hub/minutes/${id}`);
        await new Promise((r) => window.setTimeout(r, 600));
        res = { ok: true, job_id: id };
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'katibu_open_minutes', String(id ?? ''), res);
      return { result: res, failed: !res.ok };
    }
    case 'katibu_send_minutes': {
      setStatus('acting');
      await useHub.getState().loadJobs();
      const jobs = useHub.getState().jobs;
      const id = Number(a.job_id) || jobs.find((j) => j.status === 'ready')?.id || 0;
      const msgId = stepLine(t('esiri.step.katibuSend'), 'katibu');
      let res: ActionResult;
      if (task.credits <= 0) {
        // Sending minutes is sensitive: enforced in code, not only in the prompt.
        res = { ok: false, code: 'confirmation_required', error: 'confirmation_required: sending minutes is sensitive. Call ask_confirmation first (say how many recipients).' };
        es().patchMsg(msgId, { icon: 'blocked' });
      } else if (!id) res = { ok: false, code: 'invalid', error: 'No minutes are ready to send.' };
      else {
        task.credits = Math.max(0, task.credits - 1);
        const conf = task.confirmations[task.confirmations.length - 1]?.summary ?? '';
        const r = await sendMinutes(id, { confirmedSummary: conf });
        res = r.ok ? { ok: true, job_id: id, recipients: r.job?.recipients ?? [] } : { ok: false, error: r.error };
      }
      es().patchMsg(msgId, { status: res.ok ? 'ok' : 'fail' });
      record(task, 'katibu_send_minutes', String(id), res);
      return { result: res, failed: !res.ok };
    }
    default:
      return { result: { ok: false, error: `Unknown tool "${call.name}".` }, failed: true };
  }
}

// ---------------------------------------------------------------------------
// Confirmation

/** A reply to a confirmation that is neither yes nor no but asks for a change ("ifanye rasmi zaidi"). */
function isChangeRequest(text: string): boolean {
  return text.trim().split(/\s+/).length >= 2 && !isStopUtterance(text);
}

function askConfirmation(task: Task, summary: string): Promise<ConfirmAnswer> {
  const msgId = es().addMsg({ kind: 'confirm', summary, state: 'pending' });
  setStatus('awaiting_confirmation');
  const answer = new Promise<ConfirmAnswer>((resolve) => {
    pendingConfirm = { resolve, msgId };
  });
  void (async () => {
    await speak(summary, lang());
    if (!pendingConfirm || pendingConfirm.msgId !== msgId || task.done) return;
    if (!voiceAvailable()) return; // buttons / typed answer only
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await listen();
      if (!pendingConfirm || pendingConfirm.msgId !== msgId || task.done) return;
      if (res.text) {
        const yn = parseYesNo(res.text);
        es().addMsg({ kind: 'user', text: res.text, mode: 'voice' });
        if (yn) {
          answerConfirmation(yn === 'yes');
          return;
        }
        if (isChangeRequest(res.text)) {
          answerChange(res.text);
          return;
        }
      } else if (res.error && res.error !== 'no-speech') {
        if (res.error !== 'aborted') sttErrorNotice(res.error);
        return; // wait for the buttons
      }
      if (attempt === 0) {
        await speak(t('esiri.sayYesNo'), lang());
        if (!pendingConfirm || pendingConfirm.msgId !== msgId || task.done) return;
      }
    }
    // Still unclear or silent after asking again: treat as No.
    answerConfirmation(false);
  })();
  return answer;
}

function answerChange(text: string): void {
  const p = pendingConfirm;
  if (!p) return;
  pendingConfirm = null;
  stopListening();
  stopSpeaking();
  es().patchMsg(p.msgId, { state: 'declined' });
  p.resolve({ change: text });
}

export function answerConfirmation(yes: boolean): void {
  const p = pendingConfirm;
  if (!p) return;
  pendingConfirm = null;
  stopListening();
  stopSpeaking();
  es().patchMsg(p.msgId, { state: yes ? 'approved' : 'declined' });
  p.resolve(yes);
}

// ---------------------------------------------------------------------------
// Ending tasks

function finalizeTask(task: Task, outcome: Outcome, finalMessage: string): void {
  if (task.done) return;
  task.done = true;
  if (current === task) current = null;
  awaitingAnswer = false;
  const rec: AuditRecord = {
    id: task.id,
    system: systemFromPath(window.location.pathname),
    timestamp: new Date(task.startedAt).toISOString(),
    user: currentPerson().name,
    language: task.language,
    inputMode: task.inputMode,
    request: task.request,
    steps: task.steps,
    confirmations: task.confirmations,
    outcome,
    finalMessage,
    durationMs: Date.now() - task.startedAt,
  };
  app().addAudit(rec);
  postAudit(rec);
}

/** Audit record for things NURU does outside the agent loop (briefing, reminders, moderator mode, Katibu). */
export function logActivity(r: {
  system: NonNullable<AuditRecord['system']>;
  request: string;
  outcome: Outcome;
  finalMessage?: string;
  inputMode?: AuditRecord['inputMode'];
  steps?: AuditStep[];
  confirmations?: AuditConfirmation[];
  startedAt?: number;
}): void {
  const started = r.startedAt ?? Date.now();
  const rec: AuditRecord = {
    id: `act-${Date.now()}-${randomId(4)}`,
    system: r.system,
    timestamp: new Date(started).toISOString(),
    user: currentPerson().name,
    language: lang(),
    inputMode: r.inputMode ?? 'auto',
    request: r.request,
    steps: r.steps ?? [],
    confirmations: r.confirmations ?? [],
    outcome: r.outcome,
    finalMessage: r.finalMessage ?? '',
    durationMs: Date.now() - started,
  };
  app().addAudit(rec);
  postAudit(rec);
}

async function finishTask(task: Task, message: string): Promise<void> {
  hideCursor();
  finalizeTask(task, task.declined ? 'Declined' : 'Completed', message);
  es().addMsg({ kind: 'assistant', text: message });
  setStatus('speaking');
  await speak(message, lang());
  if (es().status === 'speaking' && !current) setStatus('idle');
}

async function failTask(task: Task, message: string): Promise<void> {
  hideCursor();
  finalizeTask(task, 'Failed', message);
  es().addMsg({ kind: 'assistant', text: message });
  es().flashError();
  setStatus('speaking');
  await speak(message, lang());
  if (es().status === 'speaking' && !current) setStatus('idle');
}

/** Esc, Stop button, orb click while working, or a spoken "stop". */
export function cancel(): void {
  const task = current;
  const status = es().status;
  if (!task && status === 'idle' && !es().micOpen) return;
  stopListening();
  stopMicLevel();
  stopSpeaking();
  hideCursor();
  es().setInterim('');
  es().setMicOpen(false);
  if (pendingConfirm) {
    const p = pendingConfirm;
    pendingConfirm = null;
    es().patchMsg(p.msgId, { state: 'declined' });
    p.resolve(false);
  }
  if (task) {
    task.abort.abort();
    const msg = t('esiri.stopped');
    finalizeTask(task, 'Cancelled', msg);
    es().addMsg({ kind: 'assistant', text: msg });
    setStatus('idle');
    void speak(msg, lang());
  } else {
    setStatus('idle');
  }
}

/** Clear the conversation (panel) and the server-side memory. */
export function newConversation(): void {
  cancel();
  es().clearMessages();
  app().newSession();
}

/** Localized string for a given language, used by UI bits outside React. */
export function trFor(l: Language, key: I18nKey): string {
  return tr(l, key);
}

/** Automated tests only: run one tool call in a throwaway task with the given confirmation credits. */
export async function testExecuteTool(name: string, args: Record<string, unknown>, credits = 0): Promise<Record<string, unknown>> {
  const task = newTask(`[test] ${name}`, 'text');
  task.credits = credits;
  const out = await execute(task, { id: 'test', name, arguments: args }, 150);
  task.done = true;
  return { ...out.result, credits_left: task.credits };
}
