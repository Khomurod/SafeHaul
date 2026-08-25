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
 * Optional colour tone layered over a variant, for actions whose meaning is
 * carried by colour in the domain (a signing submit reads as green). `default`
 * leaves the variant's own colours alone. Tone never replaces a text label:
 * callers must still say what the action does.
 */
const TONES = new Set(['default', 'success']);

function normalizeOption(value, options, fallback, name) {
  const normalized = value ?? fallback;
  if (!options.has(normalized)) {
    throw new TypeError(`Unsupported Button ${name}: ${normalized}`);
  }
  return normalized;
}

export const Button = forwardRef(function Button({
  children,
  variant = 'secondary',
  size = 'md',
  tone = 'default',
  loading = false,
  disabled = false,
  fullWidth = false,
  justify = 'center',
  className = '',
  type = 'button',
  ...props
}, ref) {
  const normalizedVariant = normalizeOption(variant, VARIANTS, 'secondary', 'variant');
  const normalizedSize = normalizeOption(size, SIZES, 'md', 'size');
  const normalizedTone = normalizeOption(tone, TONES, 'default', 'tone');

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`ds-button ${className}`.trim()}
      data-variant={normalizedVariant}
      data-size={normalizedSize}
      data-tone={normalizedTone === 'default' ? undefined : normalizedTone}
      data-full-width={fullWidth || undefined}
      data-justify={justify}
      disabled={disabled || loading}
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
  ...props
}, ref) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('IconButton requires a non-empty label.');
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
      aria-label={label}
    >
      {children}
    </Button>
  );
});
