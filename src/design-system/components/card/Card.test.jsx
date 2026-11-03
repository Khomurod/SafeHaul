import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Card, MetricCard } from './Card';

describe('Card', () => {
  it('keeps static cards non-interactive and metric actions native', () => {
    const onActivate = vi.fn();
    render(
      <>
        <Card aria-label="Summary">Static content</Card>
        <MetricCard label="Records" value={12} tone="info" onActivate={onActivate} />
      </>,
    );

    expect(screen.getByLabelText('Summary').tagName).toBe('SECTION');
    fireEvent.click(screen.getByRole('button', { name: 'Records: 12' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('keeps the label and the value apart as words, so the name contains what is visible', () => {
    // axe's label-content-name-mismatch reads the visible text word by word: run
    // together, "Needs attention" and "0" read "attention0", which the name
    // "Needs attention: 0" does not contain. happy-dom has no layout, so axe
    // here cannot see it; the rendered text is what it compares.
    render(<MetricCard label="Needs attention" value={0} tone="warning" onActivate={() => {}} />);

    const card = screen.getByRole('button', { name: 'Needs attention: 0' });
    expect(card.textContent).toBe('Needs attention 0');
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <MetricCard label="Completed" value={7} tone="success" onActivate={() => {}} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('MetricCard loading', () => {
  it('holds the value with a placeholder, stays a button named by its label, and still navigates', () => {
    const onActivate = vi.fn();
    render(<MetricCard label="Records" value={12} tone="info" loading onActivate={onActivate} />);

    const card = screen.getByRole('button', { name: 'Records' });
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(card).toHaveAttribute('data-loading', 'true');
    const value = card.querySelector('.ds-metric-card__value');
    expect(value.querySelector('.ds-skeleton')).not.toBeNull();
    expect(value).not.toHaveAttribute('title');
    expect(card).not.toHaveTextContent('12');

    fireEvent.click(card);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('marks a static card busy too', () => {
    const { container } = render(<MetricCard label="Owners" value="4" loading />);
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
    expect(container.firstChild).not.toHaveTextContent('4');
  });

  /*
   * Seven other screens show a `MetricCard` that never loads: not loading must
   * render exactly what it rendered before `loading` existed.
   */
  it('renders exactly as before when not loading', () => {
    const interactive = render(<MetricCard label="Records" value={12} tone="info" onActivate={() => {}} />);
    expect(interactive.container.innerHTML).toBe(
      '<button type="button" class="ds-metric-card" data-tone="info" data-interactive="true" aria-label="Records: 12">'
      + '<span class="ds-metric-card__content"><span class="ds-metric-card__label" title="Records">Records</span> '
      + '<span class="ds-metric-card__value" title="12">12</span></span></button>',
    );
    const still = render(<MetricCard label="Owners" value="4" loading={false} />);
    expect(still.container.innerHTML).toBe(
      '<div class="ds-metric-card" data-tone="neutral" data-interactive="false">'
      + '<span class="ds-metric-card__content"><span class="ds-metric-card__label" title="Owners">Owners</span> '
      + '<span class="ds-metric-card__value" title="4">4</span></span></div>',
    );
    expect(still.container.firstChild).not.toHaveAttribute('aria-busy');
    expect(still.container.firstChild).not.toHaveAttribute('data-loading');
  });

  it('has no structural accessibility violations while loading', async () => {
    const { container } = render(
      <MetricCard label="Records" value={12} tone="info" loading onActivate={() => {}} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
