/**
 * Two guards that must be listening before anything loads Firebase.
 *
 * This module is the first import of `main.jsx`, and ES modules run in import
 * order, so it runs before the Firebase config request and before the first
 * lazy screen loads. Nothing it imports may import `@lib/firebase`.
 *
 * - A newer release replaced the files an open tab needs: reload it once
 *   (`staleBuildReload.js`).
 * - The Firebase config could not load, so the app cannot start and
 *   `main.jsx` never runs: show a screen instead of a blank page.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { initSentry } from '@lib/monitoring/sentry';
import { STARTUP_FAILED_EVENT } from '@lib/runtime/startupFailure';
import { installStaleBuildReload } from './staleBuildReload';
import { StartupErrorScreen } from './StartupErrorScreen';

export function showStartupError(error, { root = document.getElementById('root') } = {}) {
  // `main.jsx` starts Sentry, and it never ran.
  initSentry();
  Sentry.captureException(error);
  createRoot(root).render(<StartupErrorScreen />);
}

installStaleBuildReload();
window.addEventListener(STARTUP_FAILED_EVENT, (event) => showStartupError(event.detail?.error), { once: true });
