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
