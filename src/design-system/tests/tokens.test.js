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
   * `content-muted` is approved against `surface` only. On `surface-subtle` it
   * measures 4.34:1, below WCAG AA for normal text — a real-browser axe scan of
   * the public driver application's success screen found three such nodes on
   * 2026-07-27, and they were changed to `content-secondary`.
   *
   * This test pins the gap so it cannot be forgotten. Raising `content-muted`
   * until it clears 4.5:1 on `surface-subtle` is a global visual change that
   * needs owner approval (recorded in the roadmap's decisions section); when that
   * happens, delete this test and move the pairing into the approved list above.
   */
  it('records that content-muted is not approved on surface-subtle', () => {
    const ratio = contrast(
      resolveToken('ds-color-content-muted'),
      resolveToken('ds-color-surface-subtle'),
    );
    expect(ratio).toBeLessThan(4.5);
    // Still legible enough for large text / non-text use, so the token is not broken —
    // it simply must not carry normal-size interface text on a subtle surface.
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('exposes the semantic contract through namespaced Tailwind utilities', () => {
    const colors = tailwindConfig.theme.extend.colors;
    expect(colors['ds-canvas']).toBe('var(--ds-color-canvas)');
    expect(colors['ds-content']).toBe('var(--ds-color-content)');
    expect(colors['ds-action-primary']).toBe('var(--ds-color-action-primary)');
    expect(tailwindConfig.theme.extend.spacing['ds-4']).toBe('var(--ds-space-4)');
    expect(tailwindConfig.theme.extend.fontSize['ds-body'][0]).toBe('var(--ds-font-size-body)');
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
