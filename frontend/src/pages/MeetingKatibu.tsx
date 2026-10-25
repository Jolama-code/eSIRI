/**
 * KatibuAI pieces of the meeting screen: the "Inarekodiwa kwa KatibuAI" badge with a live level meter and a
 * recording timer, the visible sample player (sample mode), and the live captions panel.
 */
import { useEffect, useRef, useState } from 'react';
import { Captions, Pause, Play } from 'lucide-react';
import { useT } from '../i18n';
import { useRecorder, toggleSamplePlayback } from '../esiri/meetingFlow';
import { useCaptions } from '../esiri/captions';

function useTick(ms: number, on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, on]);
  return now;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function KatibuRecBadge() {
  const t = useT();
  const active = useRecorder((s) => s.active);
  const unavailable = useRecorder((s) => s.unavailable);
  const mode = useRecorder((s) => s.mode);
  const level = useRecorder((s) => s.level);
  const startedAt = useRecorder((s) => s.startedAt);
  const now = useTick(500, active && !unavailable);
  if (!active) return null;
  const label = unavailable ? t('meeting.katibuRecOff') : mode === 'sample' ? t('meeting.katibuRecSample') : t('meeting.katibuRec');
  const bars = [0.12, 0.3, 0.5, 0.7, 0.88];
  return (
    <span className={`mt-katibu-rec ${unavailable ? 'off' : ''}`} data-testid="katibu-recording" title={label}>
      <span className="dot" /> <span className="mt-katibu-text">{label}</span>
      {!unavailable && (
        <>
          <span className="mt-katibu-meter" aria-hidden data-testid="katibu-meter">
            {bars.map((b) => (
              <i key={b} className={level > b ? 'on' : ''} />
            ))}
          </span>
          <span className="mt-katibu-timer t-num" data-testid="katibu-timer">{mmss((now - startedAt) / 1000)}</span>
        </>
      )}
    </span>
  );
}

export function SamplePlayer() {
  const t = useT();
  const mode = useRecorder((s) => s.mode);
  const active = useRecorder((s) => s.active);
  const playing = useRecorder((s) => s.samplePlaying);
  const pos = useRecorder((s) => s.samplePos);
  const dur = useRecorder((s) => s.sampleDuration);
  if (!active || mode !== 'sample') return null;
  return (
    <div className="mt-sample" data-testid="sample-player">
      <button className="mt-sample-btn" onClick={toggleSamplePlayback} aria-label={playing ? t('meeting.samplePause') : t('meeting.samplePlay')}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="mt-sample-main">
        <div className="mt-sample-title">{t('meeting.samplePlaying')}</div>
        <div className="mt-sample-bar">
          <span style={{ width: `${dur ? (pos / dur) * 100 : 0}%` }} />
        </div>
      </div>
      <span className="mt-sample-time t-num">
        {mmss(pos)} / {mmss(dur)}
      </span>
    </div>
  );
}

export function CaptionsPanel() {
  const t = useT();
  const on = useCaptions((s) => s.on);
  const paused = useCaptions((s) => s.paused);
  const lines = useCaptions((s) => s.lines);
  const interim = useCaptions((s) => s.interim);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, interim]);
  if (!on) return null;
  return (
    <div className="mt-captions" data-testid="live-captions" aria-live="polite">
      <div className="mt-captions-head">
        <Captions size={14} /> {t('meeting.captions')}
        {paused && <span className="mt-captions-paused">{t('meeting.captionsPaused')}</span>}
      </div>
      <div className="mt-captions-body">
        {lines.slice(-6).map((l) => (
          <p key={l.id}>{l.text}</p>
        ))}
        {interim && <p className="interim">{interim}</p>}
        {!lines.length && !interim && !paused && <p className="hint">{t('meeting.captionsWaiting')}</p>}
        <div ref={end} />
      </div>
    </div>
  );
}
