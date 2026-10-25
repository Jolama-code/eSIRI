import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  faCheck, faCircleExclamation, faDownload, faFileLines, faFlask, faMicrophone, faPaperPlane, faRobot, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { Modal } from '../components/Common';
import { authFetch } from '../esiri/session';
import { sendMinutes } from '../esiri/katibuActions';
import { JourneyPanel } from './Journey';
import { useHub, type KatibuJobRow, type MinutesContent } from './hubStore';
import { HubLayout } from './HubLayout';
import { Card, Empty, Fa, IconShape, Skeleton, dateTime } from './ui';

export function KatibuBadge() {
  const t = useT();
  return (
    <span className="katibu-badge" data-testid="katibu-badge">
      <span className="kb-ico">
        <Fa icon={faRobot} />
      </span>
      {t('minutes.preparedBy')}
    </span>
  );
}

function jobChip(status: KatibuJobRow['status']): string {
  return status === 'ready' || status === 'sent' ? 'green' : status === 'failed' ? 'red' : 'amber';
}

function Progress({ job }: { job: KatibuJobRow }) {
  const t = useT();
  const lang = useLang();
  const stage = lang === 'sw' ? job.stage_sw : job.stage_en;
  return (
    <div data-testid="katibu-progress">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <span className="t-card">{stage || t('minutes.status.uploading')}</span>
        <span className="t-num" style={{ fontWeight: 700, color: 'var(--nuru-navy)' }}>{job.progress}%</span>
      </div>
      <div className="prog">
        <span style={{ width: `${Math.max(3, job.progress)}%` }} />
      </div>
    </div>
  );
}

function SourceNote({ job }: { job: KatibuJobRow }) {
  const t = useT();
  return (
    <div className="source-note" data-testid="audio-source">
      <Fa icon={job.audio_source === 'sample' ? faFlask : faMicrophone} />
      {job.audio_source === 'sample' ? t('minutes.sampleUsed') : t('minutes.liveUsed')}
      {job.audio_note && job.audio_source === 'sample' && <span>· {t(`minutes.note.${job.audio_note}` as I18nKey)}</span>}
    </div>
  );
}

