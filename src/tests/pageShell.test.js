import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The application's page ground, and why a test has to hold it.
 *
 * `<body>` in `index.html` is the only thing that paints behind the whole
 * application — `src/index.css` sets a font on `body` and no background, and no
 * component paints the document. Whatever class sits there is the colour a user
 * sees wherever a screen does not paint over it.
 *
 * It carried Tailwind's raw `bg-gray-50` for the entire design-system campaign
 * and was fixed to `bg-ds-canvas` on 2026-09-06. **Neither guard that looks at
 * this file can see it go wrong again**, and both limits were measured rather
 * than assumed:
 *
 * - `check:ui-contract` reaches `index.html` (since 2026-09-05) but its
 *   `raw-palette-class` rule refuses *raw palette* names. Deleting the class
 *   outright, or swapping it for a different `--ds-*` role such as
 *   `bg-ds-surface`, is on-contract and passes.
 * - The pixel lane cannot resolve the change at all. `--ds-color-canvas` is
 *   slate-50 `#f8fafc` and Tailwind's gray-50 is `#f9fafb` — one unit apart on
 *   red and on blue. Run through Playwright's own pixelmatch at the lane's own
 *   `threshold: 0.02` (`e2e/visual/settle.cjs`), two 200x200 fills of those
 *   colours produce **0** differing pixels against a budget of 100; at
 *   `threshold: 0` the same comparison reports all 40,000, so the tolerance is
 *   what absorbs it, not the arithmetic.
 *
 * So the swap was invisible to every automated check the repository has, in
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
});
