import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import './Disclosure.css';

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
 */
export function Disclosure({
  title,
  meta,
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
          <span className="ds-disclosure__title">{title}</span>
          {meta && <span className="ds-disclosure__meta">{meta}</span>}
          <ChevronDown className="ds-disclosure__chevron" aria-hidden="true" />
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
