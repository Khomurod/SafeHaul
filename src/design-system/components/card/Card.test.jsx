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

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <MetricCard label="Completed" value={7} tone="success" onActivate={() => {}} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
