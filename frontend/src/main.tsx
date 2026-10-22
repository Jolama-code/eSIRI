import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './index.css';
import { buildSnapshot } from './esiri/snapshot';
import { click, selectOption, typeText } from './esiri/driver';
import { useEsiri } from './esiri/esiriStore';
import { useApp } from './store/appStore';
import { speak } from './esiri/tts';
import { useSession } from './esiri/session';
import { useHub } from './hub/hubStore';
import { useNuru } from './esiri/nuruStore';
import { useEvents } from './esiri/events';
import { enableModerator } from './esiri/moderator';

// Hooks for automated tests (non-LLM checks of the snapshot, the confirmation gate and moderator mode).
(window as unknown as Record<string, unknown>).__esiriTest = {
  buildSnapshot, click, typeText, selectOption, useEsiri, useApp, speak, useSession, useHub, useNuru, useEvents, enableModerator,
};

// PWA: cache the app shell (API calls always go to the network; see public/sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
