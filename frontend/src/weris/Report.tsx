/**
 * WERIS → Reports: the "Weekly Reports" landing and the Individual (Interns) weekly report form
 * (Projects / Assignments / PDPs), the layout of the real WERIS page.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useT } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { api, HttpError } from '../esiri/session';
import { useApp } from '../store/appStore';
import { WerisFrame, useWeris } from './Weris';
import './report.css';

export type ItemKind = 'project' | 'assignment' | 'pdp';
export type Outcome = '' | 'done' | 'partial' | 'not_done';
export type TextField = 'progress' | 'plan' | 'blockers';
/** Which fields NURU wrote: 'ok' or 'review' (needs the user's review). Removed when the user edits the field. */
export type NuruMarks = Partial<Record<TextField | 'outcome', 'ok' | 'review'>>;

export interface ReportItem {
  key: string;
  kind: ItemKind;
  ref_id: number;
  name: string;
  promise: string;
  detail?: string;
  due?: string;
  outcome: Outcome;
  progress: string;
  plan: string;
  blockers: string;
  nuru: NuruMarks;
}

export interface FullReport {
  id: number;
  week: string;
  start_date: string;
  end_date: string;
  status: 'DRAFT' | 'SUBMITTED';
  submitted_at: string | null;
  items: ReportItem[];
}

export const TABS: { kind: ItemKind; id: string; label: I18nKey }[] = [
  { kind: 'project', id: 'projects', label: 'wr.tab.projects' },
  { kind: 'assignment', id: 'assignments', label: 'wr.tab.assignments' },
  { kind: 'pdp', id: 'pdps', label: 'wr.tab.pdps' },
];

export const isComplete = (i: ReportItem): boolean => !!i.progress.trim() && !!i.plan.trim();

interface ReportState {
  report: FullReport | null;
  tab: ItemKind;
  error: string;
  saving: boolean;
  load: () => Promise<FullReport | null>;
  setTab: (k: ItemKind) => void;
  setField: (key: string, field: TextField, value: string) => void;
  setOutcome: (key: string, outcome: Outcome) => void;
  mark: (key: string, marks: NuruMarks) => void;
  save: (submit: boolean) => Promise<{ ok: boolean; error?: string }>;
}

function patchItem(r: FullReport | null, key: string, f: (i: ReportItem) => ReportItem): FullReport | null {
  return r ? { ...r, items: r.items.map((i) => (i.key === key ? f(i) : i)) } : r;
}

function unmark(m: NuruMarks, field: keyof NuruMarks): NuruMarks {
  const n = { ...m };
  delete n[field];
  return n;
}

export const useReport = create<ReportState>()((set, get) => ({
  report: null,
  tab: 'project',
  error: '',
  saving: false,
  load: async () => {
    try {
      const r = await api<FullReport>('/api/weris/reports/current');
      set({ report: r, error: '' });
      return r;
    } catch (e) {
      set({ error: String((e as Error).message) });
      return null;
    }
  },
  setTab: (tab) => set({ tab }),
  // A human edit (or NURU typing, which marks the field afterwards) clears the "prepared by NURU" chip.
  setField: (key, field, value) => set((s) => ({ report: patchItem(s.report, key, (i) => ({ ...i, [field]: value, nuru: unmark(i.nuru, field) })) })),
  setOutcome: (key, outcome) => set((s) => ({ report: patchItem(s.report, key, (i) => ({ ...i, outcome, nuru: unmark(i.nuru, 'outcome') })) })),
  mark: (key, marks) => set((s) => ({ report: patchItem(s.report, key, (i) => ({ ...i, nuru: { ...i.nuru, ...marks } })) })),
  save: async (submit) => {
    const r = get().report;
    if (!r) return { ok: false, error: 'not loaded' };
    set({ saving: true });
    try {
      const items = r.items.map(({ key, outcome, progress, plan, blockers, nuru }) => ({ key, outcome, progress, plan, blockers, nuru }));
      const saved = await api<FullReport>('/api/weris/reports/current', { method: 'PUT', body: { items, submit } });
      set({ report: saved, error: '', saving: false });
      void useWeris.getState().loadReports();
      return { ok: true };
    } catch (e) {
      const lang = useApp.getState().language;
      const msg = e instanceof HttpError ? (lang === 'sw' ? e.messageSw : e.message) : String(e);
      set({ error: msg, saving: false });
      return { ok: false, error: msg };
    }
  },
}));

// ---------------------------------------------------------------------------
// Landing: Weekly Reports

