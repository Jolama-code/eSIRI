/**
 * "Safari ya kumbukumbu": the real path of one minutes job, step by step with timestamps, from the backend's
 * job.journey: the recording that was sent (live or sample, with the reason; play it), the chunked upload to
 * KatibuAI and the meeting id it returned, transcribing, writing, done (with KatibuAI's own transcript).
 */
import { useEffect, useRef, useState } from 'react';
import { faCheck, faCircleExclamation, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { authFetch } from '../esiri/session';
import type { KatibuJobRow } from './hubStore';
import { Fa } from './ui';

export interface Journey {
  recording?: { source: 'live' | 'sample'; note: string; seconds: number; bytes: number; peaks: number[]; at: string };
  upload?: { katibu_uid: string; chunks_sent: number; chunks_total: number; started_at: string; done_at?: string };
  stages_at?: Record<string, string>;
  katibu?: { stages: { key: string; state: string }[]; attempts?: number; job_status?: string };
  transcript?: { excerpt?: string; chars?: number; error?: string };
}

type StepState = 'done' | 'active' | 'pending' | 'failed';

const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

function Waveform({ peaks, progress }: { peaks: number[]; progress: number }) {
  if (!peaks.length) return null;
  const w = 2;
  const gap = 1;
  return (
    <svg className="jr-wave" viewBox={`0 0 ${peaks.length * (w + gap)} 40`} preserveAspectRatio="none" aria-hidden data-testid="journey-wave">
      {peaks.map((p, i) => {
        const h = Math.max(2, p * 38);
        return <rect key={i} x={i * (w + gap)} y={20 - h / 2} width={w} height={h} rx={1} className={i / peaks.length < progress ? 'played' : ''} />;
      })}
    </svg>
  );
}

function Player({ jobId, peaks }: { jobId: number; peaks: number[] }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      audio.current?.pause();
      if (audio.current?.src) URL.revokeObjectURL(audio.current.src);
    },
    [],
  );
  const toggle = async () => {
    if (playing) {
      audio.current?.pause();
      return;
    }
    if (!audio.current) {
      const r = await authFetch(`/api/katibu/jobs/${jobId}/audio`);
      if (!r.ok) {
        setError(t('journey.audioGone'));
        return;
      }
      const a = new Audio(URL.createObjectURL(await r.blob()));
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      audio.current = a;
    }
    void audio.current.play();
  };
  return (
    <div className="jr-player">
      <button className="jr-play" onClick={() => void toggle()} aria-label={playing ? t('journey.pause') : t('journey.play')} data-testid="journey-play">
        <Fa icon={playing ? faPause : faPlay} />
      </button>
      <Waveform peaks={peaks} progress={progress} />
      {error && <span className="t-small">{error}</span>}
    </div>
  );
}

function Step({ n, state, title, time, children }: { n: number; state: StepState; title: string; time?: string; children?: React.ReactNode }) {
  return (
    <li className={`jr-step ${state}`} data-testid="journey-step" data-state={state}>
      <span className="jr-dot">{state === 'done' ? <Fa icon={faCheck} /> : state === 'failed' ? <Fa icon={faCircleExclamation} /> : n}</span>
      <div className="jr-body">
        <div className="jr-title">
          <span>{title}</span>
          {time && <span className="jr-time t-num">{time}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

export function JourneyPanel({ job }: { job: KatibuJobRow & { journey?: Journey } }) {
  const t = useT();
  const lang = useLang();
  const j = job.journey ?? {};
  const rec = j.recording;
  const up = j.upload;
  const at = j.stages_at ?? {};
  const stages = j.katibu?.stages ?? [];
  const stageState = (key: string) => stages.find((s) => s.key === key)?.state;
  const failed = job.status === 'failed';
  const finished = job.status === 'ready' || job.status === 'sent';
  const uploaded = !!up?.done_at;
  const transcribeDone = stageState('TRANSCRIBE') === 'DONE' || !!at.IDENTIFY_SPEAKERS || finished;
  const writeDone = stageState('WRITE_MINUTES') === 'DONE' || !!at.TRANSLATE_MINUTES || finished;
  const state = (done: boolean, started: boolean): StepState => (done ? 'done' : started ? (failed ? 'failed' : 'active') : 'pending');
  const note = rec?.note ? t(`minutes.note.${rec.note}` as I18nKey) : '';

  return (
    <div className="journey" data-testid="journey">
      <ol className="jr-steps">
        <Step n={1} state={rec ? 'done' : failed ? 'failed' : 'active'} title={t('journey.recorded')} time={clock(rec?.at || job.created_at)}>
          {rec && (
            <>
              <div className="jr-line">
                <span className={`chip ${rec.source === 'live' ? 'green' : 'amber'}`} data-testid="journey-source">
                  {rec.source === 'live' ? t('journey.live') : t('journey.sample')}
                </span>
                {rec.source === 'sample' && note && <span className="t-small">{note}</span>}
              </div>
              <div className="jr-facts t-small">
                {t('journey.duration')}: <b className="t-num">{mmss(rec.seconds)}</b> · {t('journey.size')}: <b className="t-num">{size(rec.bytes)}</b>
              </div>
              <Player jobId={job.id} peaks={rec.peaks ?? []} />
              <div className="t-small">{t('journey.playHint')}</div>
            </>
          )}
        </Step>
        <Step n={2} state={state(uploaded, !!up)} title={t('journey.upload')} time={clock(up?.done_at || up?.started_at)}>
          {up && (
            <div className="jr-facts t-small">
              {t('journey.chunks', { sent: up.chunks_sent, total: up.chunks_total || '…' })}
              {up.katibu_uid && (
                <>
                  <br />
                  {t('journey.katibuId')}: <code data-testid="journey-uid">{up.katibu_uid}</code>
                </>
              )}
            </div>
          )}
        </Step>
        <Step n={3} state={state(transcribeDone, uploaded)} title={t('journey.transcribing')} time={clock(at.TRANSCRIBE || at.ASSEMBLE_AUDIO)}>
          {!transcribeDone && uploaded && !failed && <div className="t-small">{lang === 'sw' ? job.stage_sw : job.stage_en} · {job.progress}%</div>}
        </Step>
        <Step n={4} state={state(writeDone, transcribeDone)} title={t('journey.writing')} time={clock(at.WRITE_MINUTES)} />
        <Step n={5} state={finished ? 'done' : failed ? 'failed' : 'pending'} title={t('journey.done')} time={clock(at.DONE || job.ready_at)}>
          {failed && <div className="t-small">{lang === 'sw' ? job.error.sw : job.error.en}</div>}
          {finished && j.transcript?.excerpt && (
            <div className="jr-transcript" data-testid="journey-transcript">
              <div className="jr-tr-label">{t('journey.transcript')}</div>
              <p>{j.transcript.excerpt}{(j.transcript.chars ?? 0) > j.transcript.excerpt.length ? ' …' : ''}</p>
            </div>
          )}
          {finished && !j.transcript?.excerpt && <div className="t-small">{t('journey.noTranscript')}</div>}
        </Step>
      </ol>
    </div>
  );
}
