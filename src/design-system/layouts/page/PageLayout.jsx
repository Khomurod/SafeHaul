import React from 'react';
import { contractViolation } from '../../contract';
import './PageLayout.css';

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

export function PageContainer({ children, width = 'wide', className = '', ...props }) {
  return (
    <div {...props} className={`ds-page-container ${className}`.trim()} data-width={width}>
      {children}
    </div>
  );
}

/**
 * The page's `<h1>`, an optional description and an action slot.
 *
 * `count` is the number of records a list page shows, drawn beside the heading
 * and outside it, so the heading's name stays the page's name. `countLabel` is
 * the word read after it ("8 applications"); the screen shows the number only.
 * The count is a `status` region, so a screen reader hears it change when a
 * filter or a search changes the list. Leave `count` out while the number is
 * unknown.
 */
export function PageHeader({ title, description, actions, count, countLabel, className = '', ...props }) {
  const hasCount = count !== undefined && count !== null;
  if (hasCount && (!Number.isInteger(count) || count < 0)) {
    contractViolation(`PageHeader count must be a whole number of records, not ${count}.`);
  }
  if (hasCount && (typeof countLabel !== 'string' || countLabel.trim() === '')) {
    contractViolation('PageHeader count needs a countLabel: the word read after the number.');
  }

  return (
    <header {...props} className={`ds-page-header ${className}`.trim()}>
      <div className="ds-page-header__content">
        {hasCount ? (
          <div className="ds-page-header__title">
            <h1>{title}</h1>
            <span className="ds-page-header__count" role="status">
              {COUNT_FORMAT.format(count)}
              <span className="ds-visually-hidden"> {countLabel}</span>
            </span>
          </div>
        ) : (
          <h1>{title}</h1>
        )}
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ds-page-header__actions">{actions}</div>}
    </header>
  );
}

export function Section({ children, labelledBy, className = '', ...props }) {
  return (
    <section
      {...props}
      className={`ds-section ${className}`.trim()}
      aria-labelledby={labelledBy}
    >
      {children}
    </section>
  );
}

export function Stack({ children, gap = 'md', className = '', ...props }) {
  return (
    <div {...props} className={`ds-stack ${className}`.trim()} data-gap={gap}>
      {children}
    </div>
  );
}

export function Inline({ children, gap = 'md', wrap = true, className = '', ...props }) {
  return (
    <div
      {...props}
      className={`ds-inline ${className}`.trim()}
      data-gap={gap}
      data-wrap={wrap || undefined}
    >
      {children}
    </div>
  );
}

export function ResponsiveGrid({
  children,
  minItemWidth = '220px',
  className = '',
  ...props
}) {
  return (
    <div
      {...props}
      className={`ds-responsive-grid ${className}`.trim()}
      style={{ '--ds-grid-min-item-width': minItemWidth }}
    >
      {children}
    </div>
  );
}
