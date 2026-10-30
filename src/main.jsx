// First, before anything that loads Firebase: the stale-release reload and the
// startup error screen (`src/app/startup/startupGuards.jsx` says why).
import '@app/startup/startupGuards';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { attachDeferredIntegrations, initSentry, whenIdle } from '@lib/monitoring/sentry';
import { capZoomOnIOS } from '@app/startup/viewportZoom';

// The pdf.js worker wiring lives in `@lib/pdf/pdfWorker`, imported by the PDF
// features themselves, so the pdfjs chunk does not ship to every route.

// --- MONITORING ---
// Sentry starts with error capture only; tracing and Session Replay are attached
// after the page has loaded and the browser is idle, so they stay out of the
// first download (`src/lib/monitoring/sentry.js` explains and tests why).
initSentry();
whenIdle(() => { attachDeferredIntegrations(); });
// -------------------------------

capZoomOnIOS();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
