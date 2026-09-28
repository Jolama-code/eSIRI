import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileClock, LogOut, RotateCcw } from 'lucide-react';
import { useT } from '../i18n';
import { useApp } from '../store/appStore';
import { CURRENT_USER } from '../store/data';
import { ez } from './esiriProps';
import { newConversation } from '../esiri/controller';
import './Header.css';

export function FlagStripe() {
  return (
    <div className="flag-stripe" aria-hidden="true">
      <span className="g" />
      <span className="y" />
      <span className="k" />
      <span className="y" />
      <span className="b" />
    </div>
  );
}

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`wordmark wordmark-${size}`} aria-label="e-Mikutano">
      <span className="wm-e">e</span>
      <span className="wm-rest">Mikutano</span>
    </span>
  );
}

function NetworkDots() {
  // A faint "network of people" pattern, like the real header background.
  const nodes: [number, number][] = [
    [20, 30], [70, 12], [110, 50], [160, 22], [210, 60], [250, 18], [300, 44], [40, 80], [130, 95], [190, 110],
    [260, 92], [320, 100], [360, 30], [90, 120],
  ];
  const links: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [0, 7], [7, 2], [2, 8], [8, 9], [9, 4], [9, 10], [10, 6], [10, 11], [6, 12], [8, 13], [7, 13], [3, 5],
  ];
  return (
    <svg className="network-dots" viewBox="0 0 380 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {links.map(([a, b], i) => (
        <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={3.2} />
          <circle cx={x} cy={y - 7} r={2} />
        </g>
      ))}
    </svg>
  );
}

export function FullHeader() {
  const t = useT();
  return (
    <header className="full-header">
      <div className="full-header-bg">
        <NetworkDots />
        <NetworkDots />
      </div>
      <div className="full-header-inner">
        <img className="coat-lg" src="/assets/tanzania-coat-of-arms.svg" alt="Coat of arms of Tanzania" />
        <div className="full-header-titles">
          <h1 className="gov-title">{t('header.title')}</h1>
          <div className="gov-subtitle">{t('header.subtitle')}</div>
        </div>
        <Wordmark size="lg" />
      </div>
      <FlagStripe />
    </header>
  );
}

function UserMenu() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signOut = useApp((s) => s.signOut);
  const resetDemo = useApp((s) => s.resetDemo);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        {...ez('header.user-menu', CURRENT_USER.name, { state: open ? 'open' : 'closed' })}
      >
        <span className="avatar">{CURRENT_USER.initials}</span>
        <span className="user-name">{CURRENT_USER.name}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/audit');
            }}
            {...ez('header.menu.audit-log', t('header.auditLog'))}
          >
            <FileClock size={16} /> {t('header.auditLog')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              newConversation();
              resetDemo();
              navigate('/rooms');
              toast(t('header.resetDone'));
            }}
            {...ez('header.menu.reset-demo', t('header.resetDemo'))}
          >
            <RotateCcw size={16} /> {t('header.resetDemo')}
          </button>
          <div className="menu-sep" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
              navigate('/');
            }}
            {...ez('header.menu.sign-out', t('header.signOut'))}
          >
            <LogOut size={16} /> {t('header.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

export function CompactHeader() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <header className="compact-header">
      <div className="compact-inner container">
        <button className="brand" onClick={() => navigate('/rooms')} {...ez('header.home', t('header.home'))}>
          <img className="coat-sm" src="/assets/tanzania-coat-of-arms.svg" alt="" />
          <Wordmark />
        </button>
        <UserMenu />
      </div>
      <FlagStripe />
    </header>
  );
}

export function PageFooter() {
  return (
    <footer className="page-footer">
      <span>e-Mikutano</span> · <span>e-Government Authority (e-GA)</span>
    </footer>
  );
}
