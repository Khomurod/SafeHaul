/**
 * Reloads an open tab once when a newer release has replaced the files it needs.
 *
 * Hosting serves only the newest build. A tab opened before a release still
 * runs the old one, and the next screen it opens asks for a file that is gone;
 * Vite reports that as `vite:preloadError`, and the screen failed until the
 * person reloaded by hand. The tab now reloads by itself, but only when
 * `/release.json` names a different release than the one running, so a file
 * blocked by the network or a browser extension never reloads the page; and at
 * most once per live release per tab, so a reload that brings back the old
 * build cannot loop, while a later release can still reload the tab. Local and
 * pull-request builds have no release SHA and are left alone.
 */
const RELOADED_TO_KEY = 'safehaul:reloaded-to-release';
const RELEASE_SHA = /^[0-9a-f]{40}$/;

/** The live release's SHA, or null when nothing says which release is live. */
async function liveReleaseSha(win) {
  try {
    const response = await win.fetch('/release.json', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const { sha } = await response.json();
    return RELEASE_SHA.test(String(sha)) ? sha : null;
  } catch {
    // Offline, or a host without the manifest: nothing says the build changed.
    return null;
  }
}

/** True once per live release per tab; false when storage cannot remember it. */
function claimReload(win, liveSha) {
  try {
    if (win.sessionStorage.getItem(RELOADED_TO_KEY) === liveSha) return false;
    win.sessionStorage.setItem(RELOADED_TO_KEY, liveSha);
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
      const liveSha = await liveReleaseSha(win);
      if (liveSha && liveSha !== runningSha && claimReload(win, liveSha)) {
        win.location.reload();
      }
    } finally {
      checking = false;
    }
  });
}
