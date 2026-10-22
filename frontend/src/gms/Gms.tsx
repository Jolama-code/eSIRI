import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  faArrowPointer, faBold, faCalendarCheck, faCalendarDays, faComments, faEllipsis, faEllipsisVertical, faEnvelope,
  faFire, faFloppyDisk, faGear, faInbox, faItalic, faLink, faListUl, faMagnifyingGlass, faNoteSticky, faPaperclip,
  faPaperPlane, faPencil, faPenToSquare, faReply, faReplyAll, faRotate, faRotateLeft, faShare, faSliders, faStar, faTag,
  faTrashCan, faUnderline, faUser, faUsers, faXmark, faCircleExclamation, faHardDrive, faLock,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { api, HttpError, login, patchMe, useSession } from '../esiri/session';
import { useApp } from '../store/appStore';
import { Fa } from '../hub/ui';
import { emptyCompose, splitAddrs, useGms, type MailFull } from './gmsStore';
import './gms.css';

const FOLDERS: { id: string; icon: IconDefinition; label: I18nKey }[] = [
  { id: 'inbox', icon: faInbox, label: 'gms.inbox' },
  { id: 'drafts', icon: faPencil, label: 'gms.drafts' },
  { id: 'sent', icon: faPaperPlane, label: 'gms.sent' },
  { id: 'junk', icon: faFire, label: 'gms.junk' },
  { id: 'trash', icon: faTrashCan, label: 'gms.trash' },
];

function initials(name: string): string {
  const p = name.replace(/^(Dkt|Dr)\.?\s+/i, '').split(/[\s@.]+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}

const AVATAR_TONES = ['#e74c3c', '#e67e22', '#27ae60', '#2980b9', '#8e44ad', '#16a085', '#c0392b'];
function tone(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function gmsDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}

function useNotInDemo() {
  const t = useT();
  return () => useApp.getState().toast(t('stack.notInDemo'));
}

// ---------------------------------------------------------------------------
// Frame: header, icon rail, folders

function GmsFrame({ children, active }: { children: ReactNode; active: 'mail' | 'compose' }) {
  const t = useT();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const folder = useGms((s) => s.folder);
  const unread = useGms((s) => s.unread);
  const drafts = useGms((s) => s.drafts);
  const notInDemo = useNotInDemo();
  const rail: { id: string; icon: IconDefinition; label: I18nKey; go?: () => void }[] = [
    { id: 'compose', icon: faPenToSquare, label: 'gms.compose', go: () => navigate('/gms/compose') },
    { id: 'mail', icon: faEnvelope, label: 'gms.mail', go: () => navigate('/gms/inbox') },
    { id: 'contacts', icon: faUsers, label: 'gms.contacts' },
    { id: 'notes', icon: faNoteSticky, label: 'gms.notes' },
    { id: 'tasks', icon: faCalendarCheck, label: 'gms.tasks' },
    { id: 'calendar', icon: faCalendarDays, label: 'gms.calendar' },
    { id: 'settings', icon: faGear, label: 'gms.settings' },
  ];
  return (
    <div className="gms" data-testid="gms">
      <header className="gms-head">
        <img className="gms-coat" src="/assets/tanzania-coat-of-arms.svg" alt="" />
        <div className="gms-titles">
          <div className="gms-t1">The United Republic of Tanzania</div>
          <div className="gms-t2">Government Mailing System</div>
        </div>
        <span className="gms-pill" data-testid="gms-user">{user?.email}</span>
      </header>
      <div className="gms-body">
        <nav className="gms-rail">
          {rail.map((r) => (
            <button
              key={r.id}
              className={`rail-btn ${r.id === 'compose' ? 'compose' : ''} ${(r.id === 'mail' && active === 'mail') || (r.id === 'compose' && active === 'compose') ? 'on' : ''}`}
              onClick={r.go ?? notInDemo}
              {...ez(`gms.nav.${r.id}`, t(r.label))}
            >
              <Fa icon={r.icon} />
              <span>{t(r.label)}</span>
            </button>
          ))}
        </nav>
        <aside className="gms-folders">
          <div className="gf-head">
            <span>{user?.email}</span>
            <Fa icon={faEllipsisVertical} />
          </div>
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              className={`gf-item ${active === 'mail' && folder === f.id ? 'on' : ''}`}
              onClick={() => navigate(`/gms/${f.id}`)}
              {...ez(`gms.folder.${f.id}`, t(f.label), { state: folder === f.id ? 'selected' : 'unselected' })}
            >
              <Fa icon={f.icon} /> <span className="gf-label">{t(f.label)}</span>
              {f.id === 'inbox' && unread > 0 && <span className="gf-count" data-testid="gms-unread">{unread}</span>}
              {f.id === 'drafts' && drafts > 0 && <span className="gf-count muted">{drafts}</span>}
            </button>
          ))}
          <div className="gf-quota">
            <Fa icon={faHardDrive} />
            <span className="gf-bar">
              <span style={{ width: '4%' }} />
            </span>
            <span>4%</span>
          </div>
        </aside>
        {children}
      </div>
    </div>
  );
}

