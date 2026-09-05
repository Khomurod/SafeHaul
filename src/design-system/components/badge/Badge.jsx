import React from 'react';
import { Icon } from '../../icons';
import './Badge.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);

export function Badge({ children, icon, tone = 'neutral' }) {
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported Badge tone: ${tone}`);
  }

  return (
    <span className="ds-badge" data-tone={tone}>
      {icon && <Icon icon={icon} size="xs" />}
      {children}
    </span>
  );
}
