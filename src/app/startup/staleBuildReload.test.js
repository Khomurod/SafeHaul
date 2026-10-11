/**
 * An open tab reloads once when a newer release has replaced its files, and
 * never otherwise: not for a file the network or an extension blocked, not
 * twice for the same release, and not in a build with no release to compare.
 */
import { describe, expect, it, vi } from 'vitest';
import { installStaleBuildReload } from './staleBuildReload';

const RUNNING = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

function fakeWindow({ liveSha = NEWER, fetchImpl, storage = new Map(), storageThrows = false } = {}) {
  const listeners = {};
  const win = {
    listeners,
    addEventListener: vi.fn((type, handler) => { listeners[type] = handler; }),
    fetch: vi.fn(fetchImpl || (async () => ({ ok: true, json: async () => ({ sha: liveSha }) }))),
    sessionStorage: {
      getItem: vi.fn((key) => {
        if (storageThrows) throw new Error('SecurityError');
        return storage.has(key) ? storage.get(key) : null;
      }),
      setItem: vi.fn((key, value) => {
        if (storageThrows) throw new Error('SecurityError');
        storage.set(key, value);
      }),
    },
    location: { reload: vi.fn() },
  };
  return win;
}

const preloadError = (win) => win.listeners['vite:preloadError']({ payload: new TypeError('Failed to fetch dynamically imported module') });

describe('installStaleBuildReload', () => {
  it('reloads once when /release.json names a newer release than the running one', async () => {
    const win = fakeWindow();
    installStaleBuildReload({ win, runningSha: RUNNING });

    await preloadError(win);

    expect(win.fetch).toHaveBeenCalledWith('/release.json', expect.objectContaining({ cache: 'no-store' }));
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the running release is still the live one: the file was blocked, not replaced', async () => {
    const win = fakeWindow({ liveSha: RUNNING });
    installStaleBuildReload({ win, runningSha: RUNNING });

    await preloadError(win);

    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', async () => { throw new TypeError('Failed to fetch'); }],
    ['an error status', async () => ({ ok: false, json: async () => ({}) })],
    ['the app page instead of the manifest', async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
    ['a manifest without a full SHA', async () => ({ ok: true, json: async () => ({ sha: 'b0b' }) })],
  ])('does not reload when the live release cannot be read (%s)', async (_label, fetchImpl) => {
    const win = fakeWindow({ fetchImpl });
    installStaleBuildReload({ win, runningSha: RUNNING });

    await preloadError(win);

    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('reloads at most once per release in a tab, so a reload that brings back the same build cannot loop', async () => {
    const storage = new Map();
    const first = fakeWindow({ storage });
    installStaleBuildReload({ win: first, runningSha: RUNNING });
    await preloadError(first);
    expect(first.location.reload).toHaveBeenCalledTimes(1);

    // The page after the reload, still on the old build: same tab, same storage.
    const second = fakeWindow({ storage });
    installStaleBuildReload({ win: second, runningSha: RUNNING });
    await preloadError(second);
    expect(second.location.reload).not.toHaveBeenCalled();

    // A later release in the same tab is a new release, and may reload once.
    const later = fakeWindow({ storage, liveSha: 'c'.repeat(40) });
    installStaleBuildReload({ win: later, runningSha: NEWER });
    await preloadError(later);
    expect(later.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads for a later release even when the last reload brought back the old build', async () => {
    const storage = new Map();
    const first = fakeWindow({ storage });
    installStaleBuildReload({ win: first, runningSha: RUNNING });
    await preloadError(first);
    expect(first.location.reload).toHaveBeenCalledTimes(1);

    // The reload was served the old build again; then another release goes live.
    const later = fakeWindow({ storage, liveSha: 'c'.repeat(40) });
    installStaleBuildReload({ win: later, runningSha: RUNNING });
    await preloadError(later);
    expect(later.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the tab cannot remember having reloaded', async () => {
    const win = fakeWindow({ storageThrows: true });
    installStaleBuildReload({ win, runningSha: RUNNING });

    await preloadError(win);

    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('asks the server once while a check is in flight, however many files fail together', async () => {
    let answer;
    const win = fakeWindow({ fetchImpl: () => new Promise((resolve) => { answer = resolve; }) });
    installStaleBuildReload({ win, runningSha: RUNNING });

    const first = preloadError(win);
    await preloadError(win);
    answer({ ok: true, json: async () => ({ sha: NEWER }) });
    await first;

    expect(win.fetch).toHaveBeenCalledTimes(1);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it.each([[undefined], [''], ['abc123']])('stays out of builds without a release SHA (%s)', (runningSha) => {
    const win = fakeWindow();
    installStaleBuildReload({ win, runningSha });

    expect(win.addEventListener).not.toHaveBeenCalled();
  });
});
