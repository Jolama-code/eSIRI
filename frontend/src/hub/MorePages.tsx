import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  faArrowRight, faBell, faCheckDouble, faClockRotateLeft, faEnvelope, faFileLines, faGear, faListCheck, faMobileScreen,
  faRightFromBracket, faUser, faVideo, faChartColumn, faCircleCheck, faCircleXmark, faBan, faTriangleExclamation,
  faDownload,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useT, useLang } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { api, logout, patchMe, useSession } from '../esiri/session';
import { useApp, type AuditRecord } from '../store/appStore';
import { useHub } from './hubStore';
import { HubLayout } from './HubLayout';
import { Card, Empty, Fa, IconShape, Skeleton, dateTime } from './ui';

// ---------------------------------------------------------------------------
// Notifications

const NOTE_ICON: Record<string, IconDefinition> = {
  reminder: faBell,
  task_assigned: faListCheck,
  task_updated: faListCheck,
  mail_received: faEnvelope,
  katibu_ready: faFileLines,
  katibu_sent: faFileLines,
  katibu_failed: faTriangleExclamation,
};

export function Notifications() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const rows = useHub((s) => s.notifications);
  const loaded = useHub((s) => s.notificationsLoaded);
  useEffect(() => {
    void useHub.getState().loadNotifications();
  }, []);
  const readAll = async () => {
    await api('/api/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    void useHub.getState().loadNotifications();
  };
  return (
    <HubLayout
      title={t('hub.nav.notifications')}
      subtitle={t('notifications.subtitle')}
      actions={
        <button className="hbtn light" onClick={() => void readAll()} {...ez('hub.notifications.read-all', t('notifications.readAll'))}>
          <Fa icon={faCheckDouble} /> {t('notifications.readAll')}
        </button>
      }
    >
      <Card i={1}>
        {!loaded ? (
          <Skeleton h={60} />
        ) : !rows.length ? (
          <Empty icon={faBell} text={t('notifications.empty')} />
        ) : (
          <div className="hlist">
            {rows.map((n, i) => (
              <div
                key={n.id}
                className={`hrow rise ${n.read ? '' : 'unread'}`}
                style={{ ['--i' as string]: Math.min(i, 12), cursor: n.link ? 'pointer' : 'default' }}
                data-testid="notification-row"
                onClick={() => {
                  void api(`/api/notifications/${n.id}/read`, { method: 'POST' }).then(() => useHub.getState().loadNotifications());
                  if (n.link) navigate(n.link);
                }}
              >
                <IconShape icon={NOTE_ICON[n.kind] ?? faBell} tone={n.read ? 'frost' : 'navy'} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div className="hrow-title">{lang === 'sw' ? n.title_sw : n.title_en}</div>
                  <div className="hrow-sub">{lang === 'sw' ? n.body_sw : n.body_en}</div>
                </div>
                <div className="hrow-side">
                  <span className="t-small">{dateTime(n.created_at, lang)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </HubLayout>
  );
}

// ---------------------------------------------------------------------------
// Systems

export function Systems() {
  const t = useT();
  const tiles = [
    { to: '/rooms', cls: 'sys-mikutano', icon: faVideo, title: 'e-Mikutano', text: t('systems.mikutano'), id: 'mikutano' },
    { to: '/gms/inbox', cls: 'sys-gms', icon: faEnvelope, title: 'GMS', text: t('systems.gms'), id: 'gms' },
    { to: '/weris', cls: 'sys-weris', icon: faChartColumn, title: 'WERIS', text: t('systems.weris'), id: 'weris' },
  ];
  return (
    <HubLayout title={t('hub.nav.systems')} subtitle={t('systems.subtitle')}>
      <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {tiles.map((x, i) => (
          <Link key={x.id} to={x.to} className={`sys-tile rise ${x.cls}`} style={{ ['--i' as string]: i }} data-testid={`system-${x.id}`} {...ez(`hub.systems.${x.id}`, x.title)}>
            <IconShape icon={x.icon} tone="white" size={48} />
            <h3>{x.title}</h3>
            <p>{x.text}</p>
            <span className="go">
              {t('systems.open')} <Fa icon={faArrowRight} />
            </span>
          </Link>
        ))}
      </div>
      <Card i={4}>
        <p className="t-small" style={{ margin: 0 }}>{t('systems.sso')}</p>
      </Card>
    </HubLayout>
  );
}

// ---------------------------------------------------------------------------
// Activity (server audit log for this user)

const OUTCOME_ICON: Record<string, IconDefinition> = {
  Completed: faCircleCheck,
  Declined: faCircleXmark,
  Cancelled: faBan,
  Failed: faTriangleExclamation,
};
const OUTCOME_TONE: Record<string, 'green' | 'frost' | 'red'> = { Completed: 'green', Declined: 'frost', Cancelled: 'frost', Failed: 'red' };

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function Activity() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  useEffect(() => {
    void api<AuditRecord[]>('/api/audit').then(setRows).catch(() => setRows([]));
  }, []);
  const shown = (rows ?? []).filter((r) => filter === 'all' || r.outcome === filter);
  const exportCsv = () => {
    const head = ['timestamp', 'system', 'user', 'language', 'input', 'request', 'outcome', 'confirmations', 'steps', 'final_message', 'duration_ms'];
    const lines = (rows ?? []).map((r) =>
      [r.timestamp, r.system ?? '', r.user, r.language, r.inputMode, r.request, r.outcome,
        r.confirmations.map((c) => `${c.summary} → ${c.result}`).join(' | '), r.steps.map((s) => `${s.tool}:${s.target}${s.ok ? '' : ' (failed)'}`).join(' | '),
        r.finalMessage, r.durationMs].map(csvCell).join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nuru-activity.csv';
    a.click();
  };
  return (
    <HubLayout
      title={t('hub.nav.activity')}
      subtitle={t('activity.subtitle')}
      actions={
        <button className="hbtn light" onClick={exportCsv} {...ez('hub.activity.export', t('activity.export'))}>
          <Fa icon={faDownload} /> {t('activity.export')}
        </button>
      }
    >
      <div className="tabs">
        {['all', 'Completed', 'Declined', 'Cancelled', 'Failed'].map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} {...ez(`hub.activity.filter.${f.toLowerCase()}`, t(`activity.filter.${f}` as I18nKey), { state: filter === f ? 'selected' : 'unselected' })}>
            {t(`activity.filter.${f}` as I18nKey)}
          </button>
        ))}
      </div>
      <Card i={1}>
        {rows === null ? (
          <Skeleton h={60} />
        ) : !shown.length ? (
          <Empty icon={faClockRotateLeft} text={t('activity.empty')} />
        ) : (
          <div className="hlist">
            {shown.map((r, i) => (
              <div key={r.id} className="hrow rise" style={{ ['--i' as string]: Math.min(i, 12), cursor: 'pointer', alignItems: 'start' }} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid="activity-row">
                <IconShape icon={OUTCOME_ICON[r.outcome] ?? faCircleCheck} tone={OUTCOME_TONE[r.outcome] ?? 'frost'} size={38} />
                <div style={{ minWidth: 0 }}>
                  <div className="hrow-title">{r.request}</div>
                  <div className="hrow-sub">
                    {dateTime(r.timestamp, lang)} · {(r.system ?? 'mikutano').toUpperCase()} · {r.inputMode === 'voice' ? t('esiri.inputVoice') : r.inputMode === 'auto' ? t('activity.auto') : t('esiri.inputText')}
                  </div>
                  {open === r.id && (
                    <div className="act-steps">
                      {r.confirmations.map((c, k) => (
                        <div key={`c${k}`}>🛡 “{c.summary}” → {t(c.result === 'approved' ? 'esiri.approved' : c.result === 'changed' ? 'esiri.changed' : 'esiri.declined')}</div>
                      ))}
                      {r.steps.map((s, k) => (
                        <div key={`s${k}`}>
                          {s.ok ? '✓' : '✗'} {s.tool} · {s.target}
                          {s.text ? ` · “${s.text}”` : ''}
                          {s.error ? ` · ${s.error}` : ''}
                        </div>
                      ))}
                      {r.finalMessage && <div>💬 {r.finalMessage}</div>}
                    </div>
                  )}
                </div>
                <div className="hrow-side">
                  <span className={`chip ${r.outcome === 'Completed' ? 'green' : r.outcome === 'Failed' ? 'red' : ''}`} data-testid="activity-outcome">{t(`activity.filter.${r.outcome}` as I18nKey)}</span>
                  <span className="t-small t-num">{(r.durationMs / 1000).toFixed(1)} s</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </HubLayout>
  );
}

// ---------------------------------------------------------------------------
// Settings

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

function Switch({ on, onClick, id, label }: { on: boolean; onClick: () => void; id: string; label: string }) {
  return <button className={`hswitch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick} {...ez(id, label, { state: on ? 'on' : 'off' })} />;
}

export function Settings() {
  const t = useT();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const language = useApp((s) => s.language);
  const setLanguage = useApp((s) => s.setLanguage);
  const wakeMode = useApp((s) => s.wakeMode);
  const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [installNote, setInstallNote] = useState('');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;

  if (!user) return null;
  const install = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const r = await deferredPrompt.userChoice;
      setInstallNote(r.outcome === 'accepted' ? t('settings.installed') : '');
      deferredPrompt = null;
    } else setInstallNote(ios ? t('settings.installIos') : standalone ? t('settings.installed') : t('settings.installManual'));
  };
  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  };

  return (
    <HubLayout title={t('hub.nav.settings')} subtitle={t('settings.subtitle')}>
      <div className="grid-2">
        <Card i={1}>
          <div className="hcard-head">
            <IconShape icon={faUser} tone="navy" size={38} shape="tile" />
            <h2 className="t-section">{t('settings.profile')}</h2>
          </div>
          <div className="set-row">
            <span className="side-avatar">{user.display_name.split(/\s+/).map((w) => w[0]).slice(-2).join('').toUpperCase()}</span>
            <div className="set-text">
              <div className="set-title" data-testid="profile-name">{user.display_name}</div>
              <div className="set-desc">{user.title}</div>
              <div className="set-desc">{user.email} · @{user.username} · {t(`role.${user.role}` as I18nKey)}</div>
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.install')}</div>
              <div className="set-desc">{t('settings.installDesc')}</div>
              {installNote && <div className="set-desc" data-testid="install-note">{installNote}</div>}
            </div>
            <button className="hbtn sm" onClick={() => void install()} data-testid="install-app">
              <Fa icon={faMobileScreen} /> {t('settings.install')}
            </button>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.notifications')}</div>
              <div className="set-desc">{t(`settings.perm.${perm}` as I18nKey)}</div>
            </div>
            <button className="hbtn sm ghost" onClick={() => void enableNotifications()} disabled={perm === 'granted' || perm === 'unsupported'} data-testid="enable-notifications">
              <Fa icon={faBell} /> {t('settings.notifications')}
            </button>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('hub.signOut')}</div>
            </div>
            <button
              className="hbtn sm danger"
              onClick={async () => {
                await logout();
                navigate('/hub/login');
              }}
              data-testid="settings-signout"
            >
              <Fa icon={faRightFromBracket} /> {t('hub.signOut')}
            </button>
          </div>
        </Card>
        <Card i={2}>
          <div className="hcard-head">
            <IconShape icon={faGear} tone="navy" size={38} shape="tile" />
            <h2 className="t-section">{t('settings.nuru')}</h2>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.language')}</div>
            </div>
            <div className="seg">
              <button className={language === 'sw' ? 'on' : ''} onClick={() => setLanguage('sw')} {...ez('settings.language.sw', 'Kiswahili', { state: language === 'sw' ? 'selected' : 'unselected' })}>Kiswahili</button>
              <button className={language === 'en' ? 'on' : ''} onClick={() => setLanguage('en')} {...ez('settings.language.en', 'English', { state: language === 'en' ? 'selected' : 'unselected' })}>English</button>
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.voice')}</div>
              <div className="set-desc">{t('settings.voiceDesc')}</div>
            </div>
            <Switch on={user.voice_enabled} onClick={() => void patchMe({ voice_enabled: !user.voice_enabled })} id="settings.voice" label={t('settings.voice')} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.lead')}</div>
              <div className="set-desc">{t('settings.leadDesc')}</div>
            </div>
            <div className="seg">
              {[2, 5, 10, 15].map((m) => (
                <button key={m} className={user.reminder_lead_min === m ? 'on' : ''} onClick={() => void patchMe({ reminder_lead_min: m })} data-testid={`lead-${m}`} {...ez(`settings.lead.${m}`, `${m}`, { state: user.reminder_lead_min === m ? 'selected' : 'unselected' })}>
                  {m} {t('settings.min')}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.audioSource')}</div>
              <div className="set-desc">{t('settings.audioSourceDesc')}</div>
            </div>
            <div className="seg">
              {(['live', 'sample'] as const).map((v) => (
                <button key={v} className={user.meeting_audio_source === v ? 'on' : ''} onClick={() => void patchMe({ meeting_audio_source: v })} data-testid={`audio-${v}`} {...ez(`settings.audio.${v}`, v, { state: user.meeting_audio_source === v ? 'selected' : 'unselected' })}>
                  {t(v === 'live' ? 'settings.audioLive' : 'settings.audioSample')}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-text">
              <div className="set-title">{t('settings.wake')}</div>
              <div className="set-desc">{t('settings.wakeDesc')}</div>
            </div>
            <Switch
              on={wakeMode}
              onClick={() => {
                useApp.getState().setWakeMode(!wakeMode);
                void patchMe({ wake_word: !wakeMode });
              }}
              id="settings.wake"
              label={t('settings.wake')}
            />
          </div>
        </Card>
      </div>
    </HubLayout>
  );
}
