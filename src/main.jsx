import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { attachSessionReplay, initSentry, whenIdle } from '@lib/monitoring/sentry';

// The pdf.js worker wiring that used to sit here moved to `@lib/pdf/pdfWorker`,
// imported by the PDF features themselves, so the 117 kB pdfjs chunk no longer
// ships to every route (2026-09-06, audit step I).

// --- MONITORING ---
// Sentry starts without Session Replay; the recorder is attached after the page
// has loaded and the browser is idle, so it stays out of the first download
// (`src/lib/monitoring/sentry.js` explains and tests both decisions).
initSentry();
whenIdle(() => { attachSessionReplay(); });
// -------------------------------

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
