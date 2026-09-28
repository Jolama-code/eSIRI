import { Play, Trash2, Video } from 'lucide-react';
import { useT, useLang } from '../i18n';
import { useApp, formatDateLong, formatTime, type Recording } from '../store/appStore';
import { ez } from './esiriProps';
import './RecordingList.css';

export function formatDuration(sec: number, t: ReturnType<typeof useT>): string {
  if (sec < 60) return t('recordings.seconds', { n: sec });
  return t('recordings.minutes', { n: Math.round(sec / 60) });
}

export function RecordingsEmpty() {
  const t = useT();
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Video size={32} />
      </div>
      <p className="empty-title">{t('recordings.emptyTitle')}</p>
      <p className="empty-body">{t('recordings.emptyBody')}</p>
    </div>
  );
}

export function RecordingList({ recordings, showRoom = false }: { recordings: Recording[]; showRoom?: boolean }) {
  const t = useT();
  const lang = useLang();
  const rooms = useApp((s) => s.rooms);
  const deleteRecording = useApp((s) => s.deleteRecording);
  const toast = useApp((s) => s.toast);

  if (!recordings.length) return <RecordingsEmpty />;

  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th>{t('recordings.name')}</th>
            {showRoom && <th>{t('recordings.room')}</th>}
            <th>{t('recordings.date')}</th>
            <th>{t('recordings.duration')}</th>
            <th className="right">{t('recordings.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr key={r.id} data-testid="recording-row">
              <td className="rec-name">
                <span className="rec-name-inner">
                  <span className="rec-thumb">
                    <Video size={16} />
                  </span>
                  <span data-testid="recording-name">{r.name}</span>
                </span>
              </td>
              {showRoom && <td>{rooms.find((x) => x.id === r.roomId)?.name ?? '—'}</td>}
              <td>
                {formatDateLong(r.date, lang)} · {formatTime(r.date, lang)}
              </td>
              <td className="nowrap">{formatDuration(r.durationSec, t)}</td>
              <td className="right rec-actions">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => toast(t('recordings.playing', { name: r.name }))}
                  {...ez(`recording.${r.id}.play`, `${t('recordings.play')} – ${r.name}`)}
                >
                  <Play size={14} /> {t('recordings.play')}
                </button>
                <button
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => {
                    deleteRecording(r.id);
                    toast(t('recordings.deleted'));
                  }}
                  {...ez(`recording.${r.id}.delete`, `${t('recordings.delete')} – ${r.name}`, { sensitive: true })}
                >
                  <Trash2 size={14} /> {t('recordings.delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
