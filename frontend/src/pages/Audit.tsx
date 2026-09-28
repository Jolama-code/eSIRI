import { Fragment, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Download, Keyboard, Mic, Trash2, XCircle } from 'lucide-react';
import { CompactHeader, PageFooter } from '../components/Header';
import { Modal } from '../components/Common';
import { ez } from '../components/esiriProps';
import { useT, useLang, type I18nKey } from '../i18n';
import { useApp, formatDateLong, formatTime, type AuditRecord, type Outcome } from '../store/appStore';
import './Audit.css';

const OUTCOMES: Outcome[] = ['Completed', 'Declined', 'Cancelled', 'Failed'];

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditToCsv(records: AuditRecord[]): string {
  const header = ['id', 'timestamp', 'user', 'language', 'input_mode', 'request', 'outcome', 'steps_count', 'steps', 'confirmations', 'final_message', 'duration_ms'];
  const rows = records.map((r) => [
    r.id,
    r.timestamp,
    r.user,
    r.language,
    r.inputMode,
    r.request,
    r.outcome,
    r.steps.length,
    r.steps.map((s) => `${s.tool}:${s.target}${s.text ? ` "${s.text}"` : ''}:${s.ok ? 'ok' : `failed(${s.error ?? ''})`}`).join(' | '),
    r.confirmations.map((c) => `${c.summary} => ${c.result}`).join(' | '),
    r.finalMessage,
    r.durationMs,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export default function Audit() {
  const t = useT();
  const lang = useLang();
  const audit = useApp((s) => s.audit);
  const clearAudit = useApp((s) => s.clearAudit);
  const toast = useApp((s) => s.toast);
  const [filter, setFilter] = useState<Outcome | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);

  const rows = filter === 'all' ? audit : audit.filter((r) => r.outcome === filter);
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, audit.filter((r) => r.outcome === o).length])) as Record<Outcome, number>;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exportCsv = () => {
    const blob = new Blob(['﻿' + auditToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `esiri-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const confStatus = (r: AuditRecord) => {
    if (!r.confirmations.length) return <span className="muted">{t('audit.noConfirmations')}</span>;
    const declined = r.confirmations.some((c) => c.result === 'declined');
    return (
      <span className={`conf ${declined ? 'no' : 'yes'}`}>
        {declined ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        {declined ? t('audit.declined') : t('audit.approved')} ({r.confirmations.length})
      </span>
    );
  };

  return (
    <div className="page dash">
      <CompactHeader />
      <main className="dash-main">
        <div className="container">
          <div className="audit-head">
            <div>
              <h1 className="audit-title">{t('audit.title')}</h1>
              <p className="audit-sub">{t('audit.subtitle')}</p>
            </div>
            <div className="audit-actions">
              <button className="btn btn-outline" onClick={exportCsv} disabled={!rows.length} {...ez('audit.export-csv', t('audit.exportCsv'))}>
                <Download size={16} /> {t('audit.exportCsv')}
              </button>
              <button className="btn btn-danger-outline" onClick={() => setConfirmClear(true)} disabled={!audit.length} {...ez('audit.clear', t('audit.clear'))}>
                <Trash2 size={16} /> {t('audit.clear')}
              </button>
            </div>
          </div>

          <div className="chips">
            {(['all', ...OUTCOMES] as const).map((o) => (
              <button
                key={o}
                className={`chip ${filter === o ? 'active' : ''}`}
                onClick={() => setFilter(o)}
                {...ez(`audit.filter.${o.toLowerCase()}`, o === 'all' ? t('audit.all') : t(`audit.${o}` as I18nKey), { state: filter === o ? 'selected' : 'unselected' })}
              >
                {o === 'all' ? t('audit.all') : t(`audit.${o}` as I18nKey)}
                <span className="chip-count">{o === 'all' ? audit.length : counts[o]}</span>
              </button>
            ))}
          </div>

          <div className="card audit-card">
            {rows.length === 0 ? (
              <p className="audit-empty">{t('audit.empty')}</p>
            ) : (
              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }} />
                      <th>{t('audit.time')}</th>
                      <th>{t('audit.request')}</th>
                      <th>{t('audit.outcome')}</th>
                      <th>{t('audit.steps')}</th>
                      <th>{t('audit.confirmation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const open = expanded.has(r.id);
                      return (
                        <Fragment key={r.id}>
                          <tr className={`audit-row ${open ? 'open' : ''}`} onClick={() => toggle(r.id)} data-testid="audit-row" data-outcome={r.outcome}>
                            <td>
                              <button className="expand-btn" aria-label={t('audit.details')} aria-expanded={open}>
                                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            </td>
                            <td className="nowrap">
                              {formatDateLong(r.timestamp, lang)}
                              <br />
                              <span className="muted">{formatTime(r.timestamp, lang)}</span>
                            </td>
                            <td className="req">
                              {r.inputMode === 'voice' ? <Mic size={14} className="mode-icon" /> : <Keyboard size={14} className="mode-icon" />}
                              {r.request}
                            </td>
                            <td>
                              <span className={`badge badge-${r.outcome}`}>{t(`audit.${r.outcome}` as I18nKey)}</span>
                            </td>
                            <td>{r.steps.length}</td>
                            <td>{confStatus(r)}</td>
                          </tr>
                          {open && (
                            <tr className="audit-detail">
                              <td />
                              <td colSpan={5}>
                                <div className="detail-grid">
                                  <div>
                                    <div className="detail-meta">
                                      <span><b>{t('audit.user')}:</b> {r.user}</span>
                                      <span><b>{t('audit.language')}:</b> {r.language.toUpperCase()}</span>
                                      <span><b>{t('audit.mode')}:</b> {r.inputMode === 'voice' ? t('audit.voice') : t('audit.text')}</span>
                                      <span><b>{t('audit.duration')}:</b> {(r.durationMs / 1000).toFixed(1)} s</span>
                                    </div>
                                    <h4>{t('audit.stepsTitle')}</h4>
                                    {r.steps.length === 0 ? (
                                      <p className="muted">{t('audit.noSteps')}</p>
                                    ) : (
                                      <ol className="step-list">
                                        {r.steps.map((s, i) => (
                                          <li key={i} className={s.ok ? 'ok' : 'fail'}>
                                            <span className="step-time">{formatTime(s.time, lang)}</span>
                                            <code>{s.tool}</code> {s.target}
                                            {s.text ? <> → “{s.text}”</> : null} {s.ok ? '✓' : '✗'}
                                            {s.error && <div className="step-error">{s.error}</div>}
                                          </li>
                                        ))}
                                      </ol>
                                    )}
                                  </div>
                                  <div>
                                    <h4>{t('audit.confirmationsTitle')}</h4>
                                    {r.confirmations.length === 0 ? (
                                      <p className="muted">{t('audit.noConfirmations')}</p>
                                    ) : (
                                      <ul className="conf-list">
                                        {r.confirmations.map((c, i) => (
                                          <li key={i}>
                                            “{c.summary}” — <b className={c.result === 'approved' ? 'yes' : 'no'}>{c.result === 'approved' ? t('audit.approved') : t('audit.declined')}</b>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                    <h4>{t('audit.finalMessage')}</h4>
                                    <p className="final-msg">{r.finalMessage || '—'}</p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      <PageFooter />
      {confirmClear && (
        <Modal
          name="clear-audit"
          title={t('audit.clearTitle')}
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button className="btn btn-neutral" onClick={() => setConfirmClear(false)} {...ez('audit.clear-cancel', t('audit.cancel'))}>
                {t('audit.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  clearAudit();
                  setConfirmClear(false);
                  toast(t('audit.cleared'));
                }}
                {...ez('audit.clear-confirm', t('audit.clearConfirm'), { sensitive: true })}
              >
                {t('audit.clearConfirm')}
              </button>
            </>
          }
        >
          <p className="modal-text">{t('audit.clearBody')}</p>
        </Modal>
      )}
    </div>
  );
}
