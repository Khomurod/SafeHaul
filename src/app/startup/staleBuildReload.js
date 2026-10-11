/**
 * Reloads an open tab once when a newer release has replaced the files it needs.
 *
 * Hosting serves only the newest build. A tab opened before a release still
 * runs the old one, and the next screen it opens asks for a file that is gone;
 * Vite reports that as `vite:preloadError`, and the screen failed until the
 * person reloaded by hand. The tab now reloads by itself, but only when
 * `/release.json` names a different release than the one running, so a file
 * blocked by the network or a browser extension never reloads the page; and at
 * most once per release per tab, so a reload that brings back the same build
 * cannot loop. Local and pull-request builds have no release SHA and are left
 * alone.
 */
const RELOADED_FROM_KEY = 'safehaul:reloaded-from-release';
const RELEASE_SHA = /^[0-9a-f]{40}$/;

async function newerReleaseIsLive(win, runningSha) {
  try {
    const response = await win.fetch('/release.json', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const { sha } = await response.json();
    return RELEASE_SHA.test(String(sha)) && sha !== runningSha;
  } catch {
    // Offline, or a host without the manifest: nothing says the build changed.
    return false;
  }
}

/** True once per release per tab; false when storage cannot remember it. */
function claimReload(win, runningSha) {
  try {
    if (win.sessionStorage.getItem(RELOADED_FROM_KEY) === runningSha) return false;
    win.sessionStorage.setItem(RELOADED_FROM_KEY, runningSha);
    return true;
  } catch {
    return false;
  }
}

export function installStaleBuildReload({
  win = window,
  runningSha = import.meta.env.VITE_RELEASE_SHA,
} = {}) {
  if (!RELEASE_SHA.test(String(runningSha))) return;
  let checking = false;
  win.addEventListener('vite:preloadError', async () => {
    // The failed import still reaches its screen's error handling; the reload,
    // when it comes, replaces that screen.
    if (checking) return;
    checking = true;
    try {
      if (await newerReleaseIsLive(win, runningSha) && claimReload(win, runningSha)) {
        win.location.reload();
      }
    } finally {
      checking = false;
    }
  });
}
