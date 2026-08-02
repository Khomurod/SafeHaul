import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import * as Sentry from "@sentry/react";
import { scrub } from "./shared/utils/scrub";

// --- CRITICAL PDF WORKER FIX ---
import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Use local worker file to avoid CDN dependency and production fragility
pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
// -------------------------------

// --- INITIALIZE SENTRY ---
const sentryTraceSampleRate = import.meta.env.PROD
  ? Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.2)
  : 1.0;

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // E1 FIX: Tag events with the build SHA so they resolve against the sourcemaps CI uploads
  // for that release. Undefined in local/PR builds (no release tag) — harmless.
  release: import.meta.env.VITE_RELEASE_SHA || undefined,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  // Performance Monitoring
  tracesSampleRate: Number.isFinite(sentryTraceSampleRate) ? sentryTraceSampleRate : 0.2,
  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  // A5: deep-scrub PII from every event/breadcrumb before it leaves the browser.
  beforeSend: (event) => scrub(event),
  beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
});
// -------------------------------

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
