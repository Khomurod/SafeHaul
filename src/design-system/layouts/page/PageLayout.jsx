import React from 'react';
import './PageLayout.css';

export function PageContainer({ children, width = 'wide', className = '', ...props }) {
  return (
    <div {...props} className={`ds-page-container ${className}`.trim()} data-width={width}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions, className = '', ...props }) {
  return (
    <header {...props} className={`ds-page-header ${className}`.trim()}>
      <div className="ds-page-header__content">
        <h1>{title}</h1>
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
