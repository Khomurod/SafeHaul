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
