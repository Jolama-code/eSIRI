import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle, ArrowRightLeft, Check, CheckCircle2, ChevronsRight, Globe, Keyboard, Loader2, Mic, MicOff, MousePointerClick,
  Navigation, Radio, RotateCcw, Send, ShieldAlert, Square, ToggleRight, Type, X, XCircle,
} from 'lucide-react';
import { useT } from '../../i18n';
import { useApp } from '../../store/appStore';
import { useEsiri, type Msg, type StepIcon } from '../esiriStore';
import { activate, answerConfirmation, cancel, isBusy, newConversation, submit } from '../controller';
import { Orb } from './Orb';
import { orbStateFor } from './orbState';

const STEP_ICONS: Record<StepIcon, JSX.Element> = {
  click: <MousePointerClick size={14} />,
  type: <Type size={14} />,
  tab: <ArrowRightLeft size={14} />,
  toggle: <ToggleRight size={14} />,
  navigate: <Navigation size={14} />,
  language: <Globe size={14} />,
  blocked: <ShieldAlert size={14} />,
};

function MessageView({ m }: { m: Msg }) {
  const t = useT();
  switch (m.kind) {
    case 'user':
      return (
        <div className="pm pm-user">
          <div className="bubble bubble-user">
            <span className="bubble-mode" title={m.mode === 'voice' ? t('esiri.inputVoice') : t('esiri.inputText')}>
              {m.mode === 'voice' ? <Mic size={12} /> : <Keyboard size={12} />}
            </span>
            {m.text}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="pm pm-assistant">
          <Orb size={22} state="idle" className="bubble-orb" />
          <div className="bubble bubble-assistant" data-testid="esiri-reply">
            {m.text}
          </div>
        </div>
      );
    case 'step':
      return (
        <div className={`pm-step ${m.status}`} data-testid="esiri-step">
          <span className="step-icon">{STEP_ICONS[m.icon]}</span>
          <span className="step-text">→ {m.text}</span>
          <span className="step-status">
            {m.status === 'pending' ? <Loader2 size={13} className="spin" /> : m.status === 'ok' ? <Check size={14} /> : <X size={14} />}
          </span>
        </div>
      );
    case 'confirm':
      return (
        <div className={`confirm-card ${m.state}`} data-testid="esiri-confirm-card">
          <div className="confirm-head">
            <ShieldAlert size={16} />
            <span>{m.summary}</span>
          </div>
          {m.state === 'pending' ? (
            <div className="confirm-actions">
              <button className="btn btn-primary btn-sm" onClick={() => answerConfirmation(true)} data-testid="esiri-confirm-yes">
                <Check size={14} /> {t('esiri.yes')}
              </button>
              <button className="btn btn-neutral btn-sm" onClick={() => answerConfirmation(false)} data-testid="esiri-confirm-no">
                <X size={14} /> {t('esiri.no')}
              </button>
            </div>
          ) : (
            <div className={`confirm-result ${m.state}`}>
              {m.state === 'approved' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {m.state === 'approved' ? t('esiri.approved') : t('esiri.declined')}
            </div>
          )}
        </div>
      );
    case 'notice':
      return (
        <div className={`pm-notice ${m.tone}`}>
          <AlertTriangle size={14} /> <span>{m.text}</span>
        </div>
      );
  }
}

export function Panel() {
  const t = useT();
  const open = useEsiri((s) => s.panelOpen);
  const status = useEsiri((s) => s.status);
  const micOpen = useEsiri((s) => s.micOpen);
  const interim = useEsiri((s) => s.interim);
  const messages = useEsiri((s) => s.messages);
  const health = useEsiri((s) => s.health);
  const wakeRunning = useEsiri((s) => s.wakeRunning);
  const errorFlash = useEsiri((s) => s.errorFlash);
  const setPanelOpen = useEsiri((s) => s.setPanelOpen);
  const language = useApp((s) => s.language);
  const setLanguage = useApp((s) => s.setLanguage);
  const wakeMode = useApp((s) => s.wakeMode);
  const setWakeMode = useApp((s) => s.setWakeMode);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, interim]);

  useEffect(() => {
    if (!errorFlash) return;
    setNow(Date.now());
    const id = window.setTimeout(() => setNow(Date.now()), 1300);
    return () => window.clearTimeout(id);
  }, [errorFlash]);

  const busy = isBusy() && status !== 'awaiting_confirmation';
  const working = status === 'thinking' || status === 'acting' || status === 'speaking' || status === 'awaiting_confirmation' || status === 'awaiting_answer';
  const orbState = orbStateFor(status, micOpen, now - errorFlash < 1200);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    setText('');
    void submit(v, 'text');
  };

  const suggestions = [t('esiri.suggest1'), t('esiri.suggest2'), t('esiri.suggest3'), t('esiri.suggest4')];

  return (
    <aside className={`esiri-panel ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="eSiri">
      <header className="ep-head">
        <Orb size={30} state={orbState} />
        <div className="ep-title">
          <span className="ep-name">{t('esiri.name')}</span>
          <span className="ep-status">
            <span className={`status-dot s-${status}`} />
            {micOpen && status !== 'listening' ? t('esiri.status.listening') : t(`esiri.status.${status}`)}
            <span className="sr-only" data-testid="esiri-status">
              {status}
            </span>
          </span>
        </div>
        <button
          className="lang-chip"
          onClick={() => setLanguage(language === 'en' ? 'sw' : 'en')}
          title={t('esiri.language')}
          data-testid="esiri-lang-chip"
        >
          <span className={language === 'en' ? 'on' : ''}>EN</span>
          <span className={language === 'sw' ? 'on' : ''}>SW</span>
        </button>
        <button className="ep-icon" onClick={newConversation} title="New conversation" aria-label="New conversation">
          <RotateCcw size={16} />
        </button>
        <button className="ep-icon" onClick={() => setPanelOpen(false)} title={t('esiri.close')} aria-label={t('esiri.close')} data-testid="esiri-close">
          <ChevronsRight size={18} />
        </button>
      </header>

      <label className="wake-row">
        <span className={`wake-switch ${wakeMode ? 'on' : ''}`}>
          <input type="checkbox" checked={wakeMode} onChange={(e) => setWakeMode(e.target.checked)} data-testid="esiri-wake-toggle" />
          <span className="knob" />
        </span>
        <span className="wake-label">{t('esiri.wakeMode')}</span>
        {wakeRunning && (
          <span className="wake-indicator" title={t('esiri.wakeOn')}>
            <Radio size={13} /> {t('esiri.wakeOn')}
          </span>
        )}
      </label>

      {health && !health.reachable && <div className="ep-banner">{t('esiri.backendDown')}</div>}
      {health && health.reachable && !health.has_key && <div className="ep-banner" data-testid="esiri-nokey">{t('esiri.noKey')}</div>}

      <div className="ep-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="ep-empty">
            <Orb size={84} state={orbState} />
            <p className="ep-greeting">{t('esiri.greeting')}</p>
            <div className="chips-col">
              {suggestions.map((s) => (
                <button key={s} className="suggest-chip" onClick={() => void submit(s, 'text')} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} m={m} />
        ))}
        {interim && (
          <div className="pm pm-user">
            <div className="bubble bubble-user interim" data-testid="esiri-interim">
              <em>{interim}</em>
            </div>
          </div>
        )}
      </div>

      <form className="ep-foot" onSubmit={send}>
        <input
          ref={inputRef}
          className="ep-input"
          placeholder={t('esiri.inputPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="esiri-input"
          aria-label={t('esiri.inputPlaceholder')}
        />
        <button
          type="button"
          className={`ep-round ${micOpen ? 'live' : ''}`}
          onClick={() => activate()}
          title={micOpen ? t('esiri.stopListening') : t('esiri.mic')}
          aria-label={micOpen ? t('esiri.stopListening') : t('esiri.mic')}
          disabled={busy}
          data-testid="esiri-mic"
        >
          {micOpen ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {working ? (
          <button type="button" className="ep-round stop" onClick={cancel} title={t('esiri.stop')} aria-label={t('esiri.stop')} data-testid="esiri-stop">
            <Square size={15} fill="currentColor" />
          </button>
        ) : null}
        <button type="submit" className="ep-round send" disabled={!text.trim() || busy} title={t('esiri.send')} aria-label={t('esiri.send')} data-testid="esiri-send">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}
