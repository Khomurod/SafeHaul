import { contractViolation } from '../../contract';

/**
 * Sorting by a column header. The table draws the control and says which order
 * is in force; the feature owns the order itself, as `sort` and `onSortChange`.
 *
 * One column is sorted at a time and the list always has an order, so a header
 * has two states, never "unsorted": pressing the sorted column turns its
 * direction, pressing another column sorts by it in its `first` direction.
 */

const SORT_DIRECTIONS = new Set(['asc', 'desc']);

/** The order a press on this column's header asks for. */
export function nextSortDirection(column, sort) {
  if (sort?.key === column.key) return sort.direction === 'asc' ? 'desc' : 'asc';
  return column.sortable.first;
}

/** `aria-sort` for a header: only the sorted column carries it. */
export function ariaSortOf(column, sort) {
  if (!column.sortable || sort?.key !== column.key) return undefined;
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Reports a sort setting the table cannot act on. */
export function checkSort(columns, sort, onSortChange) {
  const sortable = columns.filter((column) => column.sortable);
  if (sortable.length > 0 && typeof onSortChange !== 'function') {
    contractViolation('A DataTable with a sortable column needs onSortChange.');
  }
  if (sort === undefined || sort === null) return;
  if (!sortable.some((column) => column.key === sort.key)) {
    contractViolation(`DataTable sort.key "${sort.key}" is not a sortable column.`);
  }
  if (!SORT_DIRECTIONS.has(sort.direction)) {
    contractViolation(`Unsupported DataTable sort direction "${sort.direction}".`);
  }
}
