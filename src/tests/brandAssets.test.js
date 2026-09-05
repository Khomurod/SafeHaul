import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The SafeHaul mark is drawn in three places, and they must stay one mark.
 *
 * `Logo.jsx` and `SafeHaulLoader.jsx` render it as JSX and read their colours
 * from `--ds-color-brand-*`. The favicon in `index.html` cannot: a `data:` URI
 * has no document to resolve a custom property against, so it carries the four
 * values literally. That literal copy is the whole reason this file exists —
 * **it had already drifted.** The favicon's leading facet was a flat
 * `#0CE1A5` where the mark fills that path with a gradient running to
 * `#077B5A`, so the tab icon and the logo were two different pictures and
 * nothing said so.
 *
 * A copy nothing compares is a copy that diverges. These tests are the
 * comparison.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const foundation = read('src/design-system/tokens/foundation.css');
const logo = read('src/shared/components/Logo.jsx');
const loader = read('src/shared/components/SafeHaulLoader.jsx');
const html = read('index.html');

/** The four brand values, as declared. */
const brandTokens = Object.fromEntries(
  [...foundation.matchAll(/(--ds-color-brand-[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)]
    .map((match) => [match[1], match[2].toUpperCase()]),
);

/** The favicon, decoded back into SVG. */
const faviconSvg = decodeURIComponent(
  html.match(/href="(data:image\/svg\+xml,[^"]+)"/)[1].split(',').slice(1).join(','),
);

/*
 * `(?<![\w-])` matters: without it, `d="…"` also matches the `d` at the end of
 * `id="…"`, which quietly compared the gradient's id against a path and made
 * the shape assertion below fail for the wrong reason. Measured while writing
 * this file.
 */
const pathData = (source, quote) => [
  ...source.matchAll(new RegExp(`(?<![\\w-])d=${quote}([^${quote}]+)${quote}`, 'g')),
].map((match) => match[1]);

describe('the brand mark is one mark', () => {
  it('declares exactly the four brand values', () => {
    expect(Object.keys(brandTokens).sort()).toEqual([
      '--ds-color-brand-deep',
      '--ds-color-brand-mint',
      '--ds-color-brand-mint-gradient-end',
      '--ds-color-brand-mint-gradient-start',
    ]);
  });

  // Mutation: change any brand token and this fails until the favicon follows.
  it('draws the favicon from exactly those values, and no others', () => {
    const inFavicon = new Set(
      (faviconSvg.match(/#[0-9A-Fa-f]{6}/g) || []).map((hex) => hex.toUpperCase()),
    );
    expect([...inFavicon].sort()).toEqual([...new Set(Object.values(brandTokens))].sort());
  });

  /*
   * The divergence this file was written for. The favicon must fill the leading
   * facet with the gradient, not with a flat colour — a flat fill is what it had
   * for as long as anyone had looked.
   */
  it('gives the favicon the same gradient the mark has, not a flat fill', () => {
    expect(faviconSvg).toContain('url(#fav)');
    expect(faviconSvg).toMatch(/stop-color='#0CE1A5'/);
    expect(faviconSvg).toMatch(/stop-color='#077B5A'/);
    // A flat fill of the gradient's start colour is exactly the bug.
    expect(faviconSvg).not.toMatch(/fill='#0CE1A5'/);
  });

  it('draws the same shape as the logo, path for path', () => {
    const fromLogo = pathData(logo, '"');
    const fromFavicon = pathData(faviconSvg, "'");
    expect(fromLogo).toHaveLength(4);
    expect(fromFavicon).toEqual(fromLogo);
  });

  /*
   * And the JSX halves must NOT carry literals, or the tokens are decoration.
   * `Logo` and `SafeHaulLoader` render only inside the application, where the
   * token sheet is loaded — verified before this change: neither is reachable
   * from the print or html2canvas export paths, which is the one context where
   * `var()` would resolve to nothing.
   */
  it.each([['Logo.jsx', logo], ['SafeHaulLoader.jsx', loader]])(
    '%s reads its colours from tokens rather than literals',
    (_name, source) => {
      expect(source.match(/#[0-9A-Fa-f]{6}/g)).toBeNull();
      expect(source).toContain('var(--ds-color-brand-deep)');
      expect(source).toContain('var(--ds-color-brand-mint)');
      expect(source).toContain('var(--ds-color-brand-mint-gradient-start)');
      expect(source).toContain('var(--ds-color-brand-mint-gradient-end)');
    },
  );

  /*
   * The gradient geometry has to match too, or the mark's facet catches the
   * light differently at 16px than it does at 150px.
   */
  it('uses the same gradient geometry everywhere', () => {
    for (const source of [logo, loader, faviconSvg]) {
      expect(source).toMatch(/x1=['"]42\.5['"]/);
      expect(source).toMatch(/y1=['"]55['"]/);
      expect(source).toMatch(/x2=['"]83['"]/);
      expect(source).toMatch(/y2=['"]75\.5['"]/);
      expect(source).toMatch(/gradientUnits=['"]userSpaceOnUse['"]/);
    }
  });
});
