/**
 * Deterministic catalog fixtures.
 *
 * Every value here is a hand-written literal. There is no `Math.random`, no
 * `Date.now()`, no `faker`, and no network or Firebase access anywhere in the
 * catalog — a story that renders differently on two runs is worthless for
 * review, and a story that reaches a real service is a data-exposure risk.
 *
 * The vocabulary is deliberately business-neutral. The catalog documents the
 * design system, so it must not know that SafeHaul has drivers, recruiters,
 * carriers or signing requests. Fixtures talk about "records", "owners" and
 * "references"; features supply the real domain words at the call site.
 *
 * The rows are chosen to exercise the awkward cases on purpose:
 * - a very short title and a very long one, so alignment can be judged;
 * - rows with missing secondary information, so empty cells are visible;
 * - every status tone, so no tone is left unreviewed.
 */

/** @typedef {'neutral'|'info'|'success'|'warning'|'danger'|'accent'} Tone */

/**
 * @type {ReadonlyArray<{
 *   id: string,
 *   title: string,
 *   reference: string,
 *   owner: string | null,
 *   region: string | null,
 *   status: string,
 *   tone: Tone,
 *   updated: string,
 *   items: number,
 * }>}
 */
export const RECORDS = Object.freeze([
  {
    id: 'rec-001',
    title: 'Ash',
    reference: 'REC-000101',
    owner: 'A. Okonkwo',
    region: 'North',
    status: 'Complete',
    tone: 'success',
    updated: '12 Mar 2026',
    items: 8,
  },
  {
    id: 'rec-002',
    title:
      'Quarterly consolidated review of every retained record held under the extended retention policy',
    reference: 'REC-000102',
    owner: 'M. Delacroix-Whitfield',
    region: 'South',
    status: 'In review',
    tone: 'info',
    updated: '11 Mar 2026',
    items: 142,
  },
  {
    id: 'rec-003',
    title: 'Northern intake batch',
    reference: 'REC-000103',
    // Missing secondary information: the table must render a real placeholder,
    // not an empty cell that looks like a rendering bug.
    owner: null,
    region: null,
    status: 'Pending',
    tone: 'warning',
    updated: '11 Mar 2026',
    items: 3,
  },
  {
    id: 'rec-004',
    title: 'Archived duplicate entry',
    reference: 'REC-000104',
    owner: 'J. Park',
    region: 'East',
    status: 'Archived',
    tone: 'neutral',
    updated: '02 Mar 2026',
    items: 0,
  },
  {
    id: 'rec-005',
    title: 'Blocked submission',
    reference: 'REC-000105',
    owner: 'S. Nakamura',
    region: null,
    status: 'Blocked',
    tone: 'danger',
    updated: '28 Feb 2026',
    items: 1,
  },
  {
    id: 'rec-006',
    title: 'Priority escalation',
    reference: 'REC-000106',
    owner: 'R. Bello',
    region: 'West',
    status: 'Escalated',
    tone: 'accent',
    updated: '27 Feb 2026',
    items: 24,
  },
]);

/** Placeholder for a value the record genuinely does not have. */
export const NOT_PROVIDED = 'Not provided';

/** Section-navigation groups used by the layout and pattern stories. */
export const NAVIGATION_GROUPS = Object.freeze([
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'details', label: 'Details' },
      { id: 'history', label: 'History' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { id: 'preferences', label: 'Preferences' },
      { id: 'notifications', label: 'Notifications' },
      {
        id: 'advanced',
        label: 'Advanced options that are unavailable for this record',
        disabled: true,
      },
    ],
  },
]);
