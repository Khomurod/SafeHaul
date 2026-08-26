import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card, StatusMedallion } from '@design-system/components';
import './PageState.css';

/**
 * Loading, empty and error — the three states every data-backed page has, and
 * the three most often left to chance.
 *
 * The catalog documented this composition long before it existed as a
 * component, so every screen that needed one hand-composed `Card` +
 * `StatusMedallion` + heading + body + actions with inline styles, and no two
 * were quite the same. This is that composition, once.
 *
 * The part that is not decoration is **how each state is announced**. A state
 * that only appears is a state a screen-reader user never learns about:
 *
 * - Loading and empty are `role="status"` — polite. They must not interrupt.
 * - Errors are `role="alert"` — assertive. They are announced immediately,
 *   because the user is otherwise waiting for something that is not coming.
 *
 * Getting that wrong in either direction is a real defect: a polite error is
 * silent until the user happens to navigate to it, and an assertive empty state
 * interrupts whatever they were reading to tell them about nothing.
 *
 * The medallion is `aria-hidden` by construction, so the heading and body must
 * distinguish the states with the colour removed.
 */

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const ANNOUNCEMENTS = new Set(['polite', 'assertive', 'off']);
const HEADING_LEVELS = new Set([1, 2, 3, 4, 5, 6]);
const SURFACES = new Set(['card', 'bare', 'inverse']);

function liveRegionProps(announce) {
  if (announce === 'off') return {};
  if (announce === 'assertive') return { role: 'alert' };
  return { role: 'status' };
}

/**
 * The shared shell. Prefer `EmptyState`, `ErrorState` or `LoadingState`, which
 * pick the tone and the announcement for you — that is the decision most easily
 * got wrong. Reach for `PageState` directly only for a state that is none of
 * the three (a permissions boundary, an expired link, a completed handoff).
 *
 * @param {object} props
 * @param {'neutral'|'info'|'success'|'warning'|'danger'|'accent'} props.tone
 * @param {React.ElementType} [props.icon] Decorative; the medallion is aria-hidden.
 * @param {string} props.title Required. It carries the meaning, not the tone.
 * @param {React.ReactNode} [props.description] Plain words: what happened, and what next.
 * @param {React.ReactNode} [props.actions] The way forward. A state with no way
 *   forward is not a state, it is a wall — see the README before omitting it.
 * @param {React.ReactNode} [props.children] A small amount of extra content
 *   between the description and the actions: a confirmation reference, a
 *   checklist of what is still outstanding. Not a second layout — anything that
 *   needs its own structure is a page, not a state.
 * @param {boolean} [props.focusOnMount] Move focus to the heading when the state
 *   appears. For a state that REPLACES the control the user just activated — a
 *   submitted form, a completed handoff — where focus would otherwise fall to
 *   `<body>` and a keyboard or screen-reader user would not be told the thing
 *   they did had worked. Announcement alone does not move the reading position.
 * @param {string} [props.className] Goes on the **state** element, never on the
 *   surface — so with the default `surface="card"` it lands *inside* the card.
 *   A width or margin belongs on a wrapper `<div>` around `PageState`, which is
 *   the shape `ErrorBoundary` has always used. Getting this wrong is not
 *   hypothetical: nine of the fifteen screens migrated on 2026-08-25 first
 *   passed `className="max-w-md"` here, which constrained the text inside a
 *   full-width card instead of narrowing the card, and it looks close enough to
 *   right that only reading the diff caught it. Every remaining prop goes to the
 *   surface instead (the `Card` for `card`, the state element for `bare` and
 *   `inverse`), which is where a caller's `id` or `aria-labelledby` belongs.
 * @param {'polite'|'assertive'|'off'} [props.announce] Defaults to assertive for
 *   `danger`, polite otherwise. `off` is for a state rendered as ordinary page
 *   content on navigation rather than appearing in response to something.
 * @param {1|2|3|4|5|6} [props.headingLevel=2] Match the surrounding outline. A
 *   state inside a section that already has an `<h2>` needs `3`.
 * @param {string} [props.titleId] An `id` for the heading, so a surrounding
 *   landmark or dialog can point `aria-labelledby` at it. A full-page state IS
 *   the name of its `<main>`, and `role="status"` is not a valid role for
 *   `<main>`, so the landmark and the live region have to be separate elements —
 *   which leaves the landmark with nothing to be named by unless the heading has
 *   an id. Without this the alternative is duplicating the title into an
 *   `aria-label`, i.e. two copies of one string.
 * @param {'card'|'bare'|'inverse'} [props.surface='card'] `bare` when it already
 *   sits inside a `Card` — nesting two card surfaces is the defect that
 *   produces. `inverse` for a state rendered on a dark console surface
 *   (`--ds-color-surface-inverse`): it drops the card and recolours the title
 *   and description to the on-inverse roles, because the default content
 *   colours are dark text and would be invisible there.
 */
