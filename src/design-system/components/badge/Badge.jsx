import React from 'react';
import './Badge.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);

export function Badge({ children, icon: Icon, tone = 'neutral' }) {
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported Badge tone: ${tone}`);
  }

  return (
    <span className="ds-badge" data-tone={tone}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}