export function WerisReports() {
  const t = useT();
  const navigate = useNavigate();
  const notInDemo = () => useApp.getState().toast(t('stack.notInDemo'));
  useEffect(() => {
    void useWeris.getState().loadReports();
  }, []);
  return (
    <WerisFrame crumbs={[]}>
      <div className="wr-landing">
        <div className="wr-eyebrow">{t('wr.module')}</div>
        <h1 className="wr-h1">{t('wr.title')}</h1>
        <p className="wr-lead">
          {t('wr.lead1')} <b>{t('wr.leadProjects')}</b>
          {t('wr.lead2')} <b>{t('wr.leadInterns')}</b> {t('wr.lead3')}
        </p>
        <div className="wr-cards">
          <button className="wr-card" onClick={notInDemo} {...ez('weris.reports.project', t('wr.projectReports'))}>
            <span className="wr-card-ico folder" aria-hidden>📁</span>
            <span className="wr-card-arrow" aria-hidden>→</span>
            <span className="wr-card-title">{t('wr.projectReports')}</span>
            <span className="wr-card-desc">{t('wr.projectReportsDesc')}</span>
          </button>
          <button className="wr-card" onClick={() => navigate('/weris/reports/individual')} {...ez('weris.reports.individual', t('wr.individualReports'))} data-testid="wr-individual">
            <span className="wr-card-ico intern" aria-hidden>🧑‍🎓</span>
            <span className="wr-card-arrow" aria-hidden>→</span>
            <span className="wr-card-title">{t('wr.individualReports')}</span>
            <span className="wr-card-desc">{t('wr.individualReportsDesc')}</span>
          </button>
        </div>
        <button className="wr-security" onClick={notInDemo} {...ez('weris.reports.security', t('wr.securityReports'))}>
          <span aria-hidden>🛡️</span> {t('wr.securityReports')} <span className="wr-security-arrow">→</span>
        </button>
      </div>
    </WerisFrame>
  );
}

// ---------------------------------------------------------------------------
// Individual weekly report form

function NuruChip({ mark }: { mark?: 'ok' | 'review' }) {
  const t = useT();
  if (!mark) return null;
  return (
    <span className={`wr-nuru ${mark}`} data-testid="wr-nuru-chip">
      ✦ {t('wr.byNuru')}
      {mark === 'review' ? ` · ${t('wr.review')}` : ''}
    </span>
  );
}

const OUTCOMES: { value: Exclude<Outcome, ''>; label: I18nKey }[] = [
  { value: 'done', label: 'wr.done' },
  { value: 'partial', label: 'wr.partial' },
  { value: 'not_done', label: 'wr.notDone' },
];

