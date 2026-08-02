import React, { useId } from 'react';
import './ProgressBar.css';

const TONES = new Set(['info', 'success', 'warning', 'danger']);

/**
 * Determinate progress bar.
 *
 * Business-neutral: it owns the track, the fill, the tone and the ARIA
 * `progressbar` semantics. Features decide what is being measured, what the
 * accessible name says, and which domain state maps to which tone.
 *
 * A bare styled `<div>` was previously used for the public application's step
 * meter, which communicated progress by width alone — invisible to assistive
 * technology. This primitive always exposes `aria-valuenow`/`aria-valuetext`,
 * and tone is never the only signal: callers must supply a text label.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  labelledBy,
  valueText,
  tone = 'info',
  className = '',
  ...props
}) {
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported ProgressBar tone: ${tone}`);
  }
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
    throw new TypeError('ProgressBar requires a positive finite max.');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('ProgressBar requires a finite numeric value.');
  }
  if (!labelledBy && (typeof label !== 'string' || label.trim() === '')) {
    throw new TypeError('ProgressBar requires a label or labelledBy.');
  }

  const generatedId = useId().replace(/:/g, '');
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = (clamped / max) * 100;

  return (
    <div
      {...props}
      id={props.id || `ds-progress-${generatedId}`}
      className={`ds-progress ${className}`.trim()}
      data-tone={tone}
      role="progressbar"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
    >
      <div className="ds-progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export default ProgressBar;
