import React, { forwardRef } from 'react';
import { contractViolation } from '../../contract';
import { Skeleton } from '../skeleton';
import './Card.css';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const PADDINGS = new Set(['none', 'sm', 'md', 'lg']);
const ELEVATIONS = new Set(['default', 'soft']);

export const Card = /* @__PURE__ */ forwardRef(function Card({
  as: Element = 'section',
  children,
  padding = 'md',
  elevation = 'default',
  className = '',
  ...props
}, ref) {
  if (!PADDINGS.has(padding)) {
    contractViolation(`Unsupported Card padding: ${padding}`);
  }
  if (!ELEVATIONS.has(elevation)) {
    contractViolation(`Unsupported Card elevation: ${elevation}`);
  }

  return (
    <Element
      {...props}
      ref={ref}
      className={`ds-card ${className}`.trim()}
      data-padding={padding}
      data-elevation={elevation === 'soft' ? 'soft' : undefined}
    >
      {children}
    </Element>
  );
});

/*
 * A description is a short note under the value ("Sending right now"), read
 * with the number, so it must be words: a blank one would draw an empty line
 * and, on an interactive card, end its name in nothing.
 */
function checkedDescription(description) {
  // `null` is absent too: `description={note || null}` is how React writes "none".
  if (description == null) return undefined;
  if (typeof description !== 'string' || description.trim() === '') {
    contractViolation('MetricCard description must be a non-empty string.');
    return undefined;
  }
  return description;
}

export const MetricCard = /* @__PURE__ */ forwardRef(function MetricCard({
  id,
  label,
  value,
  description,
  icon,
  tone = 'neutral',
  active = false,
  loading = false,
  onActivate,
}, ref) {
  if (!TONES.has(tone)) {
    contractViolation(`Unsupported MetricCard tone: ${tone}`);
  }
  const note = checkedDescription(description);

  const Element = onActivate ? 'button' : 'div';
  // While loading, `value` is ignored: a placeholder holds its place, and a card
  // that navigates stays a button, named by its label alone (the visible text).
  // A description is visible text inside the button too, so the name carries it
  // after the number: WCAG 2.5.3 wants every visible word in the name, in order.
  let name;
  if (onActivate) {
    const reading = loading ? label : `${label}: ${value}`;
    name = note ? `${reading}. ${note}` : reading;
  }

  return (
    <Element
      ref={ref}
      id={id}
      type={onActivate ? 'button' : undefined}
      className="ds-metric-card"
      data-tone={tone}
      data-interactive={Boolean(onActivate)}
      data-active={active || undefined}
      data-loading={loading || undefined}
      onClick={onActivate}
      aria-label={name}
      aria-pressed={onActivate && active ? true : undefined}
      aria-busy={loading || undefined}
    >
      <span className="ds-metric-card__content">
        {/* The `title`s show nothing hidden — nothing is cut any more — but a
            tile is still found by them (E-Docs' unit and browser tests). */}
        <span className="ds-metric-card__label" title={label}>{label}</span>
        {/* Both spans are blocks, so this space draws nothing; it keeps the
            label and the value two words in the text a name is checked against. */}
        {' '}
        {loading ? (
          <span className="ds-metric-card__value"><Skeleton width="half" /></span>
        ) : (
          <span className="ds-metric-card__value" title={String(value)}>{value}</span>
        )}
        {note && (
          <>
            {' '}
            <span className="ds-metric-card__description">{note}</span>
          </>
        )}
      </span>
      {icon && <span className="ds-metric-card__icon" aria-hidden="true">{icon}</span>}
    </Element>
  );
});
