import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders feature-provided content with a generic tone', async () => {
    const { container } = render(<Badge tone="warning">Needs review</Badge>);
    expect(screen.getByText('Needs review')).toHaveAttribute('data-tone', 'warning');
    expect((await axe(container)).violations).toEqual([]);
  });
});

/**
 * A badge is as wide as its label.
 *
 * A "Removed" badge inside a `Stack` must not render as a full-width pill, which
 * it does by default because a column flex container stretches its items across
 * the cross axis — which for a column is the width. jsdom has no layout engine,
 * so this asserts the declaration rather than the measured box;
 * `check:table-layout` and the catalog screenshots cover the rendered result.
 */
describe('Badge width', () => {
  const BADGE_CSS = readFileSync(path.join(__dirname, 'Badge.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('opts out of flex and grid stretching', () => {
    expect(BADGE_CSS).toMatch(/\.ds-badge\s*\{[^}]*width:\s*fit-content/);
  });

  it('does not constrain its own alignment, only its width', () => {
    // `align-self: start` would also stop the stretch, but it would top-align
    // every badge sitting in a row alongside taller content.
    expect(BADGE_CSS).not.toMatch(/\.ds-badge\s*\{[^}]*align-self/);
  });
});

/**
 * A borderless pill (C2): the tint and the label are the badge. The border is
 * still there, 1px and transparent, because forced-colours mode paints a
 * transparent border in the system text colour; take it away and a badge in
 * Windows' high-contrast themes is bare text.
 */
describe('Badge outline', () => {
  const BADGE_CSS = readFileSync(path.join(__dirname, 'Badge.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps a 1px border, transparent, for forced colours', () => {
    expect(BADGE_CSS).toMatch(/\.ds-badge\s*\{[^}]*border:\s*1px solid transparent/);
    expect(BADGE_CSS).not.toMatch(/--ds-color-status-\w+-border/);
  });

  it('sets its label in the medium weight', () => {
    expect(BADGE_CSS).toMatch(/\.ds-badge\s*\{[^}]*font-weight:\s*var\(--ds-font-weight-medium\)/);
  });
});
