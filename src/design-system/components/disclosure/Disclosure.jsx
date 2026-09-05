import React, { useId } from 'react';
import { ChevronDown, Icon } from '../../icons';
import './Disclosure.css';

const VARIANTS = new Set(['default', 'card']);

/**
 * A collapsible section: a header that expands and collapses its own content.
 *
 * `EnvelopeSidebar`'s `RailSection` is the consumer, and the roadmap recorded
 * why `Button` could not supply it: the trigger must fill the rail edge to edge,
 * carry a rotating affordance, and sit *inside a heading* so the section appears
 * in the document outline. `Button`'s padding and inline layout express none of
 * those.
 *
 * An earlier version of this line also named `AiLogsPanel`. It does not use
 * this: the roadmap's 2026-08-17 decision put that panel on `DataTable` at
 * `density="compact"` with its per-run detail in a dialog, because its rows are
 * read comparatively and collapsing them destroys that. Corrected 2026-08-25 —
 * a primitive that lists a consumer it does not have is the same defect as a
 * roadmap that lists a component as missing when it exists.
 *
 * ## Why not `<details>`/`<summary>`
 *
 * The native element is genuinely tempting and genuinely wrong here. Its
 * open/closed state lives in the DOM rather than in React state, so a
 * controlled sidebar that remembers which sections are open has to fight it;
 * and `<summary>`'s marker and focus behaviour are still inconsistent enough
 * across browsers that every real use ends up overriding them anyway. A
 * `<button aria-expanded>` inside a heading is the pattern the WAI-ARIA
 * Authoring Practices describe for exactly this case.
 *
 * ## Controlled and uncontrolled
 *
 * Pass `open` and `onToggle` for a sidebar that remembers its sections. Pass
 * `defaultOpen` and nothing else for a section that just opens and closes.
 * Unlike a tab strip, **more than one may be open at a time** — that is the
 * property `EnvelopeSidebar` chose this over a tab strip for.
 *
 * ## `variant`
 *
 * `default` is the rail appearance above. `card` is a prominent titled section
 * meant to sit inside a `Card`: a leading slot, a `heading-sm` title, a
 * `description` line under it, a 24px chevron in the link colour.
 *
 * The variant does **not** draw a card — `Card` owns the surface, border,
 * radius and padding, and this only takes off the rail chrome that would fight
 * it. `description` and `leading` belong to that appearance and throw on the
 * rail, whose 12px uppercase micro-label has room for neither; `meta` is the
 * rail's trailing count and throws on a card, where it would compete with the
 * chevron for the same slot. Each of those is a layout nobody has built or
 * reviewed, and refusing is cheaper than shipping one untested.
 *
 * The prop is `variant` rather than `appearance` to match `Button`, `Chip` and
 * `Input`, which name this same idea that way.
 */
export function Disclosure({
  title,
  meta,
  description,
  leading,
  variant = 'default',
  open,
  defaultOpen = false,
  onToggle,
  headingLevel = 3,
  className = '',
  children,
  ...props
}) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('Disclosure requires a non-empty title.');
  }
  if (![1, 2, 3, 4, 5, 6].includes(headingLevel)) {
    throw new TypeError(`Unsupported Disclosure headingLevel: ${headingLevel}`);
  }
  if (!VARIANTS.has(variant)) {
    throw new TypeError(`Unsupported Disclosure variant: ${variant}`);
  }
  const isCard = variant === 'card';
  if (description !== undefined) {
    if (!isCard) {
      throw new TypeError('Disclosure description requires variant="card".');
    }
    if (typeof description !== 'string' || description.trim() === '') {
      throw new TypeError('Disclosure description must be a non-empty string.');
    }
  }
  if (leading !== undefined && !isCard) {
    throw new TypeError('Disclosure leading requires variant="card".');
  }
  if (meta !== undefined && isCard) {
    throw new TypeError('Disclosure meta is not supported by variant="card".');
  }

  const generatedId = useId().replace(/:/g, '');
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const handleToggle = () => {
    if (!isControlled) setUncontrolledOpen((value) => !value);
    onToggle?.(!isOpen);
  };

  const panelId = `ds-disclosure-${generatedId}-panel`;
  const headingId = `ds-disclosure-${generatedId}-heading`;
  const Heading = `h${headingLevel}`;

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={`ds-disclosure ${className}`.trim()}
      data-variant={isCard ? variant : undefined}
      data-open={isOpen || undefined}
    >
      {/*
        The heading wraps the button rather than the other way round, so the
        section is announced in the outline whether it is open or closed. A
        button containing a heading is not a heading.
      */}
      <Heading id={headingId} className="ds-disclosure__heading">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={handleToggle}
          className="ds-disclosure__trigger"
        >
          {/*
            An opaque slot, hidden from assistive technology by the wrapper
            rather than by trusting the caller to remember. What goes in it is
            the feature's business — a toned tile, a product mark, a glyph —
            and none of it carries meaning the title does not already say.
          */}
          {leading !== undefined && (
            <span aria-hidden="true" className="ds-disclosure__leading">{leading}</span>
          )}
          {isCard ? (
            <span className="ds-disclosure__text">
              <span className="ds-disclosure__title">{title}</span>
              {description && <span className="ds-disclosure__description">{description}</span>}
            </span>
          ) : (
            <span className="ds-disclosure__title">{title}</span>
          )}
          {meta && <span className="ds-disclosure__meta">{meta}</span>}
          <Icon icon={ChevronDown} className="ds-disclosure__chevron" />
        </button>
      </Heading>
      {/*
        Unmounted rather than hidden when closed. `hidden` would keep the
        content in the DOM, where a stale focus target inside a collapsed
        section is reachable by find-in-page and by screen-reader browse mode.
      */}
      {isOpen && (
        <div id={panelId} className="ds-disclosure__panel">
          {children}
        </div>
      )}
    </section>
  );
}
