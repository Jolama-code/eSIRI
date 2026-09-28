import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, MonitorPlay, Search } from 'lucide-react';
import { CompactHeader, PageFooter } from '../components/Header';
import { Modal, copyText, joinLink } from '../components/Common';
import { ez } from '../components/esiriProps';
import { useT, useLang, type TFunc } from '../i18n';
import { useApp, formatDateLong, formatTime, type Language } from '../store/appStore';
import './Rooms.css';

export function lastSessionText(iso: string | null, t: TFunc, lang: Language): string {
  if (!iso) return t('rooms.noSession');
  return t('rooms.lastSession', { date: formatDateLong(iso, lang), time: formatTime(iso, lang) });
}

export function DashboardTabs({ active }: { active: 'rooms' | 'recordings' }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="dash-tabs-bar">
      <div className="container">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={active === 'rooms'}
            className={`tab ${active === 'rooms' ? 'active' : ''}`}
            onClick={() => navigate('/rooms')}
            {...ez('rooms.tab.rooms', t('rooms.tabRooms'), { state: active === 'rooms' ? 'selected' : 'unselected' })}
          >
            {t('rooms.tabRooms')}
          </button>
          <button
            role="tab"
            aria-selected={active === 'recordings'}
            className={`tab ${active === 'recordings' ? 'active' : ''}`}
            onClick={() => navigate('/recordings')}
            {...ez('rooms.tab.recordings', t('rooms.tabRecordings'), { state: active === 'recordings' ? 'selected' : 'unselected' })}
          >
            {t('rooms.tabRecordings')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const createRoom = useApp((s) => s.createRoom);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState('');
  const [error, setError] = useState(false);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) {
      setError(true);
      return;
    }
    const room = createRoom(name);
    onClose();
    navigate(`/rooms/${room.id}`);
    toast(t('createRoom.created'));
  };

  return (
    <Modal name="create-room" title={t('createRoom.title')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="room-name">
          {t('createRoom.nameLabel')}
        </label>
        <input
          id="room-name"
          className={`input ${error ? 'invalid' : ''}`}
          placeholder={t('createRoom.placeholder')}
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setError(false);
          }}
          {...ez('create-room.name-input', t('createRoom.nameLabel'))}
        />
        {error && (
          <div className="field-error" role="alert">
            {t('createRoom.required')}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-neutral create-close" onClick={onClose} {...ez('create-room.close', t('createRoom.close'))}>
            {t('createRoom.close')}
          </button>
          <button type="submit" className="btn btn-primary" {...ez('create-room.submit', t('createRoom.submit'), { sensitive: true })}>
            {t('createRoom.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Rooms() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const rooms = useApp((s) => s.rooms);
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = rooms.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page dash">
      <CompactHeader />
      <DashboardTabs active="rooms" />
      <main className="dash-main">
        <div className="container">
          <div className="dash-toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                placeholder={t('rooms.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={t('rooms.search')}
                {...ez('rooms.search', t('rooms.search'))}
              />
            </label>
            <button className="btn btn-primary" onClick={() => setCreating(true)} {...ez('rooms.new-room-btn', t('rooms.newRoom'))}>
              {t('rooms.newRoom')}
            </button>
          </div>

          <div className="room-grid">
            {filtered.map((room) => (
              <article className="room-card card" key={room.id} data-testid="room-card" data-room-name={room.name}>
                <button
                  className="room-card-body"
                  onClick={() => navigate(`/rooms/${room.id}`)}
                  {...ez(`room-card.${room.id}.open`, room.name)}
                >
                  <span className="room-icon">
                    <MonitorPlay size={24} />
                  </span>
                  <h3 className="room-name">{room.name}</h3>
                  <p className="room-last">{lastSessionText(room.lastSession, t, lang)}</p>
                </button>
                <div className="room-card-foot">
                  <button
                    className="icon-btn"
                    title={t('rooms.copyLink')}
                    aria-label={t('rooms.copyLink')}
                    onClick={() => {
                      void copyText(joinLink(room.token));
                      toast(t('rooms.linkCopied'));
                    }}
                    {...ez(`room-card.${room.id}.copy-link`, t('rooms.copyLink'))}
                  >
                    <Copy size={20} />
                  </button>
                  <button
                    className="btn btn-outline start-btn"
                    onClick={() => navigate(`/rooms/${room.id}/meeting`)}
                    {...ez(`room-card.${room.id}.start`, `${t('rooms.start')} – ${room.name}`, { sensitive: true })}
                  >
                    {t('rooms.start')}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {filtered.length === 0 && <p className="dash-empty">{rooms.length ? t('rooms.noMatch') : t('rooms.empty')}</p>}
        </div>
      </main>
      <PageFooter />
      {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
    </div>
  );
}
