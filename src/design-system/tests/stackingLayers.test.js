/**
 * Page content must stay below the application chrome it scrolls under.
 *
 * `tokens.test.js` asserts the SCALE — that `raised` < `sticky` < `dropdown` and
 * so on. This file asserts the half the scale cannot state on its own: which rung
 * a given thing is entitled to.
 *
 * The workspace topbar is `position: relative; z-index: var(--ds-z-sticky)`, so
 * it is a stacking context and EVERYTHING it contains is capped at `sticky`
 * against the page — the notifications dropdown included, however high its own
 * `z-ds-dropdown` reads inside that context. So a page-level element that claims
 * `sticky` ties with the whole topbar and wins on DOM order (the page comes
 * after it), and one that claims `dropdown` wins outright.
 *
 * Both happened. The candidate/lead toolbar carried `z-ds-dropdown` and covered
 * the open notifications panel on Driver Applications, Company Leads and My
 * Leads; `DataTable`'s sticky header carried `z-ds-sticky` and did the same
 * wherever a table did not pin its first column (pinning wraps the scroll region
 * in `isolation: isolate`, which had been hiding it). Measured in Chromium
 * before and after: with those two values the toolbar and the header painted
 * over the panel; on `raised` and no layer, the panel is on top.
 *
 * The rule, stated once: application chrome is `sticky`, the page chrome that
 * scrolls beneath it is `raised`, and a real dropdown is `dropdown`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../..');
const read = (relative) => fs.readFileSync(path.resolve(srcRoot, relative), 'utf8');

const layers = new Map(
  [...read('design-system/tokens/foundation.css').matchAll(/--ds-z-([\w-]+)\s*:\s*(\d+);/g)]
    .map((match) => [match[1], Number(match[2])]),
);

const CHROME = layers.get('sticky');

function sourceFiles(dir, extensions) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

describe('stacking layers — page content below application chrome', () => {
  it('reads the scale it is about to compare against', () => {
    expect(layers.get('raised')).toBeLessThan(CHROME);
    expect(CHROME).toBeLessThan(layers.get('dropdown'));
  });

  it('puts the workspace topbar on the chrome rung, which is what caps its dropdowns', () => {
    // If this moves, the ceiling every assertion below is measured against
    // moves with it, and the numbers here stop meaning anything.
    const frame = read('design-system/layouts/workspace/WorkspaceFrame.css');
    expect(frame).toMatch(/\.ds-workspace__topbar\s*\{[^}]*z-index:\s*var\(--ds-z-sticky\)/);
  });

  it('leaves the notifications panel on the dropdown layer', () => {
    // The panel itself was never wrong, and this records that so a future fix
    // is not aimed at it.
    expect(read('features/company-admin/components/NotificationDropdown.jsx'))
      .toMatch(/className="absolute right-0 top-full[^"]*\bz-ds-dropdown\b/);
  });

  it('keeps the candidate/lead toolbar off every chrome rung', () => {
    // Driver Applications, Company Leads and My Leads all render this one
    // toolbar. It overlays nothing — its filter panel expands in flow — so it
    // needs no stacking layer at all.
    const toolbar = read('features/companies/components/DashboardToolbar.jsx');
    const root = toolbar.match(/<div className="(relative[^"]*shrink-0 flex-col[^"]*)"/);
    expect(root).not.toBeNull();
    expect(root[1]).not.toMatch(/\bz-ds-/);
  });

  it('keeps every sticky table header below the chrome rung', () => {
    /*
     * A `<thead>` is unambiguously page content, which is what makes this
     * mechanical rather than a judgement call: no table header may sit on the
     * rung the topbar occupies, or above it. Stated over the whole tree so a
     * new table cannot reintroduce it, and so the fix does not depend on the
     * pinned-column `isolate` that only a pinning table gets.
     *
     * It reads literal class lists, which is every `<thead>` in the tree today
     * and is the same blindness the styled-control rules record: a class list
     * held in a variable would pass unread. Worth knowing rather than assuming
     * the scan is total.
     */
    const offenders = [];

    for (const file of sourceFiles(srcRoot, ['.jsx'])) {
      if (file.includes('.test.') || file.includes('.stories.')) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const [, classList] of source.matchAll(/<thead[^>]*className="([^"]*)"/g)) {
        const layer = classList.match(/\bz-ds-([\w-]+)\b/)?.[1];
        if (layer && layers.get(layer) >= CHROME) {
          offenders.push(`${path.relative(srcRoot, file)} → z-ds-${layer}`);
        }
      }
    }

    for (const file of sourceFiles(srcRoot, ['.css'])) {
      const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, layer] of source.matchAll(/thead\s*\{[^}]*z-index:\s*var\(--ds-z-([\w-]+)\)/g)) {
        if (layers.get(layer) >= CHROME) {
          offenders.push(`${path.relative(srcRoot, file)} → --ds-z-${layer}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
