import React, { forwardRef } from 'react';
import './Card.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const PADDINGS = new Set(['none', 'sm', 'md', 'lg']);

export const Card = forwardRef(function Card({
  as: Element = 'section',
  children,
  padding = 'md',
  className = '',
  ...props
}, ref) {
  if (!PADDINGS.has(padding)) {
    throw new TypeError(`Unsupported Card padding: ${padding}`);
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

export const MetricCard = forwardRef(function MetricCard({
  id,
  label,
  value,
  icon,
  tone = 'neutral',
  active = false,
  onActivate,
}, ref) {
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported MetricCard tone: ${tone}`);
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
        <span className="ds-metric-card__value" title={String(value)}>{value}</span>
      </span>
      {icon && <span className="ds-metric-card__icon" aria-hidden="true">{icon}</span>}
    </Element>
  );
});
