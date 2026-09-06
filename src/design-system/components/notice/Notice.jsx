import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Icon as DsIcon, Info, Sparkles } from '../../icons';
import './Notice.css';

const SIZES = new Set(['md', 'sm']);
const ANNOUNCE = { off: undefined, polite: 'status', assertive: 'alert' };
const TITLE_ELEMENTS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'h6']);

/*
 * The per-tone glyph, chosen from what the application already reaches for
 * rather than from taste. Counted across the 64 notices the 6a audit found:
 *
 *   danger   AlertCircle x13, AlertTriangle x5, Info x1
 *   success  CheckCircle x6, Clock x1, CheckCircle2 x1, ...
 *   warning  AlertTriangle x4, AlertCircle x2, ...
 *   info     Info x3, Zap x1, Loader2 x1, ...
 *   accent   (none — see below)
 *   neutral  (none — nothing uses a neutral notice today)
 *
 * Three departures from the raw tally, all stated rather than slipped in:
 *
 * - **success takes `CheckCircle2`, not `CheckCircle`.** The tally favours the
 *   older alias 6 to 1, but the two are different marks — `CheckCircle` breaks
 *   the tick out through the ring, `CheckCircle2` closes it — and the closed
 *   form is what reads as a success mark and what `SectionNavigation` already
 *   ships for `status="complete"`. One vocabulary inside the design system beats
 *   matching a majority outside it.
 * - **neutral takes `Info` on no evidence**, because nothing uses a neutral
 *   notice. It is the least assertive glyph available.
 * - **accent takes `Sparkles` on no evidence either**, and this one is a
 *   correction. An earlier count credited accent with one site,
 *   `EnvelopeSidebar:272`. Reading it showed a `<Button>` and its own helper
 *   text inside a tint — a call-to-action panel, not a message — so it is not a
 *   notice and does not migrate. Accent has **zero** consumers; `Sparkles` is
 *   a guess that happens to suit the tone this application uses accent for.
 *
 * Both guesses are recorded as guesses so the first real consumer can overrule
 * them without arguing with a number that was never there.
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
 *
 * ## `actions` sit UNDER the message, and that is the second measurement
 *
 * This shipped with the actions in a trailing slot beside the message, wrapping
 * underneath below 640px. The first migration area disagreed, so it was checked
 * rather than defended: Atlassian's `SectionMessage` renders actions after the
 * content ("this placement allows users to read the full message before
 * encountering available actions"), Polaris' `Banner` puts its primary and
 * secondary actions in a footer under the body, and the tinted blocks in this
 * tree that carry a button put it under the message 2 to 1. Carbon's inline
 * notification is the one published system that keeps it inline — and it moves
 * it underneath at narrow widths, which is the tell.
 *
 * So actions render inside the body column, after the message. The whole
 * `@media (max-width: 639px)` block that used to unwind the trailing placement
 * is gone with it: an action that was never beside the message has nothing to
 * wrap out of.
 *
 * ## `titleAs`, because eight titles in this tree are real headings
 *
 * The title renders as a `<p>` by default, which is what 11 of the 19 titled
 * blocks here do. Eight use an actual `<h2>`, `<h3>` or `<h4>` — a dialog's
 * disclosure heading, a status screen's own heading — and both Polaris' `Banner`
 * and Atlassian's `SectionMessage` render their title as a heading. Flattening
 * those eight to a paragraph would take them out of the document outline a
 * screen-reader user navigates by, silently and invisibly.
 *
 * `titleAs` takes the element, never a level the component picked: `p` when
 * there is no outline to join, `h2`-`h6` when the caller knows where it sits.
 * The look does not change with it — the design system owns that.
 *
 * ## It draws a focus ring because it is a focus target
 *
 * `forwardRef` plus the `tabIndex` pass-through exist so a form can move focus
 * to the error summary it just rendered — three consumers in the first area do
 * exactly that. Moving the caret somewhere with no visible ring is worse than
 * not moving it, so the ring is the component's, not a caller's utility class.
 */
export const Notice = React.forwardRef(function Notice({
  tone = 'info',
  title,
  titleAs = 'p',
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
  if (!TITLE_ELEMENTS.has(titleAs)) {
    throw new TypeError(`Unsupported Notice titleAs: ${titleAs}`);
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
        {title && React.createElement(titleAs, { className: 'ds-notice__title' }, title)}
        {children && <div className="ds-notice__message">{children}</div>}
        {actions && <div className="ds-notice__actions">{actions}</div>}
      </div>
    </div>
  );
});

export default Notice;
