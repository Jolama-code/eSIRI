import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  faBell, faCheck, faClock, faEnvelope, faFileLines, faListCheck, faMicrophone, faPaperPlane, faPlay, faTrashCan,
  faTriangleExclamation, faUserTie, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { useT, useLang, type I18nKey } from '../../i18n';
import { useNuru, type ReminderCard } from '../nuruStore';
import { useEsiri } from '../esiriStore';
import { orbStateFor } from './orbState';
import { Orb } from './Orb';
import { Fa, IconShape, spokenClock } from '../../hub/ui';
import {
  answerYesNo, completeUnlock, dismissReminder, handleReminderAnswer, openReminderTarget, snoozeReminder, startMeetingFromReminder,
} from '../proactive';
import {
  answerBriefing, closeBriefing, declineBriefing, editBriefingItem, listenAgain, mergedPlan, removeBriefingItem, saveBriefing, submitTranscript,
} from '../briefing';
import { api, useSession } from '../session';
import { useApp } from '../../store/appStore';
import { useHub } from '../../hub/hubStore';
import { isMuted } from '../tts';
import { newConversation } from '../controller';
import './overlays.css';

function useOrb() {
  const status = useEsiri((s) => s.status);
  const micOpen = useEsiri((s) => s.micOpen);
  return orbStateFor(status, micOpen, false);
}

// ---------------------------------------------------------------------------
// Reminder cards (top of the screen)

function ReminderView({ r }: { r: ReminderCard }) {
  const t = useT();
  const lang = useLang();
  const orb = useOrb();
  const [text, setText] = useState('');
  const isMeeting = r.kind === 'meeting';
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void handleReminderAnswer(r.id, text, 'text');
    setText('');
  };
  return (
    <div className={`rem-card ${r.state}`} role="alertdialog" aria-label={t('reminder.title')} data-testid="reminder-card" data-reminder-id={r.id}>
      <div className="rem-orb">
        <Orb size={58} state={orb} />
      </div>
      <div className="rem-body">
        <div className="rem-kicker">
          <Fa icon={faBell} /> {t('reminder.title')}
        </div>
        <div className="rem-msg" data-testid="reminder-message">{lang === 'sw' ? r.message_sw : r.message_en}</div>
        <div className="rem-actions">
          {isMeeting ? (
            <button className="hbtn" onClick={() => void startMeetingFromReminder(r.id, { moderator: true, mute: true })} data-testid="reminder-moderate">
              <Fa icon={faUserTie} /> {t('reminder.startModerator')}
            </button>
          ) : (
            <button className="hbtn" onClick={() => void openReminderTarget(r.id)} data-testid="reminder-open">
              <Fa icon={r.kind === 'task' ? faListCheck : faPlay} /> {t(r.kind === 'task' ? 'reminder.openTask' : 'reminder.openDay')}
            </button>
          )}
          <button className="hbtn ghost" onClick={() => void snoozeReminder(r.id)} data-testid="reminder-snooze">
            <Fa icon={faClock} /> {t('reminder.later')}
          </button>
          <button className="hbtn ghost" onClick={() => void dismissReminder(r.id)} data-testid="reminder-ok">
            <Fa icon={faCheck} /> {t('reminder.ok')}
          </button>
        </div>
        <form className="rem-answer" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('reminder.answerPlaceholder')} data-testid="reminder-input" aria-label={t('reminder.answerPlaceholder')} />
          <button className="hbtn icon royal" type="submit" aria-label={t('esiri.send')} data-testid="reminder-send">
            <Fa icon={faPaperPlane} />
          </button>
        </form>
      </div>
    </div>
  );
}