function ItemCard({ item, readOnly }: { item: ReportItem; readOnly: boolean }) {
  const t = useT();
  const { setField, setOutcome } = useReport.getState();
  const [file, setFile] = useState('');
  const done = isComplete(item);
  const kindLabel: I18nKey = item.kind === 'project' ? 'wr.kind.project' : item.kind === 'assignment' ? 'wr.kind.assignment' : 'wr.kind.pdp';
  const field = (f: TextField, label: I18nKey, ph: I18nKey, required: boolean, rows: number) => (
    <div className="wr-field">
      <label htmlFor={`wr-${item.key}-${f}`}>
        {t(label)}
        {required && <span className="wr-req"> *</span>}
        <NuruChip mark={item.nuru[f]} />
      </label>
      <textarea
        id={`wr-${item.key}-${f}`}
        rows={rows}
        value={item[f]}
        readOnly={readOnly}
        placeholder={t(ph)}
        onChange={(e) => setField(item.key, f, e.target.value)}
        {...ez(`weris.report.${item.key}.${f}`, `${item.name}: ${t(label)}`)}
        data-testid={`wr-${f}`}
      />
    </div>
  );
  return (
    <section className="wr-item" data-testid="wr-item" data-key={item.key} id={`wr-item-${item.key}`}>
      <header className="wr-item-head">
        <span className="wr-kind">{t(kindLabel)}</span>
        <span className="wr-item-name">{item.name}</span>
        <span className={`wr-state ${done ? 'complete' : 'incomplete'}`} data-testid="wr-item-state">
          {done ? t('wr.complete') : t('wr.incomplete')}
        </span>
      </header>
      <div className="wr-item-body">
        {item.promise ? (
          <div className="wr-promise">
            <div className="wr-promise-label">{t('wr.lastPromise')}</div>
            <div className="wr-promise-text" data-testid="wr-promise">{item.promise}</div>
            <div className="wr-how">
              {t('wr.howDidItGo')} <NuruChip mark={item.nuru.outcome} />
            </div>
            <div className="wr-outcomes">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={readOnly}
                  className={item.outcome === o.value ? 'on' : ''}
                  onClick={() => setOutcome(item.key, item.outcome === o.value ? '' : o.value)}
                  {...ez(`weris.report.${item.key}.outcome.${o.value.replace('_', '-')}`, `${item.name}: ${t(o.label)}`, { state: item.outcome === o.value ? 'selected' : 'unselected' })}
                >
                  {t(o.label)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="wr-promise plain">
            <div className="wr-promise-label">{item.kind === 'assignment' ? t('wr.taskDetails') : t('wr.pdpDetails')}</div>
            <div className="wr-promise-text">{item.detail || '—'}</div>
            {item.due && <div className="wr-how">{t('wr.due', { when: item.due })}</div>}
          </div>
        )}
        {field('progress', 'wr.progress', 'wr.progressPh', true, 3)}
        {field('plan', 'wr.plan', 'wr.planPh', true, 3)}
        {field('blockers', 'wr.blockers', 'wr.blockersPh', false, 2)}
        <div className="wr-field">
          <span className="wr-attach-label">{t('wr.attachments')}</span>
          <label className="wr-file">
            <input type="file" disabled={readOnly} onChange={(e) => setFile(e.target.files?.[0]?.name ?? '')} />
            <span className="wr-file-btn">{t('wr.chooseFile')}</span>
            <span className="wr-file-name">{file || t('wr.noFile')}</span>
          </label>
        </div>
      </div>
    </section>
  );
}

export function WerisIndividualReport() {
  const t = useT();
  const navigate = useNavigate();
  const report = useReport((s) => s.report);
  const tab = useReport((s) => s.tab);
  const error = useReport((s) => s.error);
  const saving = useReport((s) => s.saving);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    void useReport.getState().load();
  }, []);
  if (!report) {
    return (
      <WerisFrame crumbs={[]}>
        <div className="wr-loading">{error || t('wr.loading')}</div>
      </WerisFrame>
    );
  }
  const readOnly = report.status === 'SUBMITTED';
  const missing = report.items.filter((i) => !isComplete(i)).length;
  const shown = report.items.filter((i) => i.kind === tab);
  const save = async (submit: boolean) => {
    const r = await useReport.getState().save(submit);
    if (r.ok) toast(submit ? t('wr.submittedToast') : t('wr.savedToast'));
  };
  return (
    <WerisFrame crumbs={[]}>
      <div className="wr-form" data-testid="wr-form">
        <div className="wr-form-head">
          <div>
            <h2 className="wr-form-title" data-testid="wr-title">
              {t('wr.formTitle')} — {report.week} ({report.start_date} → {report.end_date})
            </h2>
            <div className="wr-status" data-testid="wr-status">
              {t('wr.status')}: {report.status}
            </div>
          </div>
          <button className="wr-back" onClick={() => navigate('/weris/reports')} {...ez('weris.report.back', t('wr.back'))}>
            ← {t('wr.back')}
          </button>
        </div>
        <div className="wr-panel">
          <div className="wr-tabs" role="tablist">
            {TABS.map((tb) => {
              const items = report.items.filter((i) => i.kind === tb.kind);
              const n = items.filter(isComplete).length;
              return (
                <button
                  key={tb.kind}
                  role="tab"
                  className={tab === tb.kind ? 'on' : ''}
                  onClick={() => useReport.getState().setTab(tb.kind)}
                  {...ez(`weris.report.tab.${tb.id}`, t(tb.label), { state: tab === tb.kind ? 'selected' : 'unselected' })}
                  data-testid={`wr-tab-${tb.id}`}
                >
                  {t(tb.label)}{' '}
                  <span className={`wr-count ${items.length && n === items.length ? 'full' : n < items.length ? 'part' : ''}`} data-testid={`wr-count-${tb.id}`}>
                    {n}/{items.length}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="wr-items">
            {shown.length === 0 && <div className="wr-empty">{t('wr.noItems')}</div>}
            {shown.map((i) => (
              <ItemCard key={i.key} item={i} readOnly={readOnly} />
            ))}
          </div>
        </div>
        <footer className="wr-foot">
          <span className={`wr-foot-msg ${readOnly ? 'ok' : missing ? 'warn' : 'ok'}`} data-testid="wr-footer-msg">
            {readOnly
              ? t('wr.submittedOn', { when: report.submitted_at ? new Date(report.submitted_at).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' }) : '' })
              : missing
                ? t(missing === 1 ? 'wr.needsOne' : 'wr.needsMany', { n: missing })
                : t('wr.allComplete')}
            {error && !readOnly ? <span className="wr-foot-err"> · {error}</span> : null}
          </span>
          {!readOnly && (
            <>
              <button className="wr-btn ghost" disabled={saving} onClick={() => void save(false)} {...ez('weris.report.save', t('wr.saveDraft'))} data-testid="wr-save">
                {t('wr.saveDraft')}
              </button>
              <button
                className="wr-btn"
                disabled={saving || missing > 0}
                onClick={() => void save(true)}
                {...ez('weris.report.submit', t('wr.submit'), { sensitive: true })}
                data-testid="wr-submit"
              >
                {t('wr.submit')}
              </button>
            </>
          )}
        </footer>
      </div>
    </WerisFrame>
  );
}
