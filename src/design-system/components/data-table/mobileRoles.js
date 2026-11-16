/**
 * Phone cards with roles (`roleCards.css`).
 *
 * A `mobilePresentation="cards"` table whose columns state a `mobileRole`
 * draws each card as one record rather than a list of labelled values: a
 * leading avatar or icon (`lead`), the row header as its title, statuses in the
 * top-right corner, short facts inline after the title (`meta`, each after its
 * `mobileLabel` when it has one, left out when empty), whole lines (`line`),
 * the actions across the card's width, and nothing of a `hidden` column. Once
 * any column states a role, the row header is the title and a column that
 * states none is a `meta` item. A table whose columns state no role keeps the
 * label-and-value card (`mobileCards.css`), so a list that has not opted in
 * does not move.
 */

/** Whether a table draws its cards by role: cards, and at least one role stated. */
export function usesMobileRoles(cards, columns) {
  return cards && columns.some((column) => column.mobileRole !== undefined);
}

/** A column's place on the card once roles are on. */
export function cardRoleOf(column) {
  if (column.mobileRole) return column.mobileRole;
  return column.rowHeader ? 'title' : 'meta';
}

/**
 * The words before an inline value: the column's own `mobileLabel`, trimmed
 * (the stylesheet puts one space after it), or none. Unlike the
 * label-and-value card, a role card never falls back to the header: "Reefer ·
 * IL" reads without "Freight · State" before it.
 */
export function cardLabelOf(column, role) {
  if (role !== 'meta' && role !== 'line') return undefined;
  const label = typeof column.mobileLabel === 'string' ? column.mobileLabel.trim() : '';
  return label || undefined;
}

/** The marks a cell uses for "no value", which an inline item leaves out. */
const EMPTY_MARKS = new Set(['', '—', '–', '-']);

/**
 * Whether what a cell rendered says nothing, so a card leaves it out rather
 * than showing a label beside a dash. An element is never empty: what it draws
 * is the feature's.
 */
export function isEmptyCellContent(content) {
  if (content === null || content === undefined || content === false) return true;
  if (typeof content === 'string') return EMPTY_MARKS.has(content.trim());
  if (Array.isArray(content)) return content.every(isEmptyCellContent);
  return false;
}
