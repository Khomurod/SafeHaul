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
 * Found by the desktop and mobile visual review on 2026-08-21: a "Removed"
 * badge inside a `Stack` rendered as a full-width pill, because a column flex
 * container stretches its items across the cross axis — which for a column is
 * the width. jsdom has no layout engine, so this asserts the declaration rather
 * than the measured box; `check:table-layout` and the catalog screenshots cover
 * the rendered result.
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
