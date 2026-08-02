import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('exposes determinate progress to assistive technology', () => {
    render(<ProgressBar label="Application progress" value={40} max={100} valueText="Step 4 of 10" />);

    const bar = screen.getByRole('progressbar', { name: 'Application progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', 'Step 4 of 10');
  });

  it('accepts an external label element instead of an aria-label', () => {
    render(
      <>
        <h2 id="step-title">Step 2 of 9</h2>
        <ProgressBar labelledBy="step-title" value={2} max={9} />
      </>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Step 2 of 9' });
    expect(bar).not.toHaveAttribute('aria-label');
  });

  it('clamps the rendered fill to the track', () => {
    const { container, rerender } = render(<ProgressBar label="p" value={150} max={100} />);
    expect(container.querySelector('.ds-progress__fill').style.width).toBe('100%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    rerender(<ProgressBar label="p" value={-10} max={100} />);
    expect(container.querySelector('.ds-progress__fill').style.width).toBe('0%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('scales the fill against a non-percentage max', () => {
    const { container } = render(<ProgressBar label="p" value={3} max={9} />);
    expect(container.querySelector('.ds-progress__fill').style.width).toBe(`${(3 / 9) * 100}%`);
  });

  it('carries tone as data so colour is never the only signal', () => {
    const { container } = render(<ProgressBar label="p" value={100} max={100} tone="success" />);
    expect(container.querySelector('.ds-progress')).toHaveAttribute('data-tone', 'success');
  });

  it('rejects unusable inputs', () => {
    expect(() => render(<ProgressBar label="p" value={1} max={0} />)).toThrow(/positive finite max/);
    expect(() => render(<ProgressBar label="p" value={Number.NaN} />)).toThrow(/finite numeric value/);
    expect(() => render(<ProgressBar value={1} />)).toThrow(/label or labelledBy/);
    expect(() => render(<ProgressBar label="p" value={1} tone="rainbow" />)).toThrow(/Unsupported ProgressBar tone/);
  });
});
