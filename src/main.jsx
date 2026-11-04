// First, before anything that loads Firebase: the stale-release reload and the
// startup error screen (`src/app/startup/startupGuards.jsx` says why).
import '@app/startup/startupGuards';
// Second, with the reload listening: on the driver application's pages, ask for
// the screen's code before React renders (`src/app/startup/warmApplyScreen.js`).
import '@app/startup/warmApplyScreen';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { attachDeferredIntegrations, initSentry, whenIdle } from '@lib/monitoring/sentry';
import { capZoomOnIOS } from '@app/startup/viewportZoom';
import { startSpeedMonitoring } from '@app/startup/speedMonitoring';

// The pdf.js worker wiring lives in `@lib/pdf/pdfWorker`, imported by the PDF
// features themselves, so the pdfjs chunk does not ship to every route.

// --- MONITORING ---
// Sentry starts with error capture only; tracing and Session Replay are attached
// after the page has loaded and the browser is idle, so they stay out of the
// first download (`src/lib/monitoring/sentry.js` explains and tests why). Speed
// monitoring starts then too, from its own chunk, and only where it may
// (`src/app/startup/speedMonitoring.js`).
initSentry();
whenIdle(() => { attachDeferredIntegrations(); startSpeedMonitoring(); });
// -------------------------------

capZoomOnIOS();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
