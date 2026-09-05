import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Icon as DsIcon, Info, Sparkles } from '../../icons';
import './Notice.css';

const SIZES = new Set(['md', 'sm']);
const ANNOUNCE = { off: undefined, polite: 'status', assertive: 'alert' };

/*
 * The per-tone glyph, chosen from what the application already reaches for
 * rather than from taste. Counted across the 64 notices the 6a audit found:
 *
 *   danger   AlertCircle x13, AlertTriangle x5, Info x1
 *   success  CheckCircle x6, Clock x1, CheckCircle2 x1, ...
 *   warning  AlertTriangle x4, AlertCircle x2, ...
 *   info     Info x3, Zap x1, Loader2 x1, ...
 *   accent   Sparkles x1
 *   neutral  (no toned notice uses it today)
 *
 * Two deliberate departures from the raw tally, both normalisations the
 * migration makes and both worth stating rather than slipping in:
 *
 * - **success takes `CheckCircle2`, not `CheckCircle`.** The tally favours the
 *   older alias 6 to 1, but the two are different marks — `CheckCircle` breaks
 *   the tick out through the ring, `CheckCircle2` closes it — and the closed
 *   form is what reads as a success mark and what `SectionNavigation` already
 *   ships for `status="complete"`. One vocabulary inside the design system beats
 *   matching a majority outside it.
 * - **neutral takes `Info`**, on no evidence, because nothing uses a neutral
 *   notice yet. It is the least assertive glyph available; revisit when a
 *   consumer appears.
 */
const TONES = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  accent: Sparkles,
};

/**
 * A tinted, bordered block carrying a short message.
 *
 * The single most copy-pasted shape in this application: the 2026-09-05 audit
 * found **66 of them across 52 files**, every one hand-built, every one using
 * `--ds-*` roles — which is why no colour rule ever saw them. The full audit,
 * including how the count was reached and what it deliberately excludes, is in
 * this directory's README.
 *
 * ## What it is not
 *
 * Six tinted blocks in the tree hold form controls rather than a message. Those
 * are highlighted *regions*, and `Notice` is the wrong answer for every one — a
 * distinction a shape-only rule cannot make, which is why `hand-composed-notice`
 * is scoped the way it is.
 *
 * `FieldMessage` owns a message about one form field. `PageState` owns a whole
 * empty or failed slot. This owns the block between them.
 *
 * ## `announce` defaults to off, and that is a measurement
 *
 * Only **26 of the 64** notices in the tree announce themselves today; 38 are
 * silent. Announcing by default would turn those 38 into interruptions, and most
 * describe something already visible beside them. The consumers that should
 * announce say so.
 *
 * `polite` renders `role="status"`, `assertive` renders `role="alert"`. Both are
 * mounted whether or not there is anything to say, because a live region added
 * to the DOM at the same moment as its content is not reliably announced.
 */
export const Notice = React.forwardRef(function Notice({
  tone = 'info',
  title,
  icon,
  actions,
  size = 'md',
  announce = 'off',
  className = '',
  children,
  ...props
}, ref) {
  if (!(tone in TONES)) {
    throw new TypeError(`Unsupported Notice tone: ${tone}`);
  }
  if (!SIZES.has(size)) {
    throw new TypeError(`Unsupported Notice size: ${size}`);
  }
  if (!(announce in ANNOUNCE)) {
    throw new TypeError(`Unsupported Notice announce: ${announce}`);
  }
  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    throw new TypeError('Notice title must be a non-empty string.');
  }

  /*
   * `null` hides the glyph; `undefined` takes the tone's own. The two are
   * deliberately different, so a caller can turn it off without having to know
   * which glyph they are turning off.
   */
  const Glyph = icon === null ? null : (icon ?? TONES[tone]);

  return (
    <div
      {...props}
      ref={ref}
      role={ANNOUNCE[announce]}
      className={`ds-notice ${className}`.trim()}
      data-tone={tone}
      data-size={size === 'md' ? undefined : size}
    >
      {Glyph && <DsIcon icon={Glyph} className="ds-notice__icon" />}
      <div className="ds-notice__body">
        {title && <p className="ds-notice__title">{title}</p>}
        {children && <div className="ds-notice__message">{children}</div>}
      </div>
      {actions && <div className="ds-notice__actions">{actions}</div>}
    </div>
  );
});

export default Notice;
