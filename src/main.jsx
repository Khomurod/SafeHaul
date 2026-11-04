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
import { whenIdle } from '@lib/runtime/whenIdle';
import { capZoomOnIOS } from '@app/startup/viewportZoom';
import { startSpeedMonitoring } from '@app/startup/speedMonitoring';

// The pdf.js worker wiring lives in `@lib/pdf/pdfWorker`, imported by the PDF
// features themselves, so the pdfjs chunk does not ship to every route.

// --- MONITORING ---
// Speed monitoring starts after the page has loaded and the browser is idle,
// from its own chunk, so it stays out of the first download, and only where it
// may (`src/app/startup/speedMonitoring.js`).
whenIdle(() => { startSpeedMonitoring(); });
// -------------------------------

capZoomOnIOS();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
