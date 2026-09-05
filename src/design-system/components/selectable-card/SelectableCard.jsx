import React, { forwardRef } from 'react';
import './SelectableCard.css';

/**
 * A block of record content that behaves as one option.
 *
 * The gap this fills was recorded three times under three names — Listbox,
 * Combobox, SelectableCard — and the audit found one shape behind all of them:
 * a card carrying MULTI-LINE structured content that a person picks. Four sites
 * hand-built it, and `SegmentedControl` could not take any of them because its
 * `label` is a string.
 *
 * ## Three states, and only one at a time
 *
 * The four sites carried three different ARIA states between them, which is the
 * thing this has to get right rather than average out:
 *
 *   - `selected` → `aria-pressed`. A two-state selection you can turn off: the
 *     FMCSA suggestion rows, the lead-exclusion rows.
 *   - `current` → `aria-current`. Which one you are looking at, in a set where
 *     something always is: the PDF page thumbnails.
 *   - neither. A plain activation that goes somewhere: the company chooser.
 *
 * Both together throws. They answer different questions — "is this one on" and
 * "is this the one you are on" — and an element asserting both tells assistive
 * technology two stories about itself.
 */
const PADDINGS = new Set(['none', 'xs', 'sm', 'md']);
const SURFACES = new Set(['default', 'inverse']);

/**
 * `tone` colours the BORDER and nothing else.
 *
 * Deliberately not a fill. The one consumer that needs it — a lead row already
 * messaged, outlined in warning on the console-dark panel — is saying something
 * about the record, not about the selection, and a tinted fill would compete
 * with the selected state sitting right beside it. Inventing a fill treatment no
 * call site asks for is how a primitive grows options nobody can explain later.
 *
 * On the inverse surface each tone resolves to its `-fg-on-inverse` role, which
 * is the pair those tokens exist for: the light-surface border colours are
 * roughly invisible on slate-900.
 */
const TONES = new Set(['default', 'info', 'success', 'warning', 'danger']);

export const SelectableCard = forwardRef(function SelectableCard({
  as = 'button',
  children,
  selected,
  current,
  tone = 'default',
  surface = 'default',
  padding = 'sm',
  className = '',
  onSelect,
  ...props
}, ref) {
  if (as !== 'button' && as !== 'div') {
    throw new TypeError(`Unsupported SelectableCard element: ${as}. Expected 'button' or 'div'.`);
  }
  if (!PADDINGS.has(padding)) {
    throw new TypeError(`Unsupported SelectableCard padding: ${padding}.`);
  }
  if (!SURFACES.has(surface)) {
    throw new TypeError(`Unsupported SelectableCard surface: ${surface}.`);
  }
  if (!TONES.has(tone)) {
    throw new TypeError(
      `Unsupported SelectableCard tone: ${tone}. Expected one of `
      + `${[...TONES].map((t) => `'${t}'`).join(', ')}.`,
    );
  }
  if (selected !== undefined && current !== undefined) {
    throw new TypeError(
      'SelectableCard cannot be both `selected` and `current`. `selected` is a two-state '
      + 'choice (aria-pressed); `current` is which one of a set you are on (aria-current).',
    );
  }
  /*
   * A `div` is for the row that deliberately is NOT a control — the already-
   * messaged lead rows, which the feature keeps unclickable on purpose. Giving
   * it a state or a handler would be the caller asking for a control while
   * spelling it as a div, so both are refused rather than dropped.
   */
  if (as === 'div' && (selected !== undefined || current !== undefined || onSelect)) {
    throw new TypeError(
      'SelectableCard as="div" is the non-interactive twin: it takes no state and no '
      + '`onSelect`. Use as="button" for a card a person can pick.',
    );
  }

  const Element = as;
  return (
    <Element
      {...props}
      ref={ref}
      type={as === 'button' ? (props.type || 'button') : undefined}
      onClick={as === 'button' ? onSelect : undefined}
      className={`ds-selectable-card ${className}`.trim()}
      data-surface={surface === 'default' ? undefined : surface}
      data-tone={tone === 'default' ? undefined : tone}
      data-padding={padding}
      data-state={selected === true || current === true ? 'on' : undefined}
      aria-pressed={selected === undefined ? undefined : selected === true}
      aria-current={current === true ? 'page' : undefined}
    >
      {children}
    </Element>
  );
});
