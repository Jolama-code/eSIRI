import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../../i18n';
import { useApp } from '../../store/appStore';
import { useEsiri } from '../esiriStore';
import { activate, cancel, submit } from '../controller';
import { fetchHealth } from '../api';
import { initTTS, setEnglishTTS } from '../tts';
import { startWake, stopWake, sttSupported } from '../stt';
import { pageFromPath } from '../nav';
import { Orb } from './Orb';
import { Panel } from './Panel';
import { orbStateFor } from './orbState';
import '../esiri.css';

export function EsiriRoot() {
  const t = useT();
  const location = useLocation();
  const status = useEsiri((s) => s.status);
  const micOpen = useEsiri((s) => s.micOpen);
  const interim = useEsiri((s) => s.interim);
  const panelOpen = useEsiri((s) => s.panelOpen);
  const errorFlash = useEsiri((s) => s.errorFlash);
  const wakeMode = useApp((s) => s.wakeMode);
  const language = useApp((s) => s.language);
  const hasMessages = useEsiri((s) => s.messages.length > 0);
  const [, force] = useState(0);

  // Health check (API key, English TTS mode)
  useEffect(() => {
    initTTS();
    document.documentElement.lang = useApp.getState().language;
    void fetchHealth().then((h) => {
      useEsiri.getState().setHealth(h);
      setEnglishTTS(h.english_tts);
    });
  }, []);

  // Keyboard: Alt+S activates, Esc cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        activate();
        return;
      }
      if (e.key === 'Escape') {
        const s = useEsiri.getState();
        if (s.status !== 'idle' || s.micOpen) {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancel();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Let modals know when Esc belongs to eSiri.
  useEffect(() => {
    document.body.dataset.esiriBusy = status !== 'idle' || micOpen ? '1' : '0';
  }, [status, micOpen]);

  // Error tint lasts ~1.2 s
  useEffect(() => {
    if (!errorFlash) return;
    const id = window.setTimeout(() => force((n) => n + 1), 1250);
    return () => window.clearTimeout(id);
  }, [errorFlash]);

  // Wake-word mode: listen in the background only while idle.
  useEffect(() => {
    const es = useEsiri.getState();
    if (!wakeMode || !sttSupported()) {
      stopWake();
      es.setWakeRunning(false);
      return;
    }
    if (status !== 'idle' || micOpen) {
      stopWake();
      es.setWakeRunning(false);
      return;
    }
    const ok = startWake(
      language,
      (command) => {
        useEsiri.getState().setWakeRunning(false);
        useEsiri.getState().setPanelOpen(true);
        if (command) void submit(command, 'voice');
        else activate();
      },
      () => {
        useEsiri.getState().setWakeRunning(false);
        useApp.getState().setWakeMode(false);
        useEsiri.getState().addMsg({ kind: 'notice', text: t('esiri.sttNetwork'), tone: 'error' });
      },
    );
    es.setWakeRunning(ok);
    return () => {
      stopWake();
      useEsiri.getState().setWakeRunning(false);
    };
  }, [wakeMode, status, micOpen, language]);

  const error = Date.now() - errorFlash < 1200;
  const orbState = orbStateFor(status, micOpen, error);
  const active = status !== 'idle' || micOpen;
  const onMeeting = pageFromPath(location.pathname) === 'meeting';
  const caption = interim || (micOpen ? t('esiri.status.listening') : t(`esiri.status.${status}`));

  return (
    <>
      <div className={`esiri-stage ${active ? 'show' : ''} ${onMeeting ? 'raised' : ''}`} aria-live="polite">
        <button className="stage-orb-btn" onClick={() => activate()} aria-label={t('esiri.orbTooltip')} tabIndex={active ? 0 : -1}>
          <Orb size={120} state={orbState} />
        </button>
        <div className="stage-caption">{caption}</div>
      </div>

      <button
        className={`orb-fab ${active ? 'dim' : ''} ${onMeeting ? 'on-meeting' : ''}`}
        onClick={() => activate()}
        aria-label={t('esiri.orbTooltip')}
        data-testid="esiri-orb"
      >
        <Orb size={64} state={active ? orbState : 'idle'} />
        <span className="orb-tooltip">{t('esiri.orbTooltip')}</span>
      </button>

      {!panelOpen && hasMessages && (
        <button className="panel-tab" onClick={() => useEsiri.getState().setPanelOpen(true)}>
          NURU
        </button>
      )}
      <Panel />
    </>
  );
}
