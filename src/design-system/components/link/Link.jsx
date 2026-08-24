import React, { forwardRef } from 'react';
import './Link.css';
import '../button/Button.css';

/**
 * Navigation primitives: an inline text link, and anchors that wear the
 * `Button` shape.
 *
 * These exist because eleven styled `<a>` elements had accumulated across the
 * product with four different underline treatments, three different focus
 * treatments, one raw `text-blue-600`, and — in every single external case —
 * **no announcement that the link opens a new tab**. `target="_blank"` with no
 * warning is a WCAG 3.2.5 failure and is disorienting for a screen-reader or
 * magnifier user, who simply loses the page.
 *
 * A link navigates; a button acts. That distinction is not cosmetic: it decides
 * the announced role, whether Enter or Space activates it, and whether the
 * browser offers "open in new tab". Do not style a `<button>` as a link to get
 * the look, and do not use an `<a>` with an `onClick` and no `href` to get a
 * button — screen readers announce the lie either way.
 */

const EXTERNAL_HINT = 'opens in a new tab';

/**
 * `external` is the reason this component exists. It sets `target` and the
 * `rel` that closes the reverse-tabnabbing hole, and appends a
 * visually-hidden hint so the new tab is announced rather than discovered.
 */
function externalProps(external) {
  if (!external) return {};
  return { target: '_blank', rel: 'noopener noreferrer' };
}

function ExternalHint({ external }) {
  if (!external) return null;
  return <span className="ds-visually-hidden"> ({EXTERNAL_HINT})</span>;
}

/**
 * An inline text link, for a link inside a sentence or beside body text.
 *
 * @param {object} props
 * @param {string} props.href Required — a link without a destination is a button.
 * @param {boolean} [props.external] Opens a new tab, announced and `rel`-protected.
 * @param {'default'|'quiet'|'bare'} [props.tone]
 *   - `quiet` inherits the surrounding colour for a link inside already-coloured
 *     text; it keeps the underline, which is what still distinguishes it.
 *   - `bare` drops the colour *and* the underline, for a link whose content is
 *     not text — a thumbnail, a logo. WCAG 1.4.1 asks that a link be
 *     distinguishable from the text around it; an image link has no surrounding
 *     text to be confused with, and underlining an image is meaningless. It
 *     keeps the focus ring, which is the part that does matter.
 */
export const Link = forwardRef(function Link({
  href,
  external = false,
  tone = 'default',
  className = '',
  children,
  ...props
}, ref) {
  if (typeof href !== 'string' || href.trim() === '') {
    throw new TypeError('Link requires a non-empty href. For an action, use Button.');
  }

  return (
    <a
      {...props}
      {...externalProps(external)}
      ref={ref}
      href={href}
      className={`ds-link ${className}`.trim()}
      data-tone={tone === 'default' ? undefined : tone}
    >
      {children}
      <ExternalHint external={external} />
    </a>
  );
});

/**
 * An anchor wearing the `Button` shape, for a navigation that is presented as a
 * primary or secondary action. It reuses `Button.css` outright, so it takes the
 * same control height, padding, icon size and focus ring — the point is that a
 * "Download" link beside a "Delete" button is the same size and shape as it.
 *
 * It has no `loading` or `disabled`: an anchor cannot be either. A navigation
 * that is unavailable should not be rendered as a link at all.
 */
export const ButtonLink = forwardRef(function ButtonLink({
  href,
  external = false,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  justify = 'center',
  className = '',
  children,
  ...props
}, ref) {
  if (typeof href !== 'string' || href.trim() === '') {
    throw new TypeError('ButtonLink requires a non-empty href. For an action, use Button.');
  }

  return (
    <a
      {...props}
      {...externalProps(external)}
      ref={ref}
      href={href}
      className={`ds-button ${className}`.trim()}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth || undefined}
      data-justify={justify}
    >
      <span className="ds-button__content">
        {children}
        <ExternalHint external={external} />
      </span>
    </a>
  );
});

/**
 * An icon-only `ButtonLink`. `label` is required for the same reason it is on
 * `IconButton`: a glyph has no accessible name, and "link" is not one.
 */
export const IconButtonLink = forwardRef(function IconButtonLink({
  label,
  className = '',
  children,
  ...props
}, ref) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('IconButtonLink requires a non-empty label.');
  }

  return (
    <ButtonLink
      {...props}
      ref={ref}
      className={`ds-icon-button ${className}`.trim()}
      aria-label={props.external ? `${label} (${EXTERNAL_HINT})` : label}
    >
      {children}
    </ButtonLink>
  );
});
