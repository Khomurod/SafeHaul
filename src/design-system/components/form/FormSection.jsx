import React, { useId } from 'react';
import { Card } from '../card';
import { contractViolation } from '../../contract';
import './FormSection.css';

/*
 * Three ways a group of fields sits on a page (C2):
 *
 * - `card` (default) — the heading inside the card, above a divider. The
 *   divider is inset by the card's padding (the driver application, the
 *   verification portal, the prep editors); `header="bleed"` runs it edge to
 *   edge with a 14px description (C2: Add lead, Import).
 * - `stacked` — the heading and description above a full-width card. Profile,
 *   Company profile and the settings sections that hold a table.
 * - `aside` — the heading and description in a 232px column beside the card,
 *   for a settings page whose sections each explain themselves (Email,
 *   Automated texts). Under a 760px section it becomes `stacked`: a container
 *   query on the section itself, so it holds wherever the section is placed.
 */
const LAYOUTS = new Set(['card', 'stacked', 'aside']);
const PADDINGS = new Set(['none', 'sm', 'md', 'lg']);
const HEADERS = new Set(['inset', 'bleed']);

function checked(value, allowed, name, fallback) {
  if (allowed.has(value)) return value;
  contractViolation(`Unsupported FormSection ${name}: ${value}`);
  return fallback;
}

/**
 * A group of related fields with a heading, an optional description, optional
 * header actions and an optional footer.
 *
 * `padding` is the inset of the card's BODY: `none` makes a table or a list the
 * card itself, edge to edge. The header and the footer keep the card's inset at
 * every value, so their words line up with a padded body's.
 *
 * `footer` is a row of actions under the body: right-aligned, a full-bleed top
 * border, and on a phone each button takes an equal share of the row.
 *
 * In `aside`, `actions` sit under the description in the side column — a status
 * box, a guide link — rather than at the end of a title row there is no room for.
 *
 * `header` shapes a `card` section's header only: `inset` (default) keeps the
 * divider inside the card's padding and a 13px description; `bleed` runs the
 * divider edge to edge, as the footer's does, with a 14px description. Pair
 * `bleed` with a `footer` or a flush body so the dividers line up. A stacked or
 * aside section draws its heading outside the card, with no divider to shape.
 */
export function FormSection({
  as,
  title,
  description,
  actions,
  footer,
  layout = 'card',
  padding = 'md',
  header = 'inset',
  children,
  className = '',
  ...props
}) {
  const generatedId = useId().replace(/:/g, '');
  const titleId = props['aria-label'] ? undefined : `ds-form-section-${generatedId}`;
  const drawnLayout = checked(layout, LAYOUTS, 'layout', 'card');
  const inset = checked(padding, PADDINGS, 'padding', 'md');
  const headerShape = checked(header, HEADERS, 'header', 'inset');

  if (!props['aria-label'] && (typeof title !== 'string' || title.trim() === '')) {
    contractViolation('FormSection requires a title or aria-label.');
  }
  /*
   * A heading outside the card IS the layout: without a visible title there is
   * nothing to stack above the card or to put beside it, and an `aria-label`
   * alone would leave an empty column.
   */
  if (drawnLayout !== 'card' && (typeof title !== 'string' || title.trim() === '')) {
    contractViolation(`A ${drawnLayout} FormSection needs a visible title.`);
  }
  if (drawnLayout !== 'card' && headerShape !== 'inset') {
    contractViolation(`FormSection header="${headerShape}" shapes a card section; a ${drawnLayout} section has no header divider.`);
  }

  const heading = (title || description) && (
    <div className="ds-form-section__heading">
      {title && <h2 id={titleId} className="ds-form-section__title">{title}</h2>}
      {description && <p className="ds-form-section__description">{description}</p>}
    </div>
  );
  const actionSlot = actions && <div className="ds-form-section__actions">{actions}</div>;
  const contents = (
    <>
      <div className="ds-form-section__body">{children}</div>
      {footer && <div className="ds-form-section__footer">{footer}</div>}
    </>
  );

  if (drawnLayout === 'card') {
    return (
      <Card
        {...props}
        as={as}
        padding="none"
        className={`ds-form-section ds-form-section__card ${className}`.trim()}
        data-inset={inset}
        data-header={headerShape === 'bleed' ? 'bleed' : undefined}
        aria-labelledby={titleId}
      >
        {(heading || actionSlot) && (
          <header className="ds-form-section__header">
            {heading}
            {actionSlot}
          </header>
        )}
        {contents}
      </Card>
    );
  }

  const Root = as || 'section';
  const card = (
    <Card as="div" padding="none" className="ds-form-section__card">
      {contents}
    </Card>
  );

  return (
    <Root
      {...props}
      className={`ds-form-section ${className}`.trim()}
      data-layout={drawnLayout}
      data-inset={inset}
      aria-labelledby={titleId}
    >
      {drawnLayout === 'stacked' ? (
        <>
          <header className="ds-form-section__header">
            {heading}
            {actionSlot}
          </header>
          {card}
        </>
      ) : (
        <div className="ds-form-section__columns">
          <div className="ds-form-section__aside">
            {heading}
            {actionSlot}
          </div>
          {card}
        </div>
      )}
    </Root>
  );
}
