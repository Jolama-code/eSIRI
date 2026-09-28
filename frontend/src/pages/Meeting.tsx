import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3, ChevronDown, ChevronLeft, ChevronRight, Circle, FileText, Hand, LayoutGrid, LogOut, MessageSquare, MessagesSquare,
  Mic, MicOff, Monitor, MonitorOff, MonitorUp, PenTool, SendHorizontal, Smile, SmilePlus, Users, Video, VideoOff, Volume2, Presentation,
} from 'lucide-react';
import { ez } from '../components/esiriProps';
import { useT, useLang } from '../i18n';
import { useApp, formatTime } from '../store/appStore';
import { CURRENT_USER } from '../store/data';
import { Wordmark } from '../components/Header';
import './Meeting.css';

const REACTIONS = [
  { id: 'thumbs', emoji: '👍', key: 'meeting.thumbs' },
  { id: 'clap', emoji: '👏', key: 'meeting.clap' },
  { id: 'laugh', emoji: '😂', key: 'meeting.laugh' },
  { id: 'heart', emoji: '❤️', key: 'meeting.heart' },
  { id: 'party', emoji: '🎉', key: 'meeting.party' },
] as const;

function useTimer(startedAt: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return '00:00';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Meeting() {
  const { roomId = '' } = useParams();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const room = useApp((s) => s.rooms.find((r) => r.id === roomId));
  const live = useApp((s) => s.live);
  const meeting = useApp((s) => s.meetings[roomId]);
  const { startMeeting, updateLive, startRecording, stopRecording, leaveMeeting, sendChat, setNotes, toast } = useApp.getState();
  const [chatText, setChatText] = useState('');
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [floating, setFloating] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const chatEnd = useRef<HTMLDivElement>(null);
  const timer = useTimer(live?.roomId === roomId && live.recording ? live.recordingStartedAt : null);

  const roomExists = !!room;
  useEffect(() => {
    if (roomExists) startMeeting(roomId);
  }, [roomExists, roomId, startMeeting]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [meeting?.chat.length]);

  if (!room) {
    return (
      <div className="meeting meeting-missing">
        <p>{t('meeting.notFound')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/rooms')}>
          {t('room.backToRooms')}
        </button>
      </div>
    );
  }
  const L = live && live.roomId === room.id ? live : null;
  const chat = meeting?.chat ?? [];
  const notes = meeting?.notes ?? '';
  const panel = L?.panel ?? 'chat';
  const defaultPres = room.presentation[0];
  const canRecord = room.settings.allowRecording;

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!chatText.trim()) return;
    sendChat(room.id, chatText);
    setChatText('');
  };

  const react = (emoji: string) => {
    setReactionsOpen(false);
    const id = Date.now() + Math.random();
    setFloating((f) => [...f, { id, emoji, x: 30 + Math.random() * 40 }]);
    window.setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 2600);
  };

  const toggleRecord = () => {
    if (!L || !canRecord) return;
    if (L.recording) {
      const rec = stopRecording();
      if (rec) toast(t('meeting.recordingSaved'));
    } else {
      startRecording();
      toast(t('meeting.recordingStarted'));
    }
  };

  const leave = () => {
    const wasRecording = !!L?.recording;
    leaveMeeting();
    if (wasRecording) toast(t('meeting.recordingSaved'));
    navigate(`/rooms/${room.id}`);
  };

  const features = [
    { icon: <MessagesSquare size={22} />, title: t('meeting.feat.chat'), desc: t('meeting.feat.chatDesc') },
    { icon: <Video size={22} />, title: t('meeting.feat.webcams'), desc: t('meeting.feat.webcamsDesc') },
    { icon: <Mic size={22} />, title: t('meeting.feat.audio'), desc: t('meeting.feat.audioDesc') },
    { icon: <LayoutGrid size={22} />, title: t('meeting.feat.breakout'), desc: t('meeting.feat.breakoutDesc') },
    { icon: <BarChart3 size={22} />, title: t('meeting.feat.polling'), desc: t('meeting.feat.pollingDesc') },
    { icon: <Hand size={22} />, title: t('meeting.feat.emojis'), desc: t('meeting.feat.emojisDesc') },
    { icon: <Monitor size={22} />, title: t('meeting.feat.screen'), desc: t('meeting.feat.screenDesc') },
    { icon: <PenTool size={22} />, title: t('meeting.feat.whiteboard'), desc: t('meeting.feat.whiteboardDesc') },
  ];

  const micOn = !!L?.mic;
  const recLabel = L?.recording ? t('meeting.stopRecording') : t('meeting.startRecording');

  return (
    <div className="meeting" data-testid="meeting">
      {/* Sidebar */}
      <aside className="mt-sidebar">
        <div className="mt-side-section">{t('meeting.messages')}</div>
        <button
          className={`mt-side-item ${panel === 'chat' ? 'active' : ''}`}
          onClick={() => updateLive({ panel: 'chat' })}
          {...ez('meeting.panel.public-chat', t('meeting.publicChat'), { state: panel === 'chat' ? 'selected' : 'unselected' })}
        >
          <MessageSquare size={18} /> {t('meeting.publicChat')}
        </button>
        <div className="mt-side-section">{t('meeting.notes')}</div>
        <button
          className={`mt-side-item ${panel === 'notes' ? 'active' : ''}`}
          onClick={() => updateLive({ panel: 'notes' })}
          {...ez('meeting.panel.shared-notes', t('meeting.sharedNotes'), { state: panel === 'notes' ? 'selected' : 'unselected' })}
        >
          <FileText size={18} /> {t('meeting.sharedNotes')}
        </button>
        <div className="mt-side-section">
          <Users size={13} /> {t('meeting.users', { n: 1 })}
        </div>
        <div className="mt-user" data-testid="meeting-user">
          <span className="mt-avatar">
            {CURRENT_USER.initials}
            {!micOn && (
              <span className="mt-muted-dot">
                <MicOff size={9} />
              </span>
            )}
          </span>
          <span className="mt-user-name">
            {CURRENT_USER.name} {t('meeting.you')}
          </span>
          {L?.handRaised && (
            <span className="mt-hand" data-testid="hand-indicator" aria-label={t('meeting.raiseHand')}>
              ✋
            </span>
          )}
        </div>
      </aside>

      {/* Chat / notes panel */}
      <section className="mt-panel">
        <div className="mt-panel-head">
          <ChevronLeft size={16} /> {panel === 'chat' ? t('meeting.publicChat') : t('meeting.sharedNotes')}
        </div>
        {panel === 'chat' ? (
          <>
            <div className="mt-chat" data-testid="chat-messages">
              <div className="mt-system">
                <Presentation size={14} /> {t('meeting.presenter', { name: CURRENT_USER.name })}
              </div>
              {chat.map((m) => (
                <div className="mt-msg" key={m.id}>
                  <span className="mt-avatar sm">{CURRENT_USER.initials}</span>
                  <div className="mt-msg-body">
                    <div className="mt-msg-meta">
                      <strong>{m.author}</strong> <span>{formatTime(m.time, lang)}</span>
                    </div>
                    <div className="mt-msg-text" data-testid="chat-message">
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form className="mt-chat-form" onSubmit={send}>
              <input
                className="mt-chat-input"
                placeholder={t('meeting.chatPlaceholder')}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                aria-label={t('meeting.chatPlaceholder')}
                {...ez('meeting.chat-input', t('meeting.chatPlaceholder'))}
              />
              <button type="submit" className="mt-send" aria-label={t('meeting.send')} {...ez('meeting.chat-send', t('meeting.send'))}>
                <SendHorizontal size={18} />
              </button>
            </form>
          </>
        ) : (
          <textarea
            className="mt-notes"
            placeholder={t('meeting.notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(room.id, e.target.value)}
            aria-label={t('meeting.sharedNotes')}
            data-testid="notes"
            {...ez('meeting.notes-input', t('meeting.sharedNotes'))}
          />
        )}
      </section>

      {/* Main stage */}
      <section className="mt-main">
        <header className="mt-topbar">
          <div className="mt-top-left">
            <Users size={18} />
          </div>
          <div className="mt-top-center">
            <span className="mt-room-name">
              {room.name} <ChevronDown size={14} />
            </span>
            <span className="mt-divider" />
            <span className="rec-wrap" title={canRecord ? recLabel : t('meeting.recordingDisabled')}>
              <button
                className={`mt-rec ${L?.recording ? 'recording' : ''}`}
                onClick={toggleRecord}
                disabled={!canRecord}
                {...ez('meeting.record-toggle', recLabel, { sensitive: true, state: L?.recording ? 'on' : 'off' })}
              >
                <Circle size={14} className="rec-dot" fill={L?.recording ? '#ff3b3b' : 'none'} />
                {L?.recording ? `${recLabel} · ${timer}` : recLabel}
              </button>
            </span>
          </div>
          <div className="mt-top-right">
            <span className="mt-signal">
              <BarChart3 size={16} />
            </span>
            <button className="mt-leave" onClick={leave} title={t('meeting.leave')} aria-label={t('meeting.leave')} {...ez('meeting.leave', t('meeting.leave'), { sensitive: true })}>
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="mt-stage">
          {L?.screenShare && (
            <div className="mt-share-banner" data-testid="share-banner">
              <MonitorUp size={16} /> {t('meeting.sharing')}
            </div>
          )}
          {L?.camera && (
            <div className="mt-webcams">
              <div className="mt-webcam" data-testid="webcam-tile">
                <span className="mt-avatar lg">{CURRENT_USER.initials}</span>
                <span className="mt-webcam-name">{CURRENT_USER.name}</span>
              </div>
            </div>
          )}
          <div className="mt-slide">
            <div className="mt-slide-hero">
              <div className="mt-slide-logo">
                <img src="/assets/tanzania-coat-of-arms.svg" alt="" />
              </div>
              {defaultPres ? (
                <>
                  <h2 className="mt-slide-title" data-testid="slide-title">
                    {defaultPres.name}
                  </h2>
                  <p className="mt-slide-sub">{t('meeting.presentationSlide')} · {room.name}</p>
                </>
              ) : (
                <>
                  <h2 className="mt-slide-title" data-testid="slide-title">
                    {t('meeting.welcome')}
                  </h2>
                  <p className="mt-slide-sub">{t('meeting.welcomeSub')}</p>
                </>
              )}
              <span className="mt-slide-rule" />
            </div>
            <div className="mt-features">
              {features.map((f) => (
                <div className="mt-feature" key={f.title}>
                  <span className="mt-feature-icon">{f.icon}</span>
                  <div>
                    <div className="mt-feature-title">{f.title}</div>
                    <div className="mt-feature-desc">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-slide-foot">
              <Wordmark /> <span>· e-GA</span>
            </div>
          </div>
          <div className="mt-slide-nav">
            <ChevronLeft size={16} /> {t('meeting.slide', { n: 1 })} <ChevronDown size={14} /> <ChevronRight size={16} />
          </div>

          <div className="mt-floating">
            {floating.map((f) => (
              <span key={f.id} className="float-emoji" style={{ left: `${f.x}%` }}>
                {f.emoji}
              </span>
            ))}
          </div>
        </div>

        <footer className="mt-bottombar">
          <div className="mt-bb-left">
            <Volume2 size={18} />
          </div>
          <div className="mt-bb-center">
            <button
              className={`mt-round ${micOn ? 'on' : 'off'}`}
              onClick={() => updateLive({ mic: !micOn })}
              title={micOn ? t('meeting.mute') : t('meeting.unmute')}
              aria-label={micOn ? t('meeting.mute') : t('meeting.unmute')}
              data-testid="mic-toggle"
              {...ez('meeting.mic-toggle', micOn ? t('meeting.mute') : t('meeting.unmute'), { state: micOn ? 'on' : 'off' })}
            >
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button
              className={`mt-round ${L?.camera ? 'on' : ''}`}
              onClick={() => updateLive({ camera: !L?.camera })}
              title={L?.camera ? t('meeting.cameraOff') : t('meeting.cameraOn')}
              aria-label={t('meeting.camera')}
              {...ez('meeting.camera-toggle', L?.camera ? t('meeting.cameraOff') : t('meeting.cameraOn'), { state: L?.camera ? 'on' : 'off' })}
            >
              {L?.camera ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
            <button
              className={`mt-round ${L?.screenShare ? 'on' : ''}`}
              onClick={() => updateLive({ screenShare: !L?.screenShare })}
              title={L?.screenShare ? t('meeting.stopShare') : t('meeting.shareScreen')}
              aria-label={t('meeting.shareScreen')}
              {...ez('meeting.screenshare-toggle', L?.screenShare ? t('meeting.stopShare') : t('meeting.shareScreen'), { state: L?.screenShare ? 'on' : 'off' })}
            >
              {L?.screenShare ? <MonitorUp size={20} /> : <MonitorOff size={20} />}
            </button>
            <div className="mt-reactions-wrap">
              <button
                className={`mt-round ${reactionsOpen ? 'on' : ''}`}
                onClick={() => setReactionsOpen((o) => !o)}
                title={t('meeting.reactions')}
                aria-label={t('meeting.reactions')}
                {...ez('meeting.reactions-btn', t('meeting.reactions'))}
              >
                {reactionsOpen ? <SmilePlus size={20} /> : <Smile size={20} />}
              </button>
              {reactionsOpen && (
                <div className="mt-reaction-picker">
                  {REACTIONS.map((r) => (
                    <button key={r.id} onClick={() => react(r.emoji)} title={t(r.key)} aria-label={t(r.key)} {...ez(`meeting.reaction.${r.id}`, t(r.key))}>
                      {r.emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-bb-right">
            <button
              className={`mt-round ${L?.handRaised ? 'on' : ''}`}
              onClick={() => updateLive({ handRaised: !L?.handRaised })}
              title={L?.handRaised ? t('meeting.lowerHand') : t('meeting.raiseHand')}
              aria-label={t('meeting.raiseHand')}
              {...ez('meeting.raise-hand', L?.handRaised ? t('meeting.lowerHand') : t('meeting.raiseHand'), { state: L?.handRaised ? 'on' : 'off' })}
            >
              <Hand size={20} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
