import React, { forwardRef } from 'react';
import './Button.css';

/**
 * `link` is the odd one out and is documented in `Button.css`: an action that
 * reads as inline text, which deliberately opts out of the control-height scale
 * because a 44px-tall link inside a form row pushes the text around it apart.
 * Use it only for a text action sitting beside other text; anything standing
 * alone as a control wants `ghost`, which keeps the full target size.
 */
const VARIANTS = new Set(['primary', 'secondary', 'ghost', 'danger', 'link']);
const SIZES = new Set(['sm', 'md', 'lg']);

/**
 * `xs` is 24px — the WCAG 2.2 SC 2.5.8 minimum — and it is an ICON-ONLY step.
 * A labelled button cannot fit 12px text with any padding at that height, so
 * `Button` refuses it and only `IconButton` reaches it.
 *
 * The two are told apart by `.ds-icon-button`, which `IconButton` always adds:
 * the same coupling `Button.css` already relies on to give an icon-only button
 * its square footprint. A caller who hand-writes that class on a plain `Button`
 * gets the icon-only treatment throughout, which is what they asked for.
 */
const ICON_ONLY_SIZES = new Set(['xs', 'sm', 'md', 'lg']);

/** How an icon-only control is cut. `square` is the control radius; `round` is a disc. */
const SHAPES = new Set(['square', 'round']);
/**
 * Optional colour tone layered over a variant, for actions whose meaning is
 * carried by colour in the domain (a signing submit reads as green). `default`
 * leaves the variant's own colours alone. Tone never replaces a text label:
 * callers must still say what the action does, because colour alone is not a
 * status.
 *
 * What a tone MEANS depends on the variant, and the pair is checked here rather
 * than left to CSS, so an unsupported combination names its call site instead of
 * rendering something nobody chose:
 *
 *   - on `primary` it FILLS, and only `success` is allowed. A primary action
 *     already carries the strongest emphasis on the page, so a second colour on
 *     top competes with that rather than adding to it. `success` predates this
 *     rule and keeps its meaning: a signing submit reads as green.
 *   - on `secondary` and `ghost` it is the status TINT trio — border, tinted
 *     background, status text — which is what eleven hand-rolled controls were
 *     drawing by hand before this existed.
 *   - `danger` and `link` take none. `danger` IS a tone, so a second one
 *     contradicts it; `link` has no box to tint.
 */
const TONES = new Set(['default', 'neutral', 'info', 'success', 'warning', 'danger', 'accent']);

/** Which tones each variant can carry. */
const TONES_BY_VARIANT = {
  primary: new Set(['default', 'success']),
  secondary: TONES,
  ghost: TONES,
  danger: new Set(['default']),
  link: new Set(['default']),
};

const TONE_REFUSALS = {
  danger: 'A danger button is already a tone; a second one contradicts it.',
  link: 'A link has no box to tint — use variant="ghost" if the action needs one.',
  primary: 'A primary action already carries the page\'s strongest emphasis, so a second '
    + 'colour competes with it rather than adding to it. Use variant="secondary" for a '
    + 'toned action.',
};

function assertTone(variant, tone) {
  if (TONES_BY_VARIANT[variant].has(tone)) return;
  const allowed = [...TONES_BY_VARIANT[variant]].map((value) => `'${value}'`).join(', ');
  throw new TypeError(
    `Button variant="${variant}" cannot carry tone="${tone}". It accepts ${allowed}. `
    + (TONE_REFUSALS[variant] ?? ''),
  );
}

function normalizeOption(value, options, fallback, name) {
  const normalized = value ?? fallback;
  if (!options.has(normalized)) {
    throw new TypeError(`Unsupported Button ${name}: ${normalized}`);
  }
  return normalized;
}

/**
 * A two-state control: `pressed` makes the button say which of the options is
 * on, in the contract rather than in a caller's class list.
 *
 * It exists because of a specificity trap this repository has now recorded
 * twice. The candidate list's two sort toggles marked the active direction with
 * a `text-ds-action-primary` utility at 0-1-0, and `.ds-button[data-variant]`
 * sets `color` at 0-2-0 — so migrating them without this prop would have
 * silently dropped the only indication of which sort was applied, exactly as
 * `Button.css` already records one property over for background overrides.
 *
 * `data-pressed` is styled at 0-3-0, where nothing feature-side can lose to it,
 * and it draws a fill and an inset ring rather than a colour swap: those
 * toggles' pressed state was colour ONLY, which is the signal that disappears
 * in forced-colours mode.
 *
 * A bare `aria-pressed` keeps working and is not the same thing. Nineteen call
 * sites already say `<Button aria-pressed={on} variant={on ? 'primary' : 'secondary'}>`,
 * which draws the pressed state out of the contract's own variants and is a
 * perfectly good answer. Use `pressed` when you want the toggle appearance
 * WITHOUT changing the variant — which is the case the sort toggles could not
 * express, and the reason this prop exists.
 */
export const Button = forwardRef(function Button({
  children,
  variant = 'secondary',
  size = 'md',
  tone = 'default',
  pressed,
  loading = false,
  disabled = false,
  fullWidth = false,
  justify = 'center',
  className = '',
  type = 'button',
  'aria-pressed': ariaPressed,
  ...props
}, ref) {
  const normalizedVariant = normalizeOption(variant, VARIANTS, 'secondary', 'variant');
  const iconOnly = className.split(/\s+/).includes('ds-icon-button');
  const normalizedSize = normalizeOption(
    size, iconOnly ? ICON_ONLY_SIZES : SIZES, 'md', 'size',
  );
  const normalizedTone = normalizeOption(tone, TONES, 'default', 'tone');
  assertTone(normalizedVariant, normalizedTone);

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`ds-button ${className}`.trim()}
      data-variant={normalizedVariant}
      data-size={normalizedSize}
      data-tone={normalizedTone === 'default' ? undefined : normalizedTone}
      data-pressed={pressed === true || undefined}
      data-full-width={fullWidth || undefined}
      data-justify={justify}
      disabled={disabled || loading}
      /* `aria-pressed` is destructured rather than left to the spread because
         this attribute sits after it: written as a conditional expression it
         would overwrite a caller's own value with `undefined` and delete it. */
      aria-pressed={pressed === undefined ? ariaPressed : pressed === true}
      aria-busy={loading || undefined}
    >
      {loading && <span className="ds-button__spinner" aria-hidden="true" />}
      <span className="ds-button__content">{children}</span>
    </button>
  );
});

export const IconButton = forwardRef(function IconButton({
  label,
  children,
  shape = 'square',
  ...props
}, ref) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('IconButton requires a non-empty label.');
  }
  if (!SHAPES.has(shape)) {
    throw new TypeError(
      `Unsupported IconButton shape: ${shape}. Expected 'square' or 'round'.`,
    );
  }
  /*
   * `link` zeroes the control height, which is right for a text action and
   * wrong for an icon-only one: `.ds-icon-button` sets only the width, so the
   * result is a 44px-wide, 16px-tall target — under the WCAG 2.5.8 minimum, and
   * with nothing but a bare glyph to aim at. An icon-only affordance keeps its
   * target size; use `ghost` for a quiet one.
   */
  if (props.variant === 'link') {
    throw new TypeError(
      'IconButton cannot use variant="link": it would drop below the minimum target size. Use variant="ghost".',
    );
  }

  return (
    <Button
      {...props}
      ref={ref}
      className={`ds-icon-button ${props.className || ''}`.trim()}
      data-shape={shape === 'square' ? undefined : shape}
      aria-label={label}
    >
      {children}
    </Button>
  );
});
