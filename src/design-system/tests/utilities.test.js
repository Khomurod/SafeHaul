import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const utilities = fs.readFileSync(path.join(root, 'utilities.css'), 'utf8');

/**
 * `utilities.css` holds the two rules that have to exist independently of any
 * component: the visually-hidden helper, and the one below.
 */
describe('the focus ring is the product\'s, not the browser\'s', () => {
  /*
   * The design-system ring is a `box-shadow`, so it does not replace the UA
   * `outline` — it draws next to it. The convention is to write
   * `focus-visible:outline-none` alongside `focus-visible:shadow-ds-focus`, and
   * 67 of 74 call sites did. The seven that forgot rendered `auto 1px
   * rgb(16, 16, 16)`: a black ring in a product whose focus colour is blue. One
   * of them was the driver application's step heading, which every applicant
   * sees on every one of nine steps.
   *
   * This is asserted as a rule rather than fixed at those seven call sites so
   * that the next call site cannot forget either.
   */
  it('suppresses the browser outline wherever the ds ring is asked for', () => {
    const rule = utilities.match(/\[class\*='shadow-ds-focus'\]:focus-visible\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/outline:\s*none/);
  });

  it('does not suppress the outline unconditionally', () => {
    // A blanket `outline: none` would remove the focus indicator from every
    // element that does *not* ask for the design-system ring, which is a
    // WCAG 2.4.7 failure and strictly worse than two rings.
    expect(utilities).not.toMatch(/^\s*\*\s*\{[^}]*outline:\s*none/m);
    expect(utilities).not.toMatch(/^\s*:focus-visible\s*\{[^}]*outline:\s*none/m);
  });
});

describe('the visually-hidden helper stays reachable', () => {
  it('clips rather than hiding, so the text stays in the accessibility tree', () => {
    const rule = utilities.match(/\.ds-visually-hidden\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    // `display: none` and `visibility: hidden` both remove the element from the
    // accessibility tree, which is the opposite of the intent.
    expect(rule[0]).toMatch(/clip:\s*rect/);
    expect(rule[0]).not.toMatch(/display:\s*none/);
    expect(rule[0]).not.toMatch(/visibility:\s*hidden/);
  });
});
