import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  faBell, faClockRotateLeft, faEllipsis, faFileLines, faGear, faListCheck, faRightFromBracket, faSun, faTableCellsLarge,
  faVideo, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useT } from '../i18n';
import type { I18nKey } from '../i18n';
import { ez } from '../components/esiriProps';
import { logout, useCurrentPerson, useSession } from '../esiri/session';
import { useEsiri } from '../esiri/esiriStore';
import { activate } from '../esiri/controller';
import { useNuru } from '../esiri/nuruStore';
import { Orb } from '../esiri/ui/Orb';
import { orbStateFor } from '../esiri/ui/orbState';
import { useHub } from './hubStore';
import { Fa } from './ui';
import './hub.css';

interface NavItem {
  to: string;
  id: string;
  label: I18nKey;
  icon: IconDefinition;
}

export const HUB_NAV: NavItem[] = [
  { to: '/hub', id: 'today', label: 'hub.nav.today', icon: faSun },
  { to: '/hub/tasks', id: 'tasks', label: 'hub.nav.tasks', icon: faListCheck },
  { to: '/hub/meetings', id: 'meetings', label: 'hub.nav.meetings', icon: faVideo },
  { to: '/hub/minutes', id: 'minutes', label: 'hub.nav.minutes', icon: faFileLines },
  { to: '/hub/notifications', id: 'notifications', label: 'hub.nav.notifications', icon: faBell },
  { to: '/hub/systems', id: 'systems', label: 'hub.nav.systems', icon: faTableCellsLarge },
  { to: '/hub/activity', id: 'activity', label: 'hub.nav.activity', icon: faClockRotateLeft },
  { to: '/hub/settings', id: 'settings', label: 'hub.nav.settings', icon: faGear },
];

/** Tapping the logo 5 times opens the presenter's demo controls (phones). */
function useFiveTaps(): () => void {
  const taps = useRef<number[]>([]);
  return () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      useNuru.getState().setDemoOpen(true);
    }
  };
}

function useOrbState() {
  const status = useEsiri((s) => s.status);
  const micOpen = useEsiri((s) => s.micOpen);
  const errorFlash = useEsiri((s) => s.errorFlash);
  return orbStateFor(status, micOpen, Date.now() - errorFlash < 1200);
}

export function HubOrbButton({ size, className, testid }: { size: number; className: string; testid: string }) {
  const t = useT();
  const state = useOrbState();
  return (
    <button className={className} onClick={() => activate()} aria-label={t('esiri.orbTooltip')} title={t('esiri.orbTooltip')} data-testid={testid}>
      <Orb size={size} state={state} />
    </button>
  );
}

export function HubLayout({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useCurrentPerson();
  const user = useSession((s) => s.user);
  const unread = useHub((s) => s.notifications.filter((n) => !n.read).length);
  const [more, setMore] = useState(false);
  const tap = useFiveTaps();

  useEffect(() => setMore(false), [location.pathname]);

  const signOut = async () => {
    await logout();
    navigate('/hub/login');
  };

  const navLink = (n: NavItem, compact = false) => (
    <NavLink
      key={n.id}
      to={n.to}
      end={n.to === '/hub'}
      className={({ isActive }) => `${compact ? 'bn-item' : 'side-item'} ${isActive ? 'active' : ''}`}
      {...ez(`hub.nav.${n.id}`, t(n.label))}
    >
      <span className="side-ico">
        <Fa icon={n.icon} />
        {n.id === 'notifications' && unread > 0 && <span className="side-badge t-num">{unread}</span>}
      </span>
      <span className="side-label">{t(n.label)}</span>
    </NavLink>
  );

  return (
    <div className="hub">
      {/* Desktop sidebar */}
      <aside className="hub-side">
        <button className="side-logo" onClick={tap} aria-label="NURU" data-testid="hub-logo">
          <img src="/brand/nuru-logo-horizontal.svg" alt="NURU — Msaidizi wako wa kidijitali" />
        </button>
        <nav className="side-nav">{HUB_NAV.map((n) => navLink(n))}</nav>
        <div className="side-talk">
          <HubOrbButton size={44} className="side-orb" testid="hub-side-orb" />
          <div>
            <div className="side-talk-title">{t('hub.talkToNuru')}</div>
            <div className="t-small">Alt + S</div>
          </div>
        </div>
        <div className="side-user">
          <span className="side-avatar">{me.initials}</span>
          <div className="side-user-text">
            <div className="side-user-name">{me.name}</div>
            <div className="side-user-title">{user?.title}</div>
          </div>
          <button className="side-out" onClick={signOut} title={t('hub.signOut')} aria-label={t('hub.signOut')} data-testid="hub-signout">
            <Fa icon={faRightFromBracket} />
          </button>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="hub-top">
        <button className="top-logo" onClick={tap} aria-label="NURU" data-testid="hub-logo-mobile">
          <img src="/brand/nuru-logo-horizontal-dark.svg" alt="NURU" />
        </button>
        <button className="top-bell" onClick={() => navigate('/hub/notifications')} aria-label={t('hub.nav.notifications')}>
          <Fa icon={faBell} />
          {unread > 0 && <span className="side-badge t-num">{unread}</span>}
        </button>
        <span className="side-avatar sm">{me.initials}</span>
      </header>
      <div className="flag-stripe-v2 hub-top-stripe" />

      <main className="hub-main">
        <div className="hub-banner">
          <img className="banner-bg" src="/brand/circuit-header.png" alt="" aria-hidden="true" />
          <div className="banner-badge" aria-hidden="true">
            <img className="banner-ring" src="/brand/badge-ring.gif" alt="" />
            <span className="banner-disc">
              <img src="/brand/ega-logo.png" alt="" />
            </span>
          </div>
          <div className="banner-text">
            <h1 className="banner-title">{title}</h1>
            {subtitle && <div className="banner-sub">{subtitle}</div>}
          </div>
          {actions && <div className="banner-actions">{actions}</div>}
        </div>
        <div className="flag-stripe-v2 banner-stripe" />
        <div className="hub-content" key={location.pathname}>
          <h1 className="t-page phone-title">{title}</h1>
          {children}
        </div>
      </main>

      {/* Phone bottom navigation with the raised orb */}
      <nav className="hub-bottom" aria-label="NURU">
        {navLink(HUB_NAV[0], true)}
        {navLink(HUB_NAV[1], true)}
        <div className="bn-orb-wrap">
          <HubOrbButton size={64} className="bn-orb" testid="hub-nav-orb" />
        </div>
        {navLink(HUB_NAV[2], true)}
        <button className={`bn-item ${more ? 'active' : ''}`} onClick={() => setMore((m) => !m)} data-testid="hub-more">
          <span className="side-ico">
            <Fa icon={more ? faXmark : faEllipsis} />
            {unread > 0 && !more && <span className="side-badge dot" />}
          </span>
          <span className="side-label">{t('hub.nav.more')}</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet" onClick={() => setMore(false)}>
          <div className="more-panel" onClick={(e) => e.stopPropagation()}>
            {HUB_NAV.slice(3).map((n) => navLink(n))}
            <button className="side-item" onClick={signOut}>
              <span className="side-ico">
                <Fa icon={faRightFromBracket} />
              </span>
              <span className="side-label">{t('hub.signOut')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
