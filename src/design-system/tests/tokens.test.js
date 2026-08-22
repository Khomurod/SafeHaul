import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../../tailwind.config.js';

const tokenRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tokens');
const tokenSource = ['foundation.css', 'semantic.css']
  .map((file) => fs.readFileSync(path.join(tokenRoot, file), 'utf8'))
  .join('\n');

function customProperties(source) {
  return new Map(
    [...source.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)]
      .map((match) => [match[1], match[2].trim()]),
  );
}

const tokens = customProperties(tokenSource);

function resolveToken(name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token reference: ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  const reference = value?.match(/^var\(--([\w-]+)\)$/);
  return reference ? resolveToken(reference[1], seen) : value;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('design tokens', () => {
  it('keeps supported interface type at 12px or larger', () => {
    const sizes = [...tokens.entries()]
      .filter(([name]) => name.startsWith('ds-font-size-'))
      .map(([, value]) => Number.parseFloat(value));

    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it.each([
    ['content', 'surface'],
    ['content-secondary', 'surface'],
    ['content-muted', 'surface'],
    // `content-muted` moved from slate-500 to slate-600 on 2026-08-21 so it is
    // safe wherever it lands, replacing a rule that said "approved on `surface`
    // only" — a rule three real axe violations proved was too easy to forget.
    ['content-muted', 'surface-subtle'],
    ['content-muted', 'canvas'],
    ['content-muted', 'status-info-bg'],
    ['content-muted', 'status-success-bg'],
    ['content-muted', 'status-warning-bg'],
    ['content-muted', 'status-danger-bg'],
    ['content-muted', 'status-neutral-bg'],
    ['content-muted', 'status-accent-bg'],
    ['content-inverse', 'action-primary'],
    ['content-inverse', 'action-danger'],
    ['status-info-fg', 'status-info-bg'],
    ['status-accent-fg', 'status-accent-bg'],
    ['status-success-fg', 'status-success-bg'],
    ['status-warning-fg', 'status-warning-bg'],
    ['status-danger-fg', 'status-danger-bg'],
    ['status-neutral-fg', 'status-neutral-bg'],
    // `surface-subtle` is a real background in the product (card headers,
    // confirmation panels, review rows), so the content colours used on it need
    // the same guarantee as the ones used on `surface`.
    ['content', 'surface-subtle'],
    ['content-secondary', 'surface-subtle'],
    ['content-link', 'surface-subtle'],
    ['content', 'canvas'],
    ['content-secondary', 'canvas'],
    // Inverse (dark) console surface role. Every foreground the product puts on
    // it — body, muted, and the four log severities — is verified here, because
    // the hand-rolled dark panels this replaced included a 2.2:1 pairing.
    ['content-on-inverse', 'surface-inverse'],
    ['content-on-inverse-muted', 'surface-inverse'],
    ['content-on-inverse', 'surface-inverse-subtle'],
    ['content-on-inverse-muted', 'surface-inverse-subtle'],
    ['status-info-fg-on-inverse', 'surface-inverse'],
    ['status-success-fg-on-inverse', 'surface-inverse'],
    ['status-warning-fg-on-inverse', 'surface-inverse'],
    ['status-danger-fg-on-inverse', 'surface-inverse'],
  ])('%s on %s meets WCAG AA normal-text contrast', (foreground, background) => {
    const ratio = contrast(
      resolveToken(`ds-color-${foreground}`),
      resolveToken(`ds-color-${background}`),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The pairing that used to be forbidden.
   *
   * `content-muted` was slate-500, which measured 4.34:1 on `surface-subtle` and
   * 4.27:1 on `status-warning-bg`. It was therefore approved on plain `surface`
   * only, and every other muted label had to remember `content-secondary`
   * instead — a rule that failed three times in real axe scans.
   *
   * This test is the replacement for the one that pinned that gap. It names the
   * two specific pairings that used to fail, so a future change that darkens a
   * surface or lightens the token back cannot quietly reopen the hole. The
   * `it.each` block above covers the same ground; this one records *why* these
   * two matter.
   */
  it.each([
    ['surface-subtle', 4.34],
    ['status-warning-bg', 4.27],
  ])('content-muted now clears AA on %s, which used to measure %s:1', (background) => {
    const ratio = contrast(
      resolveToken('ds-color-content-muted'),
      resolveToken(`ds-color-${background}`),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * One control-height scale, shared by every control the design system owns.
   *
   * `.ds-form-control` hardcoded 44px while `Button`'s `md` was 40px, so an input
   * and the button beside it never lined up. That is the defect this asserts is
   * gone: the form control must read its height from the same token the button
   * does, and `md` must be the value both of them default to.
   */
  describe('control height scale', () => {
    // Comments are stripped before matching. These files explain the defect they
    // fixed in prose, and the first version of the assertion below matched the
    // `min-height: 44px` inside its own explanation.
    const readCss = (relative) => fs
      .readFileSync(path.resolve(tokenRoot, relative), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const buttonCss = readCss('../components/button/Button.css');
    const formCss = readCss('../components/form/FormControls.css');

    it('orders the three steps and keeps the default at the 44px target size', () => {
      const sm = Number.parseFloat(resolveToken('ds-control-height-sm'));
      const md = Number.parseFloat(resolveToken('ds-control-height-md'));
      const lg = Number.parseFloat(resolveToken('ds-control-height-lg'));

      expect(sm).toBeLessThan(md);
      expect(md).toBeLessThan(lg);
      // WCAG 2.2 SC 2.5.5 Target Size (Enhanced). The default, not an opt-in.
      expect(md).toBeGreaterThanOrEqual(44);
    });

    it('gives the form control and the default button the same height token', () => {
      expect(formCss).toMatch(/\.ds-form-control\s*\{[^}]*min-height:\s*var\(--ds-control-height-md\)/);
      expect(buttonCss).toMatch(/\.ds-button\[data-size='md'\]\s*\{[^}]*min-height:\s*var\(--ds-control-height-md\)/);
    });

    it('leaves no hardcoded pixel height on a control', () => {
      // The exact shape of the original defect: a control sizing itself in px
      // instead of from the scale. `textarea`'s 112px is a row count, not a
      // control height, and is asserted separately below.
      const controlHeights = [...formCss.matchAll(/min-height:\s*(\d+)px/g)]
        .map((match) => Number.parseInt(match[1], 10))
        .filter((value) => value !== 112);
      expect(controlHeights).toEqual([]);
    });

    it('keeps the textarea sized by rows rather than by the control scale', () => {
      expect(formCss).toMatch(/textarea\.ds-form-control[^{]*\{[^}]*min-height:\s*112px/);
    });

    it('sizes control icons from the scale rather than from the call site', () => {
      // Call sites passed 16/18/20/24 to the same kind of button. The design
      // system overrides the rendered attribute so they cannot diverge.
      expect(buttonCss).toMatch(/\.ds-button__content > svg\s*\{[^}]*width:\s*var\(--ds-button-icon-size/);
      for (const step of ['sm', 'md', 'lg']) {
        expect(resolveToken(`ds-control-icon-${step}`)).toBeTruthy();
      }
    });
  });

  /**
   * Surface geometry. Cards that each picked their own padding and radius were
   * visibly different sizes beside one another, so the roles exist to be
   * referenced rather than re-decided.
   */
  it.each([
    'ds-card-radius',
    'ds-card-padding',
    'ds-card-padding-compact',
    'ds-card-padding-spacious',
    'ds-card-border',
    'ds-card-shadow',
    'ds-page-gutter',
    'ds-page-gutter-mobile',
    'ds-section-gap',
    'ds-field-gap',
    'ds-metric-icon-size',
  ])('publishes %s as a surface geometry role', (token) => {
    expect(resolveToken(token)).toBeTruthy();
  });

  it('keeps Card reading its geometry from the roles rather than from raw scales', () => {
    const cardCss = fs
      .readFileSync(path.resolve(tokenRoot, '../components/card/Card.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cardCss).toMatch(/border-radius:\s*var\(--ds-card-radius\)/);
    expect(cardCss).toMatch(/padding:\s*var\(--ds-card-padding\)/);
    // The MetricCard chip must not follow the control height: it is an
    // illustration, and it silently grew when `md` went from 40px to 44px.
    expect(cardCss).toMatch(/width:\s*var\(--ds-metric-icon-size\)/);
    expect(cardCss).not.toMatch(/\.ds-metric-card__icon\s*\{[^}]*--ds-control-height/);
  });

  it('exposes the semantic contract through namespaced Tailwind utilities', () => {
    const colors = tailwindConfig.theme.extend.colors;
    expect(colors['ds-canvas']).toBe('var(--ds-color-canvas)');
    expect(colors['ds-content']).toBe('var(--ds-color-content)');
    expect(colors['ds-action-primary']).toBe('var(--ds-color-action-primary)');
    expect(tailwindConfig.theme.extend.spacing['ds-4']).toBe('var(--ds-space-4)');
    expect(tailwindConfig.theme.extend.fontSize['ds-body'][0]).toBe('var(--ds-font-size-body)');
  });

  /**
   * Every gap the 2026-08 audit found. Feature code reached for a raw palette
   * class in each of these places because the role had no utility to reach for,
   * so an unbridged role is a cause of the inconsistency, not a cosmetic
   * omission.
   */
  it.each([
    ['ds-content-danger', '--ds-color-content-danger'],
    ['ds-surface-hover', '--ds-color-surface-hover'],
    ['ds-surface-selected', '--ds-color-surface-selected'],
    ['ds-border-strong', '--ds-color-border-strong'],
    ['ds-action-secondary', '--ds-color-action-secondary'],
    ['ds-action-success', '--ds-color-action-success'],
    ['ds-table-header-bg', '--ds-table-header-bg'],
    ['ds-table-row-hover-bg', '--ds-table-row-hover-bg'],
    ['ds-table-divider', '--ds-table-divider'],
  ])('bridges %s to %s', (utility, property) => {
    expect(tailwindConfig.theme.extend.colors[utility]).toBe(`var(${property})`);
  });

  it('bridges the control scale and the surface geometry roles', () => {
    const { height, minHeight, spacing, borderRadius } = tailwindConfig.theme.extend;
    expect(height['ds-control']).toBe('var(--ds-control-height-md)');
    expect(minHeight['ds-control']).toBe('var(--ds-control-height-md)');
    expect(spacing['ds-card']).toBe('var(--ds-card-padding)');
    expect(spacing['ds-page-gutter']).toBe('var(--ds-page-gutter)');
    expect(borderRadius['ds-card']).toBe('var(--ds-card-radius)');
    expect(borderRadius['ds-full']).toBe('var(--ds-radius-full)');
  });

  it('resolves every bridged colour utility to a token that exists', () => {
    // A utility pointing at a typo'd custom property renders nothing at all and
    // looks like a styling bug at the call site. Catch it here instead.
    const unresolved = Object.entries(tailwindConfig.theme.extend.colors)
      .map(([utility, value]) => [utility, value.match(/^var\(--([\w-]+)\)$/)?.[1]])
      .filter(([, property]) => property && resolveToken(property) === undefined)
      .map(([utility]) => utility);
    expect(unresolved).toEqual([]);
  });

  it('exposes the inverse console surface role through Tailwind utilities', () => {
    const colors = tailwindConfig.theme.extend.colors;
    expect(colors['ds-surface-inverse']).toBe('var(--ds-color-surface-inverse)');
    expect(colors['ds-surface-inverse-subtle']).toBe('var(--ds-color-surface-inverse-subtle)');
    expect(colors['ds-content-on-inverse']).toBe('var(--ds-color-content-on-inverse)');
    expect(colors['ds-content-on-inverse-muted']).toBe('var(--ds-color-content-on-inverse-muted)');
    expect(colors['ds-border-inverse']).toBe('var(--ds-color-border-inverse)');
  });
});
