import React from 'react';
import { contractViolation } from '../../contract';
import { ArrowLeft, Icon } from '../../icons';
import { Link } from '../../components/link/Link';
import './PageLayout.css';

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * The page canvas. `standard` is 1200px of content centred between two 40px
 * gutters (`--ds-page-content-width`, `--ds-page-gutter`), 32px from the top
 * and 48px from the bottom; under 768px the gutters are 16px and the padding
 * 20px above, 40px below. `wide` (the default) is for work surfaces with side
 * panes, up to 1600px including its gutters.
 */
export function PageContainer({ children, width = 'wide', className = '', ...props }) {
  return (
    <div {...props} className={`ds-page-container ${className}`.trim()} data-width={width}>
      {children}
    </div>
  );
}

const absent = (value) => value === undefined || value === null || value === false;

/** The eyebrow's words, or nothing when they are absent or misused (reported). */
function readEyebrow(eyebrow, owner) {
  if (absent(eyebrow)) return null;
  if (typeof eyebrow !== 'string' || eyebrow.trim() === '') {
    contractViolation(`${owner} eyebrow must be a non-empty string: the section the page belongs to.`);
    return null;
  }
  return eyebrow;
}

/**
 * The back link, or nothing when it is absent or misused (reported). A link
 * navigates, so it needs an `href`; a page that routes in script passes an
 * `onClick` as well, which calls `preventDefault` and navigates.
 */
function readBack(back, owner) {
  if (absent(back)) return null;
  const { label, href, onClick } = typeof back === 'object' ? back : {};
  if (typeof label !== 'string' || label.trim() === '') {
    contractViolation(`${owner} back needs a label: where the link goes, such as "Leads".`);
    return null;
  }
  if (typeof href !== 'string' || href.trim() === '') {
    contractViolation(`${owner} back needs an href: a link navigates. For an action, use a Button.`);
    return null;
  }
  if (onClick !== undefined && typeof onClick !== 'function') {
    contractViolation(`${owner} back onClick must be a function.`);
    return { label, href };
  }
  return { label, href, onClick };
}

function EyebrowRow({ eyebrow, back, className = '', ...props }) {
  if (!eyebrow && !back) return null;
  return (
    <div {...props} className={`ds-page-eyebrow ${className}`.trim()}>
      {back && (
        <Link href={back.href} onClick={back.onClick} className="ds-page-eyebrow__back">
          <Icon icon={ArrowLeft} size="md" />
          {back.label}
        </Link>
      )}
      {back && eyebrow && <span className="ds-page-eyebrow__separator" aria-hidden="true" />}
      {eyebrow && <p className="ds-page-eyebrow__text">{eyebrow}</p>}
    </div>
  );
}

/**
 * The line above a page title: an optional back link, then the eyebrow — the
 * section the page belongs to, shown in capitals in the brand colour. With both,
 * they share the row with a short rule between them.
 *
 * `PageHeader` draws it from its own `eyebrow` and `back`. A frame that holds
 * several pages under one eyebrow (Company Settings) draws it once with this
 * export, directly above the page's `PageHeader`, leaving `--ds-space-2`
 * between them — inside a `PageHeader` the row sits that far above the title.
 */
export function PageEyebrow({ eyebrow, back, ...props }) {
  return (
    <EyebrowRow
      {...props}
      eyebrow={readEyebrow(eyebrow, 'PageEyebrow')}
      back={readBack(back, 'PageEyebrow')}
    />
  );
}

/**
 * The page's heading, an optional description and an action slot.
 *
 * `count` is the number of records a list page shows, drawn beside the heading
 * and outside it, so the heading's name stays the page's name. `countLabel` is
 * the word read after it ("8 applications"); the screen shows the number only.
 * The count is a `status` region, so a screen reader hears it change when a
 * filter or a search changes the list. Leave `count` out while the number is
 * unknown: with `countLabel` given, the region stays in place, empty and
 * unseen, so the number that arrives is announced too (a region inserted
 * together with its content often is not).
 *
 * `eyebrow` and `back` draw the line above the title (`PageEyebrow`).
 *
 * `actions` sit on the title's row, at its right, centred on the title line.
 * Under 768px they follow the description as a full-width row, each child
 * taking an equal share; `mobileActions="sticky"` instead pins them to the
 * bottom of the screen as a bar, for a one-form page whose Save must stay in
 * reach, and the page container makes room for the bar. The DOM order is
 * always title, description, actions, so reading and Tab order never change.
 *
 * `level` is `1` unless a shell's masthead already holds the page's one `<h1>`,
 * as the Super Admin console's does: there it is `2`, and the title keeps the
 * 24px step under the masthead. `headingRef` reaches the heading, for a page
 * that moves focus to it; the heading is then focusable from script.
 */
const LEVELS = new Set([1, 2]);
const MOBILE_ACTIONS = new Set(['row', 'sticky']);

export function PageHeader({
  title,
  description,
  actions,
  count,
  countLabel,
  eyebrow,
  back,
  mobileActions = 'row',
  level = 1,
  headingRef,
  className = '',
  ...props
}) {
  const hasCount = count !== undefined && count !== null;
  const showsCount = hasCount || (typeof countLabel === 'string' && countLabel.trim() !== '');
  if (hasCount && (!Number.isInteger(count) || count < 0)) {
    contractViolation(`PageHeader count must be a whole number of records, not ${count}.`);
  }
  if (hasCount && (typeof countLabel !== 'string' || countLabel.trim() === '')) {
    contractViolation('PageHeader count needs a countLabel: the word read after the number.');
  }
  if (!LEVELS.has(level)) {
    contractViolation(`PageHeader level must be 1 or 2, not ${level}.`);
  }
  if (!MOBILE_ACTIONS.has(mobileActions)) {
    contractViolation(`PageHeader mobileActions must be 'row' or 'sticky', not ${mobileActions}.`);
  }
  const Heading = level === 2 ? 'h2' : 'h1';
  const sticky = mobileActions === 'sticky' && Boolean(actions);

  return (
    <header
      {...props}
      className={`ds-page-header ${className}`.trim()}
      data-level={level === 2 ? '2' : undefined}
      data-mobile-actions={sticky ? 'sticky' : undefined}
    >
      <EyebrowRow eyebrow={readEyebrow(eyebrow, 'PageHeader')} back={readBack(back, 'PageHeader')} />
      <div className="ds-page-header__title">
        <Heading ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="ds-page-header__heading">
          {title}
        </Heading>
        {showsCount && (
          <span className="ds-page-header__count" role="status">
            {hasCount && (
              <>
                {COUNT_FORMAT.format(count)}
                <span className="ds-visually-hidden"> {countLabel}</span>
              </>
            )}
          </span>
        )}
      </div>
      {description && <p className="ds-page-header__description">{description}</p>}
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
