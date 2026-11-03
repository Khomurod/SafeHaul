import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { rawValuesIn } from '../../scripts/eslint-rules/raw-values.mjs';

/**
 * The application's page ground, and why a test has to hold it.
 *
 * `<body>` in `index.html` is the only thing that paints behind the whole
 * application — `src/index.css` sets a font on `body` and no background, and no
 * component paints the document. Whatever class sits there is the colour a user
 * sees wherever a screen does not paint over it.
 *
 * It is `bg-ds-canvas`, not Tailwind's raw `bg-gray-50`. **Neither guard that
 * looks at this file can see it go wrong**, and both limits were measured
 * rather than assumed:
 *
 * - No lint rule reads `index.html`, and a raw palette name would be the only
 *   thing one could refuse there. Deleting the class outright, or swapping it
 *   for a different `--ds-*` role such as `bg-ds-surface`, is on-contract and
 *   passes.
 * - The pixel lane cannot resolve the change at all. `--ds-color-canvas` is
 *   slate-50 `#f8fafc` and Tailwind's gray-50 is `#f9fafb` — one unit apart on
 *   red and on blue. Run through Playwright's own pixelmatch at the lane's own
 *   `threshold: 0.02` (`e2e/visual/settle.cjs`), two 200x200 fills of those
 *   colours produce **0** differing pixels against a budget of 100; at
 *   `threshold: 0` the same comparison reports all 40,000, so the tolerance is
 *   what absorbs it, not the arithmetic.
 *
 * So the swap is invisible to every automated check the repository has, in
 * both directions. That is precisely the shape of thing that needs a test
 * naming the intended value.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const semantic = fs.readFileSync(
  path.join(repoRoot, 'src/design-system/tokens/semantic.css'),
  'utf8',
);

const bodyClasses = (html.match(/<body class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);

describe('the application page shell', () => {
  it('paints the page ground with the canvas role', () => {
    expect(bodyClasses).toContain('bg-ds-canvas');
  });

  /*
   * Not "contains no raw palette class" — the contract guard already refuses
   * those. This refuses a SECOND background of any kind, token or not, because
   * two background utilities on one element is a silent last-one-wins.
   */
  it('paints it exactly once', () => {
    const backgrounds = bodyClasses.filter((name) => /^bg-/.test(name));
    expect(backgrounds).toEqual(['bg-ds-canvas']);
  });

  /* The role has to exist, or the class compiles to `var()` with nothing behind it. */
  it('resolves that role to a declared token', () => {
    expect(semantic).toMatch(/--ds-color-canvas:\s*var\(--ds-color-[\w-]+\)\s*;/);
  });

  /*
   * Tailwind compiles `index.html` like any component, and the strict theme
   * cannot refuse an arbitrary value: the shell is held to the raw-value rules
   * `ds/no-raw-values` reads JavaScript with. The fixture is built, not
   * written, so Tailwind's scan of this file does not compile it.
   */
  it('carries no raw colour, arbitrary type size or unnamed layer', () => {
    const shell = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(rawValuesIn(shell).map((found) => found.match)).toEqual([]);
    const broken = shell.replace('class="bg-ds-canvas"', `class="bg-ds-canvas ${['text', '[10px]'].join('-')}"`);
    expect(rawValuesIn(broken).map((found) => found.check)).toEqual(['sub-12px-type']);
  });
});

/*
 * The start-up splash: the mark on the page ground, painted from the HTML and
 * its stylesheet while the app's code downloads (T1 measured about 2.8 s of
 * white on a phone). This file serves every route and the CSP refuses an
 * inline script, so it is one neutral picture for every page: no words, no
 * heading, no announcement. The app's own loaders announce. The mark is sized
 * by its `width`/`height` attributes, not utilities, so it stays 80px before
 * any stylesheet applies (the dev server injects styles from script), and it
 * stays invisible until then (`brandAssets.test.jsx`).
 */
const doc = new DOMParser().parseFromString(html, 'text/html');
const root = doc.getElementById('root');
const splash = doc.getElementById('startup-splash');
// What ships: the source from `#root` to the entry script.
const rootSource = html.slice(html.indexOf('<div id="root">'), html.indexOf('<script type="module"'));

describe('the start-up splash', () => {
  it('sits alone inside #root, which the first render empties', () => {
    expect(splash?.parentElement).toBe(root);
    expect(root.children).toHaveLength(1);
  });

  it('is decorative: hidden, with no words, heading, live region or control', () => {
    expect(splash.getAttribute('aria-hidden')).toBe('true');
    expect(splash.textContent.trim()).toBe('');
    const announcing = 'h1, h2, h3, h4, h5, h6, [role], [aria-live], [tabindex], a, button, input, select, textarea';
    expect(splash.querySelectorAll(announcing)).toHaveLength(0);
  });

  it('runs no script: the page has one, the module entry, and it is not inline', () => {
    expect(splash.querySelector('script')).toBeNull();
    const scripts = [...doc.querySelectorAll('script')].map((node) => [node.getAttribute('type'), node.getAttribute('src')]);
    expect(scripts).toEqual([['module', '/src/main.jsx']]);
  });

  /* `searchIndexing.js` marks Testing noindex only when the page has no robots meta of its own. */
  it('brings no robots meta', () => {
    expect(html).not.toMatch(/<meta[^>]*name=["']?robots/i);
  });

  it('holds no raw value of its own and stays small', () => {
    expect(rawValuesIn(rootSource.replace(/<!--[\s\S]*?-->/g, ''))).toEqual([]);
    expect(Buffer.byteLength(rootSource, 'utf8')).toBeLessThanOrEqual(2048);
  });

  /*
   * React 19 sets the root's `textContent` to '' on its first commit. Were that
   * to change, the splash would stay above the app, a screen tall.
   */
  it('is gone after the app’s first render', async () => {
    const container = document.createElement('div');
    container.innerHTML = root.innerHTML;
    document.body.appendChild(container);
    expect(container.querySelector('#startup-splash')).not.toBeNull();
    const app = createRoot(container);
    try {
      await act(async () => { app.render(React.createElement('p', null, 'App')); });
      expect(container.querySelector('#startup-splash')).toBeNull();
      expect(container.textContent).toBe('App');
    } finally {
      act(() => { app.unmount(); });
      container.remove();
    }
  });
});
