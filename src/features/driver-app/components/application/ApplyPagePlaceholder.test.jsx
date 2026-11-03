/**
 * The one placeholder the driver application shows while it starts: a named
 * `<main>` that is not busy, one visually hidden `<h1>` in a polite status, and
 * grey shapes no assistive technology reads. "Loading Application..." is frozen copy.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ApplyPagePlaceholder } from './ApplyPagePlaceholder';

describe('ApplyPagePlaceholder', () => {
  it('is one main landmark named by its heading', () => {
    render(<ApplyPagePlaceholder />);
    expect(screen.getByRole('main', { name: 'Loading Application...' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('has exactly one h1, with the frozen copy', () => {
    render(<ApplyPagePlaceholder />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Loading Application\.\.\.$/);
  });

  it('announces itself and keeps the frozen copy', () => {
    render(<ApplyPagePlaceholder />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Application...');
  });

  // Assistive technology may hold back a busy region's content until it is no
  // longer busy; this one is removed while still busy, so nothing may be busy.
  it('keeps the announcement outside any busy region', () => {
    render(<ApplyPagePlaceholder />);
    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy');
  });

  it('hides every placeholder shape from assistive technology', () => {
    const { container } = render(<ApplyPagePlaceholder />);
    const shapes = container.querySelectorAll('.ds-skeleton');
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('says nothing but the announcement', () => {
    render(<ApplyPagePlaceholder />);
    expect(screen.getByRole('main').textContent).toBe('Loading Application...');
  });

  it('has no axe violations', async () => {
    const { container } = render(<ApplyPagePlaceholder />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
