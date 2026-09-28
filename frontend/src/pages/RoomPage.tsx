import { useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, FileText, Home, KeyRound, Presentation, Search, Star, Trash2, UploadCloud, UserPlus, X } from 'lucide-react';
import { CompactHeader, PageFooter } from '../components/Header';
import { Modal, Toggle, copyText, joinLink } from '../components/Common';
import { RecordingList } from '../components/RecordingList';
import { ez } from '../components/esiriProps';
import { useT, useLang } from '../i18n';
import { useApp, type Room, type SettingKey } from '../store/appStore';
import { DIRECTORY, SAMPLE_DOCS, formatBytes, userById } from '../store/data';
import { lastSessionText } from './Rooms';
import './RoomPage.css';

type Tab = 'recordings' | 'presentation' | 'access' | 'settings';

export default function RoomPage() {
  const { roomId } = useParams();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const room = useApp((s) => s.rooms.find((r) => r.id === roomId));
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<Tab>('recordings');

  if (!room) {
    return (
      <div className="page dash">
        <CompactHeader />
        <main className="dash-main">
          <div className="container">
            <div className="card empty-state">
              <p className="empty-title">{t('room.notFound')}</p>
              <button className="btn btn-primary" onClick={() => navigate('/rooms')} {...ez('room.home-btn', t('room.backToRooms'))}>
                {t('room.backToRooms')}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'recordings', label: t('room.tabRecordings') },
    { id: 'presentation', label: t('room.tabPresentation') },
    { id: 'access', label: t('room.tabAccess') },
    { id: 'settings', label: t('room.tabSettings') },
  ];

  return (
    <div className="page dash room-page">
      <CompactHeader />
      <section className="room-head">
        <div className="container">
          <button className="icon-btn home-btn" onClick={() => navigate('/rooms')} aria-label={t('room.home')} {...ez('room.home-btn', t('room.home'))}>
            <Home size={24} />
          </button>
          <div className="room-head-row">
            <div className="room-head-text">
              <h1 className="room-title" data-testid="room-title">
                {room.name}
              </h1>
              <p className="room-sub">{lastSessionText(room.lastSession, t, lang)}</p>
            </div>
            <div className="room-head-actions">
              <button
                className="btn btn-outline"
                onClick={() => {
                  void copyText(joinLink(room.token));
                  toast(t('rooms.linkCopied'));
                }}
                {...ez('room.copy-link', t('room.copyJoinLink'))}
              >
                <Copy size={16} /> {t('room.copyJoinLink')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/rooms/${room.id}/meeting`)}
                {...ez('room.start-meeting', t('room.startMeeting'), { sensitive: true })}
              >
                {t('room.startMeeting')}
              </button>
            </div>
          </div>
          <div className="tabs room-tabs" role="tablist">
            {tabs.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={tab === x.id}
                className={`tab ${tab === x.id ? 'active' : ''}`}
                onClick={() => setTab(x.id)}
                {...ez(`room.tab.${x.id}`, x.label, { state: tab === x.id ? 'selected' : 'unselected' })}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <main className="dash-main room-main">
        <div className="container">
          <div className="card tab-card">
            {tab === 'recordings' && <RoomRecordings room={room} />}
            {tab === 'presentation' && <PresentationTab room={room} />}
            {tab === 'access' && <AccessTab room={room} />}
            {tab === 'settings' && <SettingsTab room={room} />}
          </div>
        </div>
      </main>
      <PageFooter />
    </div>
  );
}

function RoomRecordings({ room }: { room: Room }) {
  const recordings = useApp((s) => s.recordings);
  const mine = recordings.filter((r) => r.roomId === room.id).sort((a, b) => b.date.localeCompare(a.date));
  return <RecordingList recordings={mine} />;
}

// ---------------------------------------------------------------------------

function PresentationTab({ room }: { room: Room }) {
  const t = useT();
  const addPresentation = useApp((s) => s.addPresentation);
  const removePresentation = useApp((s) => s.removePresentation);
  const toast = useApp((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      addPresentation(room.id, { name: f.name, size: f.size, source: 'upload' });
      toast(t('presentation.fileAdded', { name: f.name }));
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="tab-pad">
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
      >
        <UploadCloud size={36} />
        <p className="dz-title">{t('presentation.uploadTitle')}</p>
        <p className="dz-hint">{t('presentation.uploadHint')}</p>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <h3 className="sub-title">{t('presentation.eOffice')}</h3>
      <ul className="doc-list">
        {SAMPLE_DOCS.map((d) => {
          const added = room.presentation.some((f) => f.docId === d.id);
          return (
            <li key={d.id} className="doc-item">
              <FileText size={20} className="doc-icon" />
              <span className="doc-name">{d.name}</span>
              <span className="doc-size">{formatBytes(d.size)}</span>
              <button
                className="btn btn-outline btn-sm"
                disabled={added}
                onClick={() => {
                  addPresentation(room.id, { name: d.name, size: d.size, source: 'eoffice', docId: d.id });
                  toast(t('presentation.fileAdded', { name: d.name }));
                }}
                {...ez(`presentation.sample.${d.id}.add`, `${t('presentation.add')} – ${d.name}`)}
              >
                {added ? t('presentation.added') : t('presentation.add')}
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="sub-title">{t('presentation.files')}</h3>
      {room.presentation.length === 0 ? (
        <p className="muted-text">{t('presentation.noFiles')}</p>
      ) : (
        <ul className="doc-list" data-testid="presentation-files">
          {room.presentation.map((f, i) => (
            <li key={f.id} className="doc-item">
              <Presentation size={20} className="doc-icon" />
              <span className="doc-name">
                {f.name}
                {i === 0 && (
                  <span className="badge badge-default default-badge">
                    <Star size={11} /> {t('presentation.default')}
                  </span>
                )}
              </span>
              <span className="doc-size">{formatBytes(f.size)}</span>
              <button
                className="btn btn-danger-outline btn-sm"
                onClick={() => {
                  removePresentation(room.id, f.id);
                  toast(t('presentation.fileRemoved', { name: f.name }));
                }}
                {...ez(`presentation.file.${f.id}.remove`, `${t('presentation.remove')} – ${f.name}`)}
              >
                {t('presentation.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccessTab({ room }: { room: Room }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const removeSharedUser = useApp((s) => s.removeSharedUser);
  const toast = useApp((s) => s.toast);

  return (
    <div className="tab-pad">
      <div className="access-head">
        <h3 className="sub-title flush">{t('access.sharedTitle')}</h3>
        <button className="btn btn-primary" onClick={() => setOpen(true)} {...ez('access.share-btn', t('access.share'))}>
          <UserPlus size={16} /> {t('access.share')}
        </button>
      </div>
      {room.sharedUsers.length === 0 ? (
        <p className="muted-text">{t('access.noShared')}</p>
      ) : (
        <ul className="people-list" data-testid="shared-users">
          {room.sharedUsers.map((id) => {
            const u = userById(id);
            if (!u) return null;
            return (
              <li key={id} className="person" data-testid="shared-user">
                <span className="avatar sm">{initials(u.name)}</span>
                <span className="person-text">
                  <span className="person-name">{u.name}</span>
                  <span className="person-email">{u.email}</span>
                </span>
                <button
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => {
                    removeSharedUser(room.id, id);
                    toast(t('access.removed', { name: u.name }));
                  }}
                  {...ez(`access.shared.${id}.remove`, `${t('access.remove')} – ${u.name}`, { sensitive: true })}
                >
                  {t('access.remove')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <ShareAccessModal room={room} onClose={() => setOpen(false)} />}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function ShareAccessModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const addSharedUser = useApp((s) => s.addSharedUser);
  const toast = useApp((s) => s.toast);
  const needle = q.trim().toLowerCase();
  const available = DIRECTORY.filter((u) => !room.sharedUsers.includes(u.id));
  const results = available.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.includes(needle));

  return (
    <Modal
      name="share-access"
      title={t('access.modalTitle')}
      onClose={onClose}
      width={520}
      footer={
        <button className="btn btn-neutral" onClick={onClose} {...ez('access.modal.close', t('access.close'))}>
          {t('access.close')}
        </button>
      }
    >
      <label className="search-box wide">
        <Search size={17} />
        <input
          placeholder={t('access.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          aria-label={t('access.searchPlaceholder')}
          {...ez('access.search-input', t('access.searchPlaceholder'))}
        />
      </label>
      <ul className="people-list in-modal">
        {results.map((u) => (
          <li key={u.id} className="person">
            <span className="avatar sm">{initials(u.name)}</span>
            <span className="person-text">
              <span className="person-name">{u.name}</span>
              <span className="person-email">
                {u.email} · {u.title}
              </span>
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                addSharedUser(room.id, u.id);
                toast(t('access.granted', { name: u.name }));
              }}
              {...ez(`access.user.${u.id}.add`, `${t('access.add')} – ${u.name}`)}
            >
              {t('access.add')}
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="muted-text">{available.length ? t('access.noResults') : t('access.allAdded')}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab({ room }: { room: Room }) {
  const t = useT();
  const navigate = useNavigate();
  const setSetting = useApp((s) => s.setSetting);
  const generateCode = useApp((s) => s.generateCode);
  const deleteCode = useApp((s) => s.deleteCode);
  const renameRoom = useApp((s) => s.renameRoom);
  const deleteRoom = useApp((s) => s.deleteRoom);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(room.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggles: { key: SettingKey; id: string; label: string }[] = [
    { key: 'muteOnJoin', id: 'mute-on-join', label: t('settings.muteOnJoin') },
    { key: 'requireApproval', id: 'require-approval', label: t('settings.requireApproval') },
    { key: 'anyoneCanStart', id: 'anyone-can-start', label: t('settings.anyoneCanStart') },
    { key: 'allModerators', id: 'all-moderators', label: t('settings.allModerators') },
    { key: 'allowRecording', id: 'allow-recording', label: t('settings.allowRecording') },
  ];

  const codes: { kind: 'viewer' | 'moderator'; label: string; value: string | null }[] = [
    { kind: 'viewer', label: t('settings.viewerCode'), value: room.viewerCode },
    { kind: 'moderator', label: t('settings.moderatorCode'), value: room.moderatorCode },
  ];

  return (
    <div className="tab-pad settings-grid">
      <section>
        <h3 className="sub-title">{t('settings.roomSettings')}</h3>
        {toggles.map((x) => (
          <Toggle
            key={x.key}
            id={`settings.toggle.${x.id}`}
            label={x.label}
            checked={room.settings[x.key]}
            onChange={(v) => setSetting(room.id, x.key, v)}
          />
        ))}
      </section>

      <section>
        <h3 className="sub-title">{t('settings.accessCodes')}</h3>
        {codes.map((c) => (
          <div className="code-row" key={c.kind}>
            <div className="code-text">
              <span className="toggle-label">{c.label}</span>
              <span className={`code-value ${c.value ? '' : 'none'}`} data-testid={`${c.kind}-code`}>
                <KeyRound size={15} /> {c.value ?? t('settings.noCode')}
              </span>
            </div>
            <div className="code-actions">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  generateCode(room.id, c.kind);
                  toast(t('settings.codeGenerated'));
                }}
                {...ez(`settings.${c.kind}-code.generate`, `${t('settings.generate')} – ${c.label}`)}
              >
                {t('settings.generate')}
              </button>
              <button
                className="btn btn-danger-outline btn-sm"
                disabled={!c.value}
                onClick={() => deleteCode(room.id, c.kind)}
                {...ez(`settings.${c.kind}-code.delete`, `${t('settings.delete')} – ${c.label}`)}
              >
                {t('settings.delete')}
              </button>
            </div>
          </div>
        ))}

        <h3 className="sub-title">{t('settings.roomName')}</h3>
        <form
          className="rename-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            renameRoom(room.id, name);
            toast(t('settings.saved'));
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('settings.roomName')}
            {...ez('settings.room-name-input', t('settings.roomName'))}
          />
          <button type="submit" className="btn btn-primary" {...ez('settings.room-name-save', t('settings.save'))}>
            {t('settings.save')}
          </button>
        </form>

        <div className="danger-zone">
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} {...ez('settings.delete-room', t('settings.deleteRoom'))}>
            <Trash2 size={16} /> {t('settings.deleteRoom')}
          </button>
        </div>
      </section>

      {confirmDelete && (
        <Modal
          name="delete-room"
          title={t('settings.deleteTitle')}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn-neutral" onClick={() => setConfirmDelete(false)} {...ez('delete-room.cancel', t('settings.cancel'))}>
                <X size={15} /> {t('settings.cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmDelete(false);
                  deleteRoom(room.id);
                  navigate('/rooms');
                  toast(t('settings.roomDeleted'));
                }}
                {...ez('delete-room.confirm', t('settings.delete'), { sensitive: true })}
              >
                <Trash2 size={15} /> {t('settings.delete')}
              </button>
            </>
          }
        >
          <p className="modal-text">{t('settings.deleteBody', { name: room.name })}</p>
        </Modal>
      )}
    </div>
  );
}
