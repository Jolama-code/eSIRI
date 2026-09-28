import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { buildSnapshot } from './esiri/snapshot';
import { click, typeText } from './esiri/driver';
import { useEsiri } from './esiri/esiriStore';
import { useApp } from './store/appStore';
import { speak } from './esiri/tts';

// Hooks for automated tests (non-LLM checks of the snapshot and the confirmation gate).
(window as unknown as Record<string, unknown>).__esiriTest = { buildSnapshot, click, typeText, useEsiri, useApp, speak };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
