import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { faCircleQuestion, faUniversalAccess, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useT } from '../../i18n';
import { useApp } from '../../store/appStore';
import { useEsiri } from '../esiriStore';
import { activate, cancel, submit } from '../controller';
import { fetchHealth } from '../api';
import { initTTS, isMuted, setEnglishTTS } from '../tts';
import { startWake, stopWake, sttSupported } from '../stt';
import { pageFromPath, systemFromPath, type SystemName } from '../nav';
import { patchMe, refreshMe, useSession } from '../session';
import { onSignedIn, shouldShowUnlock, stopProactive } from '../proactive';
import { briefingSeenToday, startBriefing } from '../briefing';
import { useNuru } from '../nuruStore';
import { useHub } from '../../hub/hubStore';
import { Fa } from '../../hub/ui';
import { Orb } from './Orb';
import { Panel } from './Panel';
import { orbStateFor } from './orbState';
import { BriefingSheet, DemoPanel, EventToasts, ReminderStack, UnlockOverlay } from './NuruOverlays';
import '../esiri.css';

/** "Habari! Mimi ni Nuru. Nikusaidie?" beside the orb, once per session per system. */
function useGreetingBubble(system: SystemName): [boolean, () => void] {
  const key = `nuru-bubble-${system}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      const forced = new URLSearchParams(window.location.search).get('bubble') === '1';
      seen = !forced && (isMuted() || sessionStorage.getItem(key) === '1');
      if (!seen) sessionStorage.setItem(key, '1');
    } catch {
      seen = true;
    }
    if (seen) {
      setShow(false);
      return;
    }
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 8000);
    return () => window.clearTimeout(id);
  }, [key]);
  return [show, () => setShow(false)];
}

function FloatingStack({ system, orbState, active }: { system: SystemName; orbState: ReturnType<typeof orbStateFor>; active: boolean }) {
  const t = useT();
  const [bubble, hideBubble] = useGreetingBubble(system);
  const notInDemo = () => useApp.getState().toast(t('stack.notInDemo'));
  return (
    <div className="nuru-stack" data-testid="nuru-stack">
      <div className="stack-item">
        <button
          className={`stack-btn stack-orb ${active ? 'busy' : ''}`}
          onClick={() => {
            hideBubble();
            activate();
          }}
          aria-label={t('esiri.orbTooltip')}
          data-testid="esiri-orb"
        >
          <Orb size={72} state={active ? orbState : 'idle'} />
        </button>
        {bubble ? (
          <div className="stack-bubble" role="status" onClick={() => { hideBubble(); activate(); }} data-testid="nuru-bubble">
            <strong>NURU</strong>
            {t('stack.greeting')}
            <button
              className="stack-bubble-x"
              onClick={(e) => {
                e.stopPropagation();
                hideBubble();
              }}
              aria-label={t('esiri.close')}
            >
              <Fa icon={faXmark} />
            </button>
          </div>
        ) : (
          <span className="stack-tip">{t('esiri.orbTooltip')}</span>
        )}
      </div>
      <div className="stack-item deco">
        <button className="stack-btn" onClick={notInDemo} aria-label={t('stack.accessibility')}>
          <Fa icon={faUniversalAccess} />
        </button>
        <span className="stack-tip">{t('stack.accessibility')}</span>
      </div>
      <div className="stack-item deco">
        <button className="stack-btn" onClick={notInDemo} aria-label={t('stack.help')}>
          <Fa icon={faCircleQuestion} />
        </button>
        <span className="stack-tip">{t('stack.help')}</span>
      </div>
    </div>
  );
}

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
  const sessionStatus = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id);
  const [, force] = useState(0);

  // Health check (API key, English TTS mode) and the stored session
  useEffect(() => {
    initTTS();
    document.documentElement.lang = useApp.getState().language;
    void fetchHealth().then((h) => {
      useEsiri.getState().setHealth(h);
      setEnglishTTS(h.english_tts);
    });
    void refreshMe();
  }, []);

  // Session lifecycle: events, data, seed rooms, first-use unlock
  useEffect(() => {
    if (sessionStatus !== 'authed' || !userId) {
      if (sessionStatus === 'anon') {
        stopProactive();
        useHub.getState().reset();
      }
      return;
    }
    const u = useSession.getState().user!;
    useApp.getState().ensureSeedRooms(u.display_name);
    if (useApp.getState().wakeMode !== u.wake_word) useApp.getState().setWakeMode(u.wake_word);
    onSignedIn();
    if (shouldShowUnlock()) useNuru.getState().setUnlockNeeded(true);
  }, [sessionStatus, userId]);

  // Keep the server's language setting in step with the UI language.
  useEffect(() => {
    const u = useSession.getState().user;
    if (u && u.language !== language) void patchMe({ language });
  }, [language]);

  // Morning briefing: first visit of the day to Today (after the unlock tap, never in test mode)
  const unlockNeeded = useNuru((s) => s.unlockNeeded);
  useEffect(() => {
    if (sessionStatus !== 'authed' || unlockNeeded || isMuted()) return;
    if (pageFromPath(location.pathname) !== 'hub_today' || briefingSeenToday()) return;
    const id = window.setTimeout(() => {
      if (!briefingSeenToday() && useNuru.getState().briefing.stage === 'closed') void startBriefing();
    }, 1200);
    return () => window.clearTimeout(id);
  }, [sessionStatus, unlockNeeded, location.pathname]);

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

  // Let modals know when Esc belongs to NURU.
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
  const briefingOpen = useNuru((s) => s.briefing.stage !== 'closed');
  useEffect(() => {
    const es = useEsiri.getState();
    if (!wakeMode || !sttSupported() || isMuted() || briefingOpen) {
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
  }, [wakeMode, status, micOpen, language, briefingOpen]);

  const error = Date.now() - errorFlash < 1200;
  const orbState = orbStateFor(status, micOpen, error);
  const active = status !== 'idle' || micOpen;
  const page = pageFromPath(location.pathname);
  const system = systemFromPath(location.pathname);
  const onMeeting = page === 'meeting';
  const onHub = system === 'hub';
  const showStack = !onHub;
  const caption = interim || (micOpen ? t('esiri.status.listening') : t(`esiri.status.${status}`));

  return (
    <>
      <div className={`esiri-stage ${active ? 'show' : ''} ${onMeeting || onHub ? 'raised' : ''}`} aria-live="polite">
        <button className="stage-orb-btn" onClick={() => activate()} aria-label={t('esiri.orbTooltip')} tabIndex={active ? 0 : -1}>
          <Orb size={120} state={orbState} />
        </button>
        <div className="stage-caption">{caption}</div>
      </div>

      {showStack && page !== 'hub_login' && <FloatingStack system={system} orbState={orbState} active={active} />}

      {!panelOpen && hasMessages && (
        <button className="panel-tab" onClick={() => useEsiri.getState().setPanelOpen(true)}>
          NURU
        </button>
      )}
      <Panel />
      <ReminderStack />
      <EventToasts />
      <BriefingSheet />
      <DemoPanel />
      <UnlockOverlay />
    </>
  );
}