function MessageList() {
  const t = useT();
  const navigate = useNavigate();
  const { folder = 'inbox', mailId } = useParams();
  const messages = useGms((s) => s.messages);
  const loaded = useGms((s) => s.loaded);
  const [q, setQ] = useState('');
  const shown = messages.filter((m) => !q || `${m.from_name} ${m.from_addr} ${m.subject}`.toLowerCase().includes(q.toLowerCase()));
  const notInDemo = useNotInDemo();
  return (
    <section className={`gms-list ${mailId ? 'has-open' : ''}`}>
      <div className="gl-tools">
        <button onClick={notInDemo}><Fa icon={faArrowPointer} /><span>{t('gms.select')}</span></button>
        <button onClick={notInDemo} className="dim"><Fa icon={faComments} /><span>{t('gms.threads')}</span></button>
        <button onClick={notInDemo}><Fa icon={faSliders} /><span>{t('gms.options')}</span></button>
        <span style={{ flex: 1 }} />
        <button onClick={() => void useGms.getState().load(folder)} {...ez('gms.refresh', t('gms.refresh'))}><Fa icon={faRotate} /><span>{t('gms.refresh')}</span></button>
      </div>
      <div className="gl-search">
        <Fa icon={faMagnifyingGlass} />
        <input placeholder={t('gms.search')} value={q} onChange={(e) => setQ(e.target.value)} {...ez('gms.search', t('gms.search'))} />
      </div>
      <div className="gl-rows" data-testid="gms-list">
        {!loaded && <div className="gl-empty">…</div>}
        {loaded && !shown.length && <div className="gl-empty">{t('gms.empty')}</div>}
        {shown.map((m) => {
          const who = folder === 'sent' || folder === 'drafts' ? m.to.map((x) => x.name).join(', ') || '—' : m.from_name;
          const addr = folder === 'sent' || folder === 'drafts' ? m.to[0]?.email ?? '' : m.from_addr;
          return (
            <button
              key={m.id}
              className={`gl-row ${m.read ? '' : 'unread'} ${String(m.id) === mailId ? 'on' : ''}`}
              onClick={() => navigate(folder === 'drafts' ? `/gms/compose?draft=${m.id}` : `/gms/${folder}/${m.id}`)}
              data-testid="gms-row"
              {...ez(`gms.message.${m.id}.open`, `${who}: ${m.subject}`)}
            >
              <span className="gl-avatar" style={{ color: tone(addr), background: `${tone(addr)}22` }}>{initials(who)}</span>
              <span className="gl-main">
                <span className="gl-top">
                  <span className="gl-from">{who}</span>
                  <span className="gl-date">{gmsDate(m.sent_at)}</span>
                </span>
                <span className="gl-subject">
                  <span className="gl-dot">{m.in_reply_to ? <Fa icon={faReply} /> : '•'}</span>
                  <Fa icon={faUser} /> {m.subject || t('gms.noSubject')}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="gl-foot">
        «&nbsp;&nbsp;‹ <span>{t('gms.messagesCount', { n: shown.length })}</span> <span className="gl-page">1</span> ›&nbsp;&nbsp;»
      </div>
    </section>
  );
}

function ReadToolbar({ m }: { m: MailFull | null }) {
  const t = useT();
  const navigate = useNavigate();
  const notInDemo = useNotInDemo();
  const del = async () => {
    if (!m) return;
    await api(`/api/mail/${m.id}`, { method: 'DELETE' }).catch(() => undefined);
    useGms.getState().closeMessage();
    void useGms.getState().load(m.folder);
    navigate(`/gms/${m.folder}`);
  };
  const tools: { id: string; icon: IconDefinition; label: I18nKey; act?: () => void; dim?: boolean }[] = [
    { id: 'reply', icon: faReply, label: 'gms.reply', act: () => m && navigate(`/gms/compose?reply=${m.id}`) },
    { id: 'reply-all', icon: faReplyAll, label: 'gms.replyAll', act: () => m && navigate(`/gms/compose?reply=${m.id}&all=1`) },
    { id: 'forward', icon: faShare, label: 'gms.forward', act: () => m && navigate(`/gms/compose?forward=${m.id}`) },
    { id: 'delete', icon: faTrashCan, label: 'gms.delete', act: () => void del() },
    { id: 'recall', icon: faRotateLeft, label: 'gms.recall', dim: true },
    { id: 'whats-new', icon: faStar, label: 'gms.whatsNew' },
    { id: 'junk', icon: faFire, label: 'gms.junk' },
    { id: 'mark', icon: faTag, label: 'gms.mark' },
    { id: 'more', icon: faEllipsis, label: 'gms.more' },
  ];
  return (
    <div className="gr-tools">
      {tools.map((x) => (
        <button
          key={x.id}
          className={x.dim || !m ? 'dim' : ''}
          disabled={!m && !!x.act}
          onClick={x.act ?? notInDemo}
          {...(x.act ? ez(`gms.read.${x.id}`, t(x.label)) : {})}
        >
          <Fa icon={x.icon} />
          <span>{t(x.label)}</span>
        </button>
      ))}
    </div>
  );
}

function ReadingPane() {
  const t = useT();
  const { folder = 'inbox', mailId } = useParams();
  const navigate = useNavigate();
  const opened = useGms((s) => s.opened);
  useEffect(() => {
    if (mailId) void useGms.getState().open(Number(mailId));
    else useGms.getState().closeMessage();
  }, [mailId]);
  const m = opened && String(opened.id) === mailId ? opened : null;
  return (
    <section className={`gms-read ${mailId ? 'has-open' : ''}`}>
      <ReadToolbar m={m} />
      {!m ? (
        <div className="gr-empty">
          <img src="/assets/tanzania-coat-of-arms.svg" alt="" />
        </div>
      ) : (
        <div className="gr-scroll" data-testid="gms-reading">
          <button className="gr-back" onClick={() => navigate(`/gms/${folder}`)}>
            ‹ {t('gms.back')}
          </button>
          <div className="gr-card">
            <h2 className="gr-subject" data-testid="gms-subject">{m.subject}</h2>
            <div className="gr-meta">
              <span className="gr-avatar"><Fa icon={faUser} /></span>
              <div>
                <div>
                  {folder === 'sent' ? t('gms.to') : t('gms.from')}{' '}
                  <span className="gr-link">{folder === 'sent' ? m.to.map((x) => x.email).join(', ') : `${m.from_name} <${m.from_addr}>`}</span> {t('gms.on')} {gmsDate(m.sent_at)}
                </div>
                {folder !== 'sent' && <div className="gr-to">{t('gms.to')}: {m.to.map((x) => x.email).join(', ')}{m.cc.length ? ` · Cc: ${m.cc.map((x) => x.email).join(', ')}` : ''}</div>}
              </div>
            </div>
          </div>
          <div className="gr-privacy">
            <Fa icon={faCircleExclamation} /> {t('gms.privacy')}
          </div>
          <div className="gr-text" data-testid="gms-body">{m.body}</div>
        </div>
      )}
    </section>
  );
}

export function GmsMailbox() {
  const { folder = 'inbox' } = useParams();
  useEffect(() => {
    void useGms.getState().load(folder);
    const onMail = () => void useGms.getState().load(useGms.getState().folder);
    window.addEventListener('nuru:mail', onMail);
    return () => window.removeEventListener('nuru:mail', onMail);
  }, [folder]);
  if (!FOLDERS.some((f) => f.id === folder)) return <Navigate to="/gms/inbox" replace />;
  return (
    <GmsFrame active="mail">
      <MessageList />
      <ReadingPane />
    </GmsFrame>
  );
}

// ---------------------------------------------------------------------------
// Compose

export function fullBody(body: string, signature: string, quote: string): string {
  return `${body.trimEnd()}\n\n${signature}${quote ? `\n\n${quote}` : ''}`;
}

function quoteOf(m: MailFull, lang: string): string {
  const head = lang === 'sw' ? '-------- Ujumbe wa awali --------' : '-------- Original Message --------';
  return [
    head,
    `${lang === 'sw' ? 'Kutoka' : 'From'}: ${m.from_name} <${m.from_addr}>`,
    `${lang === 'sw' ? 'Tarehe' : 'Date'}: ${gmsDate(m.sent_at)}`,
    `${lang === 'sw' ? 'Kichwa' : 'Subject'}: ${m.subject}`,
    '',
    m.body,
  ].join('\n');
}

export function GmsCompose() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useSession((s) => s.user);
  const directory = useSession((s) => s.directory);
  const c = useGms((s) => s.compose);
  const setC = useGms((s) => s.setCompose);
  const notInDemo = useNotInDemo();
  const saveTimer = useRef(0);
  const initKey = params.toString();
  const signature = user?.signature ?? '';

  // Initialise once per URL (reply / reply all / forward / draft / new)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!directory.length) void import('../esiri/session').then((m) => m.loadDirectory()).catch(() => undefined);
      const base = { ...emptyCompose, open: true };
      const reply = params.get('reply');
      const forward = params.get('forward');
      const draft = params.get('draft');
      if (reply || forward) {
        const m = await api<MailFull>(`/api/mail/${reply ?? forward}`).catch(() => null);
        if (cancelled) return;
        if (m) {
          const subj = m.subject.replace(/^(re|fwd?):\s*/i, '');
          if (reply) {
            const me = user?.email ?? '';
            const others = params.get('all') ? m.to.map((x) => x.email).filter((x) => x !== me && x !== m.from_addr) : [];
            useGms.setState({ compose: { ...base, to: [m.from_addr, ...others].join(', '), cc: params.get('all') ? m.cc.map((x) => x.email).filter((x) => x !== me).join(', ') : '', subject: `Re: ${subj}`, quote: quoteOf(m, lang), inReplyTo: m.id } });
          } else {
            useGms.setState({ compose: { ...base, subject: `Fwd: ${subj}`, quote: quoteOf(m, lang) } });
          }
          return;
        }
      }
      if (draft) {
        const m = await api<MailFull>(`/api/mail/${draft}`).catch(() => null);
        if (cancelled) return;
        if (m) {
          const at = signature ? m.body.indexOf(signature) : -1;
          const body = at >= 0 ? m.body.slice(0, at).trimEnd() : m.body;
          const quote = at >= 0 ? m.body.slice(at + signature.length).trim() : '';
          useGms.setState({ compose: { ...base, draftId: m.id, to: m.to.map((x) => x.email).join(', '), cc: m.cc.map((x) => x.email).join(', '), subject: m.subject, body, quote, inReplyTo: m.in_reply_to, saved: 'saved' } });
          return;
        }
      }
      useGms.setState({ compose: base });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  // Draft auto-save (never sends)
  const saveDraft = async (): Promise<number | null> => {
    const s = useGms.getState().compose;
    if (!s.open || s.sending) return s.draftId;
    if (!s.to.trim() && !s.subject.trim() && !s.body.trim()) return s.draftId;
    setC({ saved: 'saving' });
    const payload = { to: splitAddrs(s.to), cc: splitAddrs(s.cc), subject: s.subject, body: fullBody(s.body, signature, s.quote), in_reply_to: s.inReplyTo };
    try {
      if (s.draftId) {
        await api(`/api/mail/drafts/${s.draftId}`, { method: 'PATCH', body: payload });
        setC({ saved: 'saved' });
        return s.draftId;
      }
      const d = await api<{ id: number }>('/api/mail/drafts', { body: payload });
      setC({ draftId: d.id, saved: 'saved' });
      return d.id;
    } catch {
      setC({ saved: 'never' });
      return s.draftId;
    }
  };
  useEffect(() => {
    if (!c.open) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.to, c.cc, c.subject, c.body, c.open]);
  useEffect(() => () => useGms.getState().resetCompose(), []);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    window.clearTimeout(saveTimer.current);
    const s = useGms.getState().compose;
    setC({ sending: true, error: '' });
    try {
      const draftId = await saveDraft();
      await api('/api/mail/send', {
        body: { draft_id: draftId, to: splitAddrs(s.to), cc: splitAddrs(s.cc), subject: s.subject, body: fullBody(s.body, signature, s.quote), in_reply_to: s.inReplyTo },
      });
      useApp.getState().toast(t('gms.sentToast'));
      useGms.getState().resetCompose();
      navigate('/gms/sent');
    } catch (err) {
      const msg = err instanceof HttpError ? (lang === 'sw' ? err.messageSw : err.message) : String(err);
      setC({ sending: false, error: msg });
    }
  };

  const discard = async () => {
    const id = useGms.getState().compose.draftId;
    if (id) await api(`/api/mail/${id}`, { method: 'DELETE' }).catch(() => undefined);
    useGms.getState().resetCompose();
    navigate('/gms/inbox');
  };

  const people = useMemo(() => directory.filter((p) => p.email.endsWith('@mfano.go.tz')), [directory]);

  return (
    <GmsFrame active="compose">
      <section className="gms-compose" data-testid="gms-compose">
        <form className="gc-main" onSubmit={send}>
          <div className="gc-bar">
            <button type="submit" className="gc-send" disabled={c.sending} data-testid="gms-send" {...ez('gms.compose.send', t('gms.send'), { sensitive: true })}>
              <Fa icon={faPaperPlane} /> {c.sending ? t('gms.sending') : t('gms.send')}
            </button>
            <button type="button" className="gc-tool" onClick={() => void saveDraft()} data-testid="gms-save" {...ez('gms.compose.save', t('gms.save'))}>
              <Fa icon={faFloppyDisk} /> {t('gms.save')}
            </button>
            <button type="button" className="gc-tool" onClick={notInDemo}>
              <Fa icon={faPaperclip} /> {t('gms.attach')}
            </button>
            <span className="gc-status" data-testid="gms-draft-status">{c.saved === 'saving' ? t('gms.saving') : c.saved === 'saved' ? t('gms.savedDraft') : ''}</span>
            <button type="button" className="gc-tool" onClick={() => void discard()} {...ez('gms.compose.discard', t('gms.discard'))}>
              <Fa icon={faXmark} /> {t('gms.discard')}
            </button>
          </div>
          {c.error && (
            <div className="gc-error" role="alert" data-testid="gms-error">
              <Fa icon={faCircleExclamation} /> {c.error}
            </div>
          )}
          <div className="gc-field">
            <label>{t('gms.fromLabel')}</label>
            <input value={`${user?.display_name ?? ''} <${user?.email ?? ''}>`} readOnly aria-label={t('gms.fromLabel')} />
          </div>
          <div className="gc-field">
            <label htmlFor="gc-to">{t('gms.to')}</label>
            <input id="gc-to" list="gms-directory" value={c.to} onChange={(e) => setC({ to: e.target.value })} autoComplete="off" data-testid="gms-to" {...ez('gms.compose.to', t('gms.to'))} />
          </div>
          <div className="gc-field">
            <label htmlFor="gc-cc">Cc</label>
            <input id="gc-cc" list="gms-directory" value={c.cc} onChange={(e) => setC({ cc: e.target.value })} autoComplete="off" {...ez('gms.compose.cc', 'Cc')} />
          </div>
          <datalist id="gms-directory">
            {people.map((p) => (
              <option key={p.email} value={p.email}>
                {p.display_name}
              </option>
            ))}
          </datalist>
          <div className="gc-field">
            <label htmlFor="gc-subject">{t('gms.subject')}</label>
            <input id="gc-subject" value={c.subject} onChange={(e) => setC({ subject: e.target.value })} data-testid="gms-subject-input" {...ez('gms.compose.subject', t('gms.subject'))} />
          </div>
          <div className="gc-editor">
            <div className="gc-format" aria-hidden="true">
              {[faBold, faItalic, faUnderline, faListUl, faLink].map((ic, i) => (
                <span key={i}>
                  <Fa icon={ic} />
                </span>
              ))}
              <span className="gc-font">Inter · 14</span>
            </div>
            <textarea
              className="gc-text"
              value={c.body}
              onChange={(e) => setC({ body: e.target.value })}
              placeholder={t('gms.bodyPlaceholder')}
              data-testid="gms-body-input"
              {...ez('gms.compose.body', t('gms.bodyLabel'))}
            />
            <div className="gc-signature" data-testid="gms-signature">{signature}</div>
            {c.quote && <div className="gc-quote">{c.quote}</div>}
          </div>
        </form>
        <aside className="gc-options" aria-label={t('gms.options')}>
          <div className="gco-title">{t('gms.options')}</div>
          {(['gms.optPriority', 'gms.optReceipt', 'gms.optDsn', 'gms.optSaveSent'] as I18nKey[]).map((k, i) => (
            <label key={k} className="gco-row">
              <span>{t(k)}</span>
              {i === 0 ? (
                <select defaultValue="normal" onChange={notInDemo}>
                  <option value="normal">{t('gms.normal')}</option>
                </select>
              ) : (
                <input type="checkbox" defaultChecked={i === 3} onChange={notInDemo} />
              )}
            </label>
          ))}
          <div className="gco-note">
            <Fa icon={faLock} /> {t('gms.internalOnly')}
          </div>
        </aside>
      </section>
    </GmsFrame>
  );
}

// ---------------------------------------------------------------------------
// Login (skipped when signed in to NURU — single sign-on)

export function GmsLogin() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const status = useSession((s) => s.status);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const next = new URLSearchParams(location.search).get('next') || '/gms/inbox';
  if (status === 'authed') return <Navigate to={next.startsWith('/gms') ? next : '/gms/inbox'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const user = await login(u.trim(), p);
      const language = useApp.getState().language;
      if (user.language !== language) void patchMe({ language });
      navigate(next, { replace: true });
    } catch {
      setErr(t('login.invalid'));
    }
  };
  return (
    <div className="gms-login" data-testid="gms-login">
      <div className="gml-left">
        <div className="gml-brand">
          <img src="/assets/tanzania-coat-of-arms.svg" alt="" />
          <div>
            <b>Government Mailing System</b>
            <span>e-Government Authority</span>
          </div>
        </div>
        <div className="gml-art">
          <img src="/assets/tanzania-coat-of-arms.svg" alt="" />
          <p>{t('gms.loginArt')}</p>
        </div>
        <div className="gml-foot">ISO/IEC 27001:2022 · ISO 9001:2015 · {t('gms.secured')}</div>
      </div>
      <div className="gml-right">
        <form className="gml-card" onSubmit={submit}>
          <div className="gml-card-head">
            <img src="/assets/tanzania-coat-of-arms.svg" alt="" />
            <div>
              <small>THE UNITED REPUBLIC OF TANZANIA</small>
              <b>Government Mailing System</b>
            </div>
          </div>
          <div className="gml-label">LOGIN</div>
          <label>
            {t('login.username')}
            <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" data-testid="gms-login-user" />
          </label>
          <label>
            {t('login.password')}
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" data-testid="gms-login-pass" />
          </label>
          {err && <div className="gc-error">{err}</div>}
          <button type="submit" className="gml-btn" data-testid="gms-login-submit">LOGIN</button>
          <p className="gml-sso">{t('gms.ssoHint')}</p>
        </form>
        <div className="gml-copy">© 2014 – 2026 | e-Government Authority (demo) | v5.25.0</div>
      </div>
    </div>
  );
}
