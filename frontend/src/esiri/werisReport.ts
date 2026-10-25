/**
 * The weris_report tool: NURU drafts the individual weekly report with ONE structured LLM call
 * (POST /api/weris/reports/current/fill), then fills the cards visibly with the ghost cursor and saves the draft.
 * Submitting is not done here: it is the sensitive click weris.report.submit after ask_confirmation.
 */
import { api, HttpError } from './session';
import { click, navigate, typeText, type ActionResult, type DriverContext } from './driver';
import { pageFromPath } from './nav';
import { useReport, isComplete, TABS, type ItemKind, type Outcome, type TextField } from '../weris/Report';
import { useApp } from '../store/appStore';

interface FilledItem {
  key: string;
  outcome: Outcome;
  progress: string;
  plan: string;
  blockers: string;
  source: 'user' | 'data' | 'generic';
  needs_review: boolean;
}

const lang = () => useApp.getState().language;

/** Open the individual report form (visibly) and load it. */
async function openForm(ctx: DriverContext): Promise<ActionResult> {
  if (pageFromPath(window.location.pathname) !== 'weris_report') {
    const res = await navigate('weris_report', undefined, ctx);
    if (!res.ok) return res;
  }
  for (let i = 0; i < 30 && !useReport.getState().report; i++) await new Promise((r) => setTimeout(r, 100));
  const r = (await useReport.getState().load()) ?? useReport.getState().report;
  return r ? { ok: true } : { ok: false, error: useReport.getState().error || 'The report could not be loaded.' };
}

function summary() {
  const r = useReport.getState().report!;
  return {
    week: r.week,
    status: r.status,
    incomplete: r.items.filter((i) => !isComplete(i)).length,
    items: r.items.map((i) => ({
      key: i.key, kind: i.kind, name: i.name, last_week_promise: i.promise || null, complete: isComplete(i),
      needs_review: Object.values(i.nuru).includes('review'),
    })),
  };
}

async function showTab(kind: ItemKind, ctx: DriverContext): Promise<void> {
  if (useReport.getState().tab === kind) return;
  const tab = TABS.find((x) => x.kind === kind)!;
  await click(`weris.report.tab.${tab.id}`, ctx);
}

export async function runWerisReport(
  args: { action: string; request: string; scope: string; keys: string[] },
  ctx: DriverContext,
  onProgress: (key: 'drafting' | 'filling', n?: number) => void,
): Promise<ActionResult> {
  const opened = await openForm(ctx);
  if (!opened.ok) return opened;
  if (args.action !== 'fill') {
    const st = summary();
    const n = st.items.find((i) => !i.complete);
    return { ok: true, ...st, next_incomplete: n ? { key: n.key, name: n.name, last_week_promise: n.last_week_promise } : null };
  }
  if (useReport.getState().report!.status === 'SUBMITTED') {
    return { ok: false, code: 'invalid', error: "This week's report is already submitted; it can't be changed." };
  }

  onProgress('drafting');
  let items: FilledItem[];
  try {
    const scope = args.scope === 'keys' ? 'all' : args.scope === 'all' ? 'all' : 'mentioned';
    const keys = args.scope === 'keys' ? args.keys : [];
    ({ items } = await api<{ items: FilledItem[] }>('/api/weris/reports/current/fill', {
      body: { request: args.request, scope, keys }, signal: ctx.signal,
    }));
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const msg = e instanceof HttpError ? (lang() === 'sw' ? e.messageSw : e.message) : String(e);
    return { ok: false, error: msg };
  }

  // Fill visibly: tab by tab, card by card, in the page order.
  const order = useReport.getState().report!.items.map((i) => i.key);
  items.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const store = useReport.getState;
  let n = 0;
  for (const it of items) {
    const cur = store().report!.items.find((i) => i.key === it.key);
    if (!cur) continue;
    onProgress('filling', ++n);
    await showTab(cur.kind, ctx);
    const mark = it.needs_review ? 'review' : 'ok';
    if (it.outcome && cur.promise && cur.outcome !== it.outcome) {
      const r = await click(`weris.report.${it.key}.outcome.${it.outcome.replace('_', '-')}`, ctx);
      if (r.ok) store().mark(it.key, { outcome: mark });
    }
    for (const f of ['progress', 'plan', 'blockers'] as TextField[]) {
      const text = it[f].trim();
      if (!text || text === cur[f].trim()) continue;
      const r = await typeText(`weris.report.${it.key}.${f}`, text, ctx, { fast: true });
      if (r.ok) store().mark(it.key, { [f]: mark });
    }
  }
  const saved = await click('weris.report.save', ctx);
  const nameOf = (key: string) => store().report?.items.find((i) => i.key === key)?.name ?? key;
  const s = summary();
  const next = s.items.find((i) => !i.complete);
  return {
    ok: saved.ok,
    ...(saved.ok ? {} : { error: `The draft could not be saved: ${saved.error ?? store().error}` }),
    filled: items.map((i) => nameOf(i.key)),
    needs_review: items.filter((i) => i.needs_review).map((i) => nameOf(i.key)),
    draft_saved: saved.ok,
    week: s.week,
    incomplete: s.incomplete,
    remaining_incomplete: s.items.filter((i) => !i.complete).map((i) => ({ key: i.key, name: i.name, last_week_promise: i.last_week_promise })),
    note: next
      ? `Not finished: ${s.incomplete} item(s) are still empty. Card by card: ask_user now about the next one, "${next.name}"` +
        (next.last_week_promise ? ` (last week's promise: "${next.last_week_promise}")` : '') +
        '. Do not ask to submit yet.'
      : 'All items are complete. Tell the user (their language) how many items were filled and which need review, then ask_confirmation to submit (weris.report.submit).',
  };
}