export function MinutesList() {
  const t = useT();
  const lang = useLang();
  const jobs = useHub((s) => s.jobs);
  const loaded = useHub((s) => s.jobsLoaded);
  useEffect(() => {
    void useHub.getState().loadJobs();
  }, []);
  return (
    <HubLayout title={t('hub.nav.minutes')} subtitle={t('minutes.subtitle')}>
      <Card i={1}>
        <div className="hcard-head">
          <h2 className="t-section">{t('minutes.all')}</h2>
          <KatibuBadge />
        </div>
        {!loaded ? (
          <Skeleton h={60} />
        ) : !jobs.length ? (
          <Empty icon={faFileLines} text={t('minutes.empty')} />
        ) : (
          <div className="hlist">
            {jobs.map((j, i) => (
              <Link to={`/hub/minutes/${j.id}`} key={j.id} className="hrow rise" style={{ ['--i' as string]: i, textDecoration: 'none' }} data-testid="minutes-row" {...ez(`hub.minutes.${j.id}.open`, j.title)}>
                <IconShape icon={faFileLines} tone={j.status === 'failed' ? 'red' : 'navy'} size={40} shape="tile" />
                <div style={{ minWidth: 0 }}>
                  <div className="hrow-title">{j.title}</div>
                  <div className="hrow-sub">
                    {dateTime(j.created_at, lang)} · {j.audio_source === 'sample' ? t('minutes.sampleShort') : t('minutes.liveShort')}
                  </div>
                  {(j.status === 'processing' || j.status === 'uploading') && (
                    <div className="prog" style={{ marginTop: 8, maxWidth: 320 }}>
                      <span style={{ width: `${Math.max(3, j.progress)}%` }} />
                    </div>
                  )}
                </div>
                <div className="hrow-side">
                  <span className={`chip ${jobChip(j.status)}`}>{t(`minutes.status.${j.status}` as I18nKey)}</span>
                  {(j.status === 'processing' || j.status === 'uploading') && <span className="t-small t-num">{j.progress}%</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </HubLayout>
  );
}

function point(p: { text: string } | string): string {
  return typeof p === 'string' ? p : p.text;
}

function MinutesBody({ m }: { m: MinutesContent }) {
  const t = useT();
  return (
    <div className="minutes-doc" data-testid="minutes-content">
      {m.summary && (
        <section>
          <h3 className="t-section">{t('minutes.summary')}</h3>
          <p data-testid="minutes-summary">{m.summary}</p>
        </section>
      )}
      {m.topics && m.topics.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {m.topics.map((x) => (
            <span className="chip" key={x}>{x}</span>
          ))}
        </div>
      )}
      {m.agenda_items && m.agenda_items.length > 0 && (
        <section>
          <h3 className="t-section">{t('minutes.agenda')}</h3>
          <ol>
            {m.agenda_items.map((a) => (
              <li key={a.number}>
                <b>{a.title}</b>
                {a.key_points && <ul>{a.key_points.map((k, i) => <li key={i}>{k.text}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {m.themes && m.themes.length > 0 && (
        <section>
          <h3 className="t-section">{t('minutes.themes')}</h3>
          <ol>
            {m.themes.map((th, i) => (
              <li key={i}>
                <b>{th.title}</b>
                <ul>
                  {th.points.map((p, k) => (
                    <li key={k}>{point(p)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
      {m.decisions && m.decisions.length > 0 && (
        <section>
          <h3 className="t-section">{t('minutes.decisions')}</h3>
          <ul>
            {m.decisions.map((d, i) => (
              <li key={i}>{d.text}</li>
            ))}
          </ul>
        </section>
      )}
      {m.action_items && m.action_items.length > 0 && (
        <section>
          <h3 className="t-section">{t('minutes.actions')}</h3>
          <div className="table-wrap">
            <table className="action-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('minutes.task')}</th>
                  <th>{t('minutes.owner')}</th>
                  <th>{t('minutes.due')}</th>
                </tr>
              </thead>
              <tbody>
                {m.action_items.map((a) => (
                  <tr key={a.number}>
                    <td className="t-num">{a.number}</td>
                    <td>{a.task}</td>
                    <td>{a.owner}</td>
                    <td>{a.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

async function download(job: KatibuJobRow, lang: string, fmt: string): Promise<void> {
  const r = await authFetch(`/api/katibu/jobs/${job.id}/documents/${lang}/${fmt}`);
  if (!r.ok) return;
  const blob = await r.blob();
  const doc = job.documents.find((d) => d.language === lang && d.format === fmt);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = doc?.fileName || `minutes_${lang}.${fmt.toLowerCase()}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function MinutesDetail() {
  const t = useT();
  const lang = useLang();
  const { jobId } = useParams();
  const job = useHub((s) => s.jobs.find((j) => String(j.id) === jobId));
  const loaded = useHub((s) => s.jobsLoaded);
  const [mLang, setMLang] = useState<'sw' | 'en'>(lang);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    void useHub.getState().loadJobs();
  }, [jobId]);

  if (!job) {
    return (
      <HubLayout title={t('hub.nav.minutes')}>
        <Card>{loaded ? <Empty icon={faFileLines} text={t('minutes.notFound')} /> : <Skeleton h={80} />}</Card>
      </HubLayout>
    );
  }
  const m = mLang === 'sw' ? job.minutes_sw : job.minutes_en;
  const ready = job.status === 'ready' || job.status === 'sent';
  const n = job.default_recipients?.length ?? 1;

  const doSend = async () => {
    setConfirming(false);
    setSending(true);
    setSendError('');
    const res = await sendMinutes(job.id, { confirmedSummary: t(n === 1 ? 'minutes.sendConfirmOne' : 'minutes.sendConfirm', { n }) });
    if (!res.ok) setSendError(String(res.error ?? ''));
    setSending(false);
  };

  return (
    <HubLayout title={job.title} subtitle={dateTime(job.created_at, lang)} actions={<KatibuBadge />}>
      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <Card i={1} testid="minutes-card">
            <div className="hcard-head" style={{ flexWrap: 'wrap' }}>
              <h2 className="t-section">{t('minutes.title')}</h2>
              <span className={`chip ${jobChip(job.status)}`} data-testid="minutes-status">{t(`minutes.status.${job.status}` as I18nKey)}</span>
              {ready && (
                <div className="seg">
                  <button className={mLang === 'sw' ? 'on' : ''} onClick={() => setMLang('sw')} {...ez('hub.minutes.lang.sw', 'Kiswahili', { state: mLang === 'sw' ? 'selected' : 'unselected' })}>
                    Kiswahili
                  </button>
                  <button className={mLang === 'en' ? 'on' : ''} onClick={() => setMLang('en')} {...ez('hub.minutes.lang.en', 'English', { state: mLang === 'en' ? 'selected' : 'unselected' })}>
                    English
                  </button>
                </div>
              )}
            </div>
            {(job.status === 'processing' || job.status === 'uploading') && <Progress job={job} />}
            {job.status === 'failed' && (
              <div className="login-error" data-testid="minutes-error">
                <Fa icon={faCircleExclamation} /> {lang === 'sw' ? job.error.sw : job.error.en}
              </div>
            )}
            {ready && <MinutesBody m={m} />}
          </Card>
          <Card i={2} testid="journey-card">
            <h2 className="t-section" style={{ marginBottom: 12 }}>{t('minutes.journey')}</h2>
            <JourneyPanel job={job} />
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <Card i={2}>
            <h2 className="t-section" style={{ marginBottom: 12 }}>{t('minutes.recording')}</h2>
            <SourceNote job={job} />
            {job.processing_seconds != null && <p className="t-small">{t('minutes.processedIn', { s: job.processing_seconds })}</p>}
          </Card>
          {ready && (
            <Card i={3}>
              <h2 className="t-section" style={{ marginBottom: 12 }}>{t('minutes.documents')}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['SW', 'EN'] as const).flatMap((l) =>
                  (['PDF', 'DOCX'] as const).map((f) => {
                    const has = job.documents.some((d) => d.language === l && d.format === f);
                    return (
                      <button key={`${l}${f}`} className="hbtn sm ghost" disabled={!has} onClick={() => void download(job, l, f)} {...ez(`hub.minutes.download.${l.toLowerCase()}.${f.toLowerCase()}`, `${f} ${l}`)}>
                        <Fa icon={faDownload} /> {f} · {l}
                      </button>
                    );
                  }),
                )}
              </div>
            </Card>
          )}
          {ready && (
            <Card i={4}>
              <h2 className="t-section" style={{ marginBottom: 12 }}>{t('minutes.send')}</h2>
              {job.status === 'ready' ? (
                <>
                  <p className="t-small" style={{ marginTop: 0 }}>{t(n === 1 ? 'minutes.sendHintOne' : 'minutes.sendHint', { n })}</p>
                  <button className="hbtn" onClick={() => setConfirming(true)} disabled={sending} data-testid="minutes-send" {...ez('hub.minutes.send', t('minutes.sendButton'))}>
                    <Fa icon={faPaperPlane} /> {sending ? t('minutes.sending') : t('minutes.sendButton')}
                  </button>
                  {sendError && <div className="login-error" style={{ marginTop: 10 }}>{sendError}</div>}
                </>
              ) : (
                <div className="hlist" data-testid="deliveries">
                  {(job.deliveries.length ? job.deliveries : job.recipients.map((e) => ({ email: e, displayName: '', status: 'QUEUED', sentAt: null, error: '' }))).map((d) => (
                    <div className="hrow" key={d.email} data-testid="delivery-row">
                      <IconShape icon={d.status === 'SENT' ? faCheck : d.status === 'FAILED' ? faXmark : faPaperPlane} tone={d.status === 'SENT' ? 'green' : d.status === 'FAILED' ? 'red' : 'frost'} size={34} />
                      <div style={{ minWidth: 0 }}>
                        <div className="hrow-title">{d.email}</div>
                        {d.error && <div className="hrow-sub">{d.error}</div>}
                      </div>
                      <span className={`chip ${d.status === 'SENT' ? 'green' : d.status === 'FAILED' ? 'red' : 'amber'}`}>{t(`delivery.${d.status}` as I18nKey)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      {confirming && (
        <Modal
          name="send-minutes"
          title={t('minutes.sendButton')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="hbtn ghost" onClick={() => setConfirming(false)} {...ez('send-minutes.cancel', t('esiri.no'))}>
                {t('esiri.no')}
              </button>
              <button className="hbtn" onClick={() => void doSend()} data-testid="minutes-send-confirm" {...ez('send-minutes.confirm', t('esiri.yes'), { sensitive: true })}>
                {t('esiri.yes')}
              </button>
            </>
          }
        >
          <p>{t(n === 1 ? 'minutes.sendConfirmOne' : 'minutes.sendConfirm', { n })}</p>
        </Modal>
      )}
    </HubLayout>
  );
}
