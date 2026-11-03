/**
 * On the driver application's pages the screen's code is asked for as the app
 * starts; on every other page nothing is. The request's own failure reaches
 * the route (`applyScreenLoader.test.jsx`), never the console as an unhandled
 * rejection.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A plain stand-in, not `vi.fn`: a spy watches the promises it returns, which
// would hide the unhandled rejection that the failed-request test looks for.
const loader = vi.hoisted(() => ({ calls: 0, result: () => Promise.resolve({}) }));
vi.mock('@app/routes/applyScreenLoader', () => ({
  loadPublicApplyHandler: () => {
    loader.calls += 1;
    return loader.result();
  },
}));

describe('apply screen warm-up', () => {
  let startPath;

  beforeEach(() => {
    startPath = window.location.pathname;
    vi.resetModules();
    loader.calls = 0;
    loader.result = () => Promise.resolve({});
  });

  afterEach(() => {
    window.history.replaceState(null, '', startPath);
  });

  // As `main.jsx` loads it: the module reads the address bar when it runs.
  const loadAt = async (pathname) => {
    window.history.replaceState(null, '', pathname);
    await import('./warmApplyScreen');
  };

  it.each(['/apply/acme', '/apply/acme/', '/interest/acme', '/sandbox/apply'])(
    'asks for the screen code once as it loads on %s',
    async (pathname) => {
      await loadAt(pathname);
      expect(loader.calls).toBe(1);
    },
  );

  it.each([
    '/',
    '/login',
    '/company/dashboard',
    '/sign/acme/request-1',
    '/verify/token-1',
    '/review-change/token-1',
    '/sandbox/transfer-success',
    '/developers/api',
    '/apply',
  ])('asks for nothing on %s', async (pathname) => {
    await loadAt(pathname);
    expect(loader.calls).toBe(0);
  });

  it('keeps a failed request from becoming an unhandled rejection', async () => {
    loader.result = () => Promise.reject(new Error('chunk failed'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await loadAt('/apply/acme');
      // Node reports an unhandled rejection after the microtasks of a task.
      await new Promise((settle) => { setTimeout(settle, 0); });
      expect(loader.calls).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('is the second import of main.jsx: after the startup guards, before the app', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    const imports = main.split('\n').filter((line) => /^import\b/.test(line));
    expect(imports.slice(0, 2)).toEqual([
      "import '@app/startup/startupGuards';",
      "import '@app/startup/warmApplyScreen';",
    ]);
  });
});
