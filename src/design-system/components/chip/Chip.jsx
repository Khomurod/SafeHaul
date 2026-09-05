import React, { forwardRef } from 'react';
import { Check } from '../../icons';
import { Icon } from '../../icons/Icon';
import './Chip.css';

/**
 * A chip is the interactive twin of `Badge`: the same pill, the same 12px
 * semibold text, the same six status tints, the same 12px leading glyph — but
 * it can be clicked, followed, or pressed.
 *
 * ## Why this is not one of the primitives we already have
 *
 * - **not `Badge`** — a badge states something; a chip does something.
 * - **not `Button`** — a 24px pill with 12px text is deliberately off the button
 *   scale. `Button` starts at 36px and refuses anything under it except the
 *   icon-only `xs` step, because a labelled control that small cannot fit text
 *   with any padding.
 * - **not `SegmentedControl`** — measured, and recorded in the two allowlist
 *   entries this component retires: it is a 44px card grid and single-select by
 *   contract (`value` is a scalar), where the campaign audience filters are a
 *   multi-select `status` array. Adopting it would double the height of a filter
 *   strip that sits above a dense table.
 * - **not `Link` / `ButtonLink`** — the `tel:` chip in the call-outcome dialog
 *   is a tinted inline token; those two are underlined text and a button-shaped
 *   anchor.
 */
const TONES = new Set(['default', 'neutral', 'info', 'success', 'warning', 'danger', 'accent']);

/**
 * Named after the shared control-height steps rather than a private scale, so
 * one vocabulary covers the whole control family: `xs` is the same 24px as
 * `IconButton size="xs"` (the WCAG 2.2 SC 2.5.8 minimum) and `sm` is the same
 * 36px as `Button size="sm"`.
 */
const SIZES = new Set(['xs', 'sm']);

export const Chip = forwardRef(function Chip({
  children,
  icon,
  tone = 'default',
  size = 'xs',
  pressed,
  href,
  external = false,
  type = 'button',
  className = '',
  ...props
}, ref) {
  if (!TONES.has(tone)) {
    throw new TypeError(
      `Unsupported Chip tone: ${tone}. Expected one of ${[...TONES].map((t) => `'${t}'`).join(', ')}.`,
    );
  }
  if (!SIZES.has(size)) {
    throw new TypeError(`Unsupported Chip size: ${size}. Expected 'xs' or 'sm'.`);
  }
  /*
   * A link goes somewhere; it is not a two-state control. `aria-pressed` on an
   * anchor is invalid ARIA, and a screen reader announcing "link, not pressed"
   * for a phone number is worse than silence — so this is a refusal rather than
   * a quiet drop, and it names the two shapes that are actually wanted.
   */
  if (href !== undefined && pressed !== undefined) {
    throw new TypeError(
      'Chip cannot be both a link and a toggle. Drop `href` for a toggle, or `pressed` for a link.',
    );
  }
  if (href === undefined && external) {
    throw new TypeError('Chip `external` only means something with an `href`.');
  }

  const isPressed = pressed === true;
  const shared = {
    ...props,
    ref,
    className: `ds-chip ${className}`.trim(),
    'data-tone': tone === 'default' ? undefined : tone,
    'data-size': size,
    'data-pressed': isPressed || undefined,
  };

  /*
   * The check is the reason a pressed chip is not colour alone. It is added
   * beside the chip's own glyph rather than replacing it, so pressing a chip
   * never removes information: `Badge` sizes its glyph the same way, and both
   * stay at `xs` at either chip height, because a 12px glyph beside 12px text is
   * the pairing rather than a fraction of the control.
   */
  const content = (
    <>
      {isPressed && <Icon icon={Check} size="xs" />}
      {icon && <Icon icon={icon} size="xs" />}
      {children}
    </>
  );

  if (href !== undefined) {
    return (
      <a
        {...shared}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <button {...shared} type={type} aria-pressed={pressed === undefined ? undefined : isPressed}>
      {content}
    </button>
  );
});

/**
 * The named group a set of chips needs. "Pressed" on its own does not say what
 * was chosen, so the group carries the name — `ariaLabelledBy` when the words
 * are already on screen, which is the better of the two for the same reason
 * `SegmentedControl` gives: duplicating a visible label in an `aria-label` is
 * how the two drift apart.
 */
export function ChipGroup({
  children,
  ariaLabel,
  ariaLabelledBy,
  className = '',
  ...props
}) {
  const named = (typeof ariaLabel === 'string' && ariaLabel.trim() !== '')
    || (typeof ariaLabelledBy === 'string' && ariaLabelledBy.trim() !== '');
  if (!named) {
    throw new TypeError('ChipGroup requires an ariaLabel or ariaLabelledBy naming the set.');
  }

  return (
    <div
      {...props}
      role="group"
      /* One or the other, never both: with both set the accname algorithm
         silently prefers `aria-labelledby` and the `aria-label` becomes a lie
         nobody can see. */
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`ds-chip-group ${className}`.trim()}
    >
      {children}
    </div>
  );
}
