import React from 'react';
import './StatusMedallion.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const SIZES = new Set(['md', 'lg']);

/**
 * Circular status medallion — the toned, centred icon disc used above a status
 * heading (loading, success, error, voided, consent, empty states).
 *
 * Business-neutral: it owns the shape, tone and spacing only. Features decide
 * which domain state maps to which tone and which icon to pass in.
 *
 * Always decorative: the medallion is `aria-hidden`, because the adjacent
 * heading and body copy carry the meaning. A tone alone must never be the only
 * signal of what happened.
 *
 * **The glyph inside takes its size from the medallion**, not from the call
 * site — `md` renders it at 24px and `lg` at 32px, from `StatusMedallion.css`,
 * which explains the ratio those two come from. Pass the glyph with no size:
 *
 *     <StatusMedallion tone="success"><Icon icon={Check} /></StatusMedallion>
 *
 * A `size` written here has no effect, which is the point. Until 2026-09-06 it
 * did, and the six call sites had picked 24, 28, 40 and 48 between them.
 */
export function StatusMedallion({ children, tone = 'neutral', size = 'md', className = '' }) {
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported StatusMedallion tone: ${tone}`);
  }
  if (!SIZES.has(size)) {
    throw new TypeError(`Unsupported StatusMedallion size: ${size}`);
  }

  return (
    <span
      aria-hidden="true"
      className={`ds-status-medallion ${className}`.trim()}
      data-tone={tone}
      data-size={size}
    >
      {children}
    </span>
  );
}

export default StatusMedallion;
