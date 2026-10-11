/**
 * How the Firebase config loader tells the page it cannot start.
 *
 * `src/lib/firebase/config.js` reads the Hosting runtime config with a
 * top-level await. When that request fails, every module that imports Firebase
 * fails with it and `main.jsx` never runs, so nothing in the app is left to say
 * so: the page stayed blank. The loader announces the failure on `window`
 * before it throws, and the startup guard (`src/app/startup/startupGuards.jsx`),
 * which runs before any of those modules, shows a screen.
 */
export const STARTUP_FAILED_EVENT = 'safehaul:startup-failed';

export function announceStartupFailure(error, win = globalThis.window) {
  win?.dispatchEvent(new CustomEvent(STARTUP_FAILED_EVENT, { detail: { error } }));
}
