import React, { forwardRef } from 'react';
import { contractViolation } from '../../contract';
import './Card.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const PADDINGS = new Set(['none', 'sm', 'md', 'lg']);

export const Card = /* @__PURE__ */ forwardRef(function Card({
  as: Element = 'section',
  children,
  padding = 'md',
  className = '',
  ...props
}, ref) {
  if (!PADDINGS.has(padding)) {
    contractViolation(`Unsupported Card padding: ${padding}`);
  }

  return (
    <Element
      {...props}
      ref={ref}
      className={`ds-card ${className}`.trim()}
      data-padding={padding}
    >
      {children}
    </Element>
  );
});

export const MetricCard = /* @__PURE__ */ forwardRef(function MetricCard({
  id,
  label,
  value,
  icon,
  tone = 'neutral',
  active = false,
  onActivate,
}, ref) {
  if (!TONES.has(tone)) {
    contractViolation(`Unsupported MetricCard tone: ${tone}`);
  }

  const Element = onActivate ? 'button' : 'div';

  return (
    <Element
      ref={ref}
      id={id}
      type={onActivate ? 'button' : undefined}
      className="ds-metric-card"
      data-tone={tone}
      data-interactive={Boolean(onActivate)}
      data-active={active || undefined}
      onClick={onActivate}
      aria-label={onActivate ? `${label}: ${value}` : undefined}
      aria-pressed={onActivate && active ? true : undefined}
    >
      <span className="ds-metric-card__content">
        <span className="ds-metric-card__label" title={label}>{label}</span>
        {/* Both spans are blocks, so this space draws nothing; it keeps the
            label and the value two words in the text a name is checked against. */}
        {' '}
        <span className="ds-metric-card__value" title={String(value)}>{value}</span>
      </span>
      {icon && <span className="ds-metric-card__icon" aria-hidden="true">{icon}</span>}
    </Element>
  );
});
