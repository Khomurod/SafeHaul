/**
 * When the Firebase config cannot load, the page shows a way forward instead of
 * staying blank; and both startup guards are in place before anything loads
 * Firebase.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { STARTUP_FAILED_EVENT, announceStartupFailure } from '@lib/runtime/startupFailure';
import { StartupErrorScreen } from './StartupErrorScreen';

const mocks = vi.hoisted(() => ({
  installStaleBuildReload: vi.fn(),
  keepNonCanonicalHostsOutOfSearch: vi.fn(),
}));
vi.mock('./searchIndexing', () => ({ keepNonCanonicalHostsOutOfSearch: mocks.keepNonCanonicalHostsOutOfSearch }));
vi.mock('./staleBuildReload', () => ({ installStaleBuildReload: mocks.installStaleBuildReload }));

describe('startup guards', () => {
  beforeAll(async () => {
    await import('./startupGuards');
  });

  it('installs the stale-release reload as soon as it loads', () => {
    expect(mocks.installStaleBuildReload).toHaveBeenCalledTimes(1);
  });

  it('marks non-production hosts noindex from the first module, the startup error screen included', () => {
    expect(mocks.keepNonCanonicalHostsOutOfSearch).toHaveBeenCalledTimes(1);
  });

  it('shows the startup error screen, and logs the failure, when the config loader announces one', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    // As the page arrives: `index.html`'s start-up splash fills the root.
    const page = new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'), 'text/html');
    root.innerHTML = page.getElementById('root').innerHTML;
    expect(root.querySelector('#startup-splash')).not.toBeNull();
    document.body.appendChild(root);
    const failure = new Error('[firebase] Firebase Hosting runtime configuration returned HTTP 503.');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await act(async () => { announceStartupFailure(failure, window); });

      const alert = await screen.findByRole('alert');
      expect(root.contains(alert)).toBe(true);
      // The error screen replaces the splash rather than drawing below it.
      expect(root.querySelector('#startup-splash')).toBeNull();
      expect(alert).toHaveTextContent('This page could not load');
      expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('[startup] The app could not start:', failure);

      // Once: a second announcement does not mount a second screen.
      await act(async () => { window.dispatchEvent(new CustomEvent(STARTUP_FAILED_EVENT, { detail: { error: failure } })); });
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
      // Mounted by the guard, not by `render`, so the shared cleanup misses it.
      root.remove();
    }
  });

  it('runs before anything that loads Firebase: it is the first import of main.jsx', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    const firstImport = main.split('\n').find((line) => /^import\b/.test(line));
    expect(firstImport).toBe("import '@app/startup/startupGuards';");
  });
});

describe('StartupErrorScreen', () => {
  it('reloads the page from its one action', () => {
    const onReload = vi.fn();
    render(<StartupErrorScreen onReload={onReload} />);

    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