function MinutesOffer() {
  const t = useT();
  const offer = useNuru((s) => s.minutesOffer);
  const orb = useOrb();
  if (!offer) return null;
  return (
    <div className="rem-card" role="alertdialog" data-testid="minutes-offer">
      <div className="rem-orb">
        <Orb size={58} state={orb} />
      </div>
      <div className="rem-body">
        <div className="rem-kicker">
          <Fa icon={faFileLines} /> KatibuAI · {offer.title}
        </div>
        <div className="rem-msg">{offer.question ?? t('minutes.offer')}</div>
        <div className="rem-actions">
          <button className="hbtn" onClick={() => answerYesNo(true)} data-testid="minutes-offer-yes">
            <Fa icon={faCheck} /> {offer.yesLabel ?? t('minutes.offerYes')}
          </button>
          <button className="hbtn ghost" onClick={() => answerYesNo(false)} data-testid="minutes-offer-no">
            <Fa icon={faXmark} /> {t('esiri.no')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReminderStack() {
  const reminders = useNuru((s) => s.reminders);
  const offer = useNuru((s) => s.minutesOffer);
  if (!reminders.length && !offer) return null;
  return (
    <div className="rem-stack">
      {reminders.map((r) => (
        <ReminderView key={r.id} r={r} />
      ))}
      <MinutesOffer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event toasts

export function EventToasts() {
  const toasts = useNuru((s) => s.toasts);
  const dismiss = useNuru((s) => s.dismissToast);
  const navigate = useNavigate();
  const icon = (k: string) => (k === 'mail' ? faEnvelope : k === 'task' ? faListCheck : k === 'katibu_failed' ? faTriangleExclamation : faFileLines);
  return (
    <div className="ev-toasts" aria-live="polite">
      {toasts.map((x) => (
        <div
          className="ev-toast"
          key={x.id}
          data-testid="event-toast"
          onClick={() => {
            if (x.link) navigate(x.link);
            dismiss(x.id);
          }}
        >
          <IconShape icon={icon(x.kind)} tone={x.kind === 'katibu_failed' ? 'red' : 'royal'} size={36} />
          <div className="ev-text">
            <div className="ev-title">{x.title}</div>
            <div className="ev-body">{x.body}</div>
          </div>
          <button
            className="ev-x"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(x.id);
            }}
            aria-label="×"
          >
            <Fa icon={faXmark} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Gusa ili kuanza" (first use / audio locked)

export function UnlockOverlay() {
  const t = useT();
  const needed = useNuru((s) => s.unlockNeeded);
  const signedIn = useSession((s) => s.status === 'authed');
  const [busy, setBusy] = useState(false);
  if (!needed || !signedIn) return null;
  return (
    <div className="unlock" data-testid="unlock-overlay">
      <img className="unlock-bg" src="/brand/circuit-header.png" alt="" aria-hidden="true" />
      <div className="unlock-inner">
        <Orb size={180} state="idle" />
        <h1>{t('unlock.title')}</h1>
        <p>{t('unlock.text')}</p>
        <button
          className="unlock-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await completeUnlock();
            setBusy(false);
          }}
          data-testid="unlock-start"
        >
          {t('unlock.button')}
        </button>
        <div className="unlock-note">{t('unlock.note')}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Morning briefing sheet

/** 24-hour HH:MM text field (a browser time input shows 12-hour times and can cut off AM/PM). */
function TimeField({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) onCommit(`${m[1].padStart(2, '0')}:${m[2]}`);
    else setText(value);
  };
  return (
    <input
      className="brief-time t-num"
      inputMode="numeric"
      maxLength={5}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      aria-label={label}
    />
  );
}

export function BriefingSheet() {
  const t = useT();
  const lang = useLang();
  const b = useNuru((s) => s.briefing);
  const orb = useOrb();
  const [text, setText] = useState('');
  useEffect(() => {
    if (b.stage === 'closed') setText('');
  }, [b.stage]);
  if (b.stage === 'closed') return null;
  const rows = mergedPlan(b.items, b.existing);
  const reviewing = b.stage === 'review' || b.stage === 'confirm' || b.stage === 'saving' || b.stage === 'done';

  const send = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    if (reviewing) {
      if (!answerBriefing(v)) void submitTranscript(`${b.transcript}. ${v}`);
    } else void submitTranscript(v);
  };

  return (
    <div className="brief-backdrop" data-testid="briefing">
      <div className="brief-sheet" role="dialog" aria-label={t('briefing.title')}>
        <header className="brief-head">
          <Orb size={54} state={orb} />
          <div className="brief-titles">
            <div className="t-label" style={{ color: 'rgba(255,255,255,.75)' }}>{t('briefing.kicker')}</div>
            <h2>{t('briefing.title')}</h2>
          </div>
          <button className="brief-x" onClick={closeBriefing} aria-label={t('esiri.close')} data-testid="briefing-close">
            <Fa icon={faXmark} />
          </button>
        </header>
        <div className="flag-stripe-v2" />
        <div className="brief-body">
          {(b.stage === 'greeting' || b.stage === 'listening') && (
            <div className="brief-listen">
              <p className="brief-prompt">{t('briefing.greeting', { name: useSession.getState().user?.first_name ?? '' })}</p>
              <div className={`brief-live ${b.interim ? 'has' : ''}`} data-testid="briefing-live">
                {b.interim || (isMuted() ? t('briefing.typeHint') : t('briefing.listeningHint'))}
              </div>
            </div>
          )}
          {b.stage === 'parsing' && (
            <div className="brief-listen">
              <div className="brief-live has">“{b.transcript}”</div>
              <div className="brief-working">
                <span className="skeleton" style={{ height: 14, width: '70%' }} />
                <span className="skeleton" style={{ height: 14, width: '55%' }} />
                <span className="skeleton" style={{ height: 14, width: '62%' }} />
              </div>
              <p className="t-small">{t('briefing.parsing')}</p>
            </div>
          )}
          {b.stage === 'error' && <div className="login-error">{b.error || t('briefing.parseFailed')}</div>}
          {reviewing && (
            <>
              <div className="brief-sub">
                <span className="t-label">{t('briefing.proposed')}</span>
                <span className="t-small">“{b.transcript}”</span>
              </div>
              <div className="brief-list" data-testid="briefing-plan">
                {rows.map((r, i) => (
                  <div
                    key={r.key}
                    className={`brief-row rise ${r.isNew ? 'new' : 'old'} ${r.conflict ? 'conflict' : ''}`}
                    style={{ ['--i' as string]: i }}
                    data-testid={r.isNew ? 'briefing-item' : 'briefing-existing'}
                  >
                    {r.isNew ? (
                      <TimeField value={r.start} onCommit={(v) => editBriefingItem(r.index, { start: v })} label={t('briefing.time')} />
                    ) : (
                      <span className="brief-time static t-num">{r.start}</span>
                    )}
                    <div className="brief-main">
                      {r.isNew ? (
                        <input className="brief-title" value={r.title} onChange={(e) => editBriefingItem(r.index, { title: e.target.value })} aria-label={t('briefing.itemTitle')} />
                      ) : (
                        <span className="brief-title static">{r.title}</span>
                      )}
                      <div className="brief-tags">
                        <span className="chip">{t(`kind.${r.kind}` as I18nKey)}</span>
                        {r.isNew ? <span className="chip new">{t('briefing.new')}</span> : <span className="chip">{t('briefing.already')}</span>}
                        {r.conflict && <span className="chip conflict-chip">{t('briefing.conflict')}</span>}
                      </div>
                    </div>
                    {r.isNew && (
                      <button className="hbtn icon ghost" onClick={() => removeBriefingItem(r.index)} aria-label={t('today.delete')} title={t('today.delete')}>
                        <Fa icon={faTrashCan} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {b.questions.length > 0 && (
                <div className="brief-questions">
                  {b.questions.map((q) => (
                    <div key={q} className="source-note">
                      <Fa icon={faTriangleExclamation} /> {q}
                    </div>
                  ))}
                </div>
              )}
              {b.stage === 'done' ? (
                <div className="brief-done" data-testid="briefing-done">
                  <IconShape icon={faCheck} tone="green" size={34} /> {t('briefing.saved')}
                </div>
              ) : (
                <div className="brief-confirm">
                  <span className="brief-ask">
                    {b.items[0] ? `${t('briefing.first', { title: [...b.items].sort((x, y) => x.start.localeCompare(y.start))[0].title, time: spokenClock([...b.items].sort((x, y) => x.start.localeCompare(y.start))[0].start, lang) })} ` : ''}
                    {t('briefing.ask')}
                  </span>
                  <div className="rem-actions">
                    <button className="hbtn" onClick={() => void saveBriefing()} disabled={b.stage === 'saving' || !b.items.length} data-testid="briefing-save">
                      <Fa icon={faCheck} /> {t('briefing.save')}
                    </button>
                    <button className="hbtn ghost" onClick={declineBriefing} data-testid="briefing-decline">
                      <Fa icon={faXmark} /> {t('briefing.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {b.stage !== 'done' && b.stage !== 'saving' && (
          <form className="brief-input" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={reviewing ? t('briefing.answerPlaceholder') : t('briefing.inputPlaceholder')}
              data-testid="briefing-input"
              aria-label={t('briefing.inputPlaceholder')}
            />
            {!isMuted() && (
              <button type="button" className="hbtn icon ghost" onClick={listenAgain} aria-label={t('esiri.mic')} title={t('esiri.mic')}>
                <Fa icon={faMicrophone} />
              </button>
            )}
            <button type="submit" className="hbtn icon royal" aria-label={t('esiri.send')} data-testid="briefing-send">
              <Fa icon={faPaperPlane} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo controls (Ctrl+Shift+D, or tap the Hub logo 5 times)

interface KatibuStatus {
  configured: boolean;
  signed_in: boolean;
  last_error: string;
  base_url: string;
}

export function DemoPanel() {
  const t = useT();
  const open = useNuru((s) => s.demoOpen);
  const setOpen = useNuru((s) => s.setDemoOpen);
  const user = useSession((s) => s.user);
  const [note, setNote] = useState('');
  const [katibu, setKatibu] = useState<KatibuStatus | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) {
        e.preventDefault();
        useNuru.getState().setDemoOpen(!useNuru.getState().demoOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    setNote('');
    setKatibu(null);
    void api<KatibuStatus>('/api/katibu/status').then(setKatibu).catch(() => setKatibu({ configured: false, signed_in: false, last_error: 'unreachable', base_url: '' }));
  }, [open, user]);

  if (!open) return null;
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setNote('…');
    try {
      await fn();
      setNote(`✓ ${label}`);
    } catch (e) {
      setNote(`✗ ${(e as Error).message}`);
    }
  };
  const source = user?.meeting_audio_source ?? 'live';

  return (
    <div className="demo-backdrop" onClick={() => setOpen(false)}>
      <div className="demo-panel" onClick={(e) => e.stopPropagation()} data-testid="demo-panel" role="dialog" aria-label={t('demo.title')}>
        <header>
          <h2>{t('demo.title')}</h2>
          <button className="brief-x dark" onClick={() => setOpen(false)} aria-label={t('esiri.close')}>
            <Fa icon={faXmark} />
          </button>
        </header>
        {!user ? (
          <p className="t-small">{t('demo.signInFirst')}</p>
        ) : (
          <div className="demo-grid">
            <button className="hbtn" data-testid="demo-meeting-soon" onClick={() => void run(t('demo.meetingSoon'), async () => { setOpen(false); await api('/api/demo/meeting-soon', { body: { minutes: 2 } }); })}>
              {t('demo.meetingSoon')}
            </button>
            <button className="hbtn" data-testid="demo-fire-reminder" onClick={() => void run(t('demo.fireNext'), async () => { setOpen(false); await api('/api/demo/fire-next-reminder', { method: 'POST' }); })}>
              {t('demo.fireNext')}
            </button>
            <button
              className="hbtn"
              data-testid="demo-briefing"
              onClick={() =>
                void run(t('demo.briefing'), async () => {
                  setOpen(false);
                  await api('/api/demo/briefing-prompt', { method: 'POST' });
                })
              }
            >
              {t('demo.briefing')}
            </button>
            <button
              className="hbtn danger"
              data-testid="demo-reset"
              onClick={() => {
                if (!window.confirm(t('demo.resetConfirm'))) return;
                void run(t('demo.reset'), async () => {
                  await api('/api/demo/reset', { method: 'POST' });
                  newConversation();
                  useApp.getState().resetDemo();
                  useHub.getState().reset();
                  void useHub.getState().loadAll();
                });
              }}
            >
              {t('demo.reset')}
            </button>
            <div className="demo-row">
              <span>{t('settings.audioSource')}</span>
              <div className="seg">
                {(['live', 'sample'] as const).map((v) => (
                  <button
                    key={v}
                    className={source === v ? 'on' : ''}
                    onClick={() => void import('../session').then((m) => m.patchMe({ meeting_audio_source: v }))}
                    data-testid={`demo-audio-${v}`}
                  >
                    {t(v === 'live' ? 'settings.audioLive' : 'settings.audioSample')}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-row" data-testid="demo-katibu">
              <span>KatibuAI</span>
              {katibu === null ? (
                <span className="chip">…</span>
              ) : katibu.signed_in ? (
                <span className="chip green">{t('demo.katibuOk')}</span>
              ) : (
                <span className="chip red">{t('demo.katibuDown')}</span>
              )}
            </div>
            {katibu && (katibu.last_error || katibu.base_url) && <div className="t-small">{katibu.base_url} {katibu.last_error && `· ${katibu.last_error}`}</div>}
          </div>
        )}
        {note && <div className="demo-note" data-testid="demo-note">{note}</div>}
      </div>
    </div>
  );
}