export function PageState({
  tone = 'neutral',
  icon: Icon,
  title,
  description,
  actions,
  children,
  announce,
  focusOnMount = false,
  headingLevel = 2,
  titleId,
  surface = 'card',
  className = '',
  ...props
}) {
  /*
   * Hooks first, above the validation throws. A `throw` is not a conditional
   * return — a render that throws does not complete — but keeping every hook
   * ahead of every guard is the rule that never needs that argument made.
   */
  const headingRef = useRef(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported PageState tone: ${tone}`);
  }
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('PageState requires a title. The tone is not the message.');
  }
  if (!HEADING_LEVELS.has(headingLevel)) {
    throw new TypeError(`Unsupported PageState headingLevel: ${headingLevel}`);
  }

  const resolvedAnnounce = announce ?? (tone === 'danger' ? 'assertive' : 'polite');
  if (!ANNOUNCEMENTS.has(resolvedAnnounce)) {
    throw new TypeError(`Unsupported PageState announce: ${resolvedAnnounce}`);
  }

  if (!SURFACES.has(surface)) {
    throw new TypeError(`Unsupported PageState surface: ${surface}`);
  }

  const Heading = `h${headingLevel}`;
  const body = (
    <div
      {...liveRegionProps(resolvedAnnounce)}
      className={`ds-page-state ${className}`.trim()}
      data-tone={tone}
      data-surface={surface}
    >
      {Icon && (
        <StatusMedallion tone={tone} size="lg">
          <Icon aria-hidden="true" />
        </StatusMedallion>
      )}
      <Heading
        id={titleId}
        ref={headingRef}
        tabIndex={focusOnMount ? -1 : undefined}
        className="ds-page-state__title"
      >
        {title}
      </Heading>
      {description && <p className="ds-page-state__description">{description}</p>}
      {children && <div className="ds-page-state__content">{children}</div>}
      {actions && <div className="ds-page-state__actions">{actions}</div>}
    </div>
  );

  // `bare` and `inverse` put the remaining props on the state itself; `card`
  // puts them on the surface, which is where a caller's `id` or
  // `aria-labelledby` belongs. The padding lives on `.ds-page-state`, so a
  // card-less state keeps its own spacing.
  if (surface !== 'card') {
    return React.cloneElement(body, props);
  }
  return <Card padding="none" {...props}>{body}</Card>;
}

/**
 * Nothing to show.
 *
 * Takes no default icon, unlike the other two: what "nothing here" looks like
 * depends entirely on what is missing, and a generic glyph would say less than
 * none. Pass one.
 *
 * **Empty is not one state.** Three situations look identical and must not read
 * identically — nothing exists yet, nothing matches the current filters, or
 * nothing is visible to you. Say which. Implying data does not exist when the
 * caller simply cannot see it is the worst of the three.
 */
export function EmptyState({ tone = 'neutral', ...props }) {
  return <PageState {...props} tone={tone} announce="polite" />;
}

/**
 * Something failed. Announced immediately, and always with a retry.
 *
 * Defaults to a warning medallion, so an error state is never the only one of
 * the three rendered without one — the first review of this component caught
 * exactly that, three cards in a column with the middle one a different shape.
 * `ConfirmDialog` sets its tone icons the same way.
 *
 * If rows are already on screen, do **not** replace them with this. Keep the
 * stale data and report the failure above it — discarding what the user can
 * already read is strictly worse than showing it with a warning.
 */
export function ErrorState({ icon = AlertTriangle, ...props }) {
  return <PageState {...props} icon={icon} tone="danger" announce="assertive" />;
}

/**
 * Work in progress. Announced politely, and never with actions — there is
 * nothing to do but wait, and a control here would be a control that does
 * nothing.
 *
 * Defaults to a turning spinner, for the same reason `ErrorState` defaults its
 * icon: the three states have to be the same shape as each other.
 *
 * A bare spinner is not a loading state: it announces nothing. The title is the
 * announcement. Where the shape of the incoming content is known, a skeleton
 * that preserves the layout is better than this, because it stops the page
 * jumping when data arrives and moving focus targets out from under the user.
 */
export function LoadingState({ tone = 'info', icon = Loader2, className = '', ...props }) {
  if (props.actions) {
    throw new TypeError('LoadingState takes no actions: there is nothing to do but wait.');
  }
  return (
    <PageState
      {...props}
      icon={icon}
      tone={tone}
      announce="polite"
      className={`ds-page-state--loading ${className}`.trim()}
    />
  );
}
