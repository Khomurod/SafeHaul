import { contractViolation } from '../../contract';
const ALIGNMENTS = new Set(['start', 'center', 'end']);
const WIDTHS = new Set(['auto', 'xs', 'sm', 'md', 'lg', 'xl', 'actions']);
const PRIORITIES = new Set(['primary', 'secondary', 'tertiary', 'actions']);

export const TABLE_COLUMN_ALIGNMENTS = Object.freeze([...ALIGNMENTS]);
export const TABLE_COLUMN_WIDTHS = Object.freeze([...WIDTHS]);
export const TABLE_COLUMN_PRIORITIES = Object.freeze([...PRIORITIES]);

/**
 * Defines the business-neutral column contract shared by every approved table.
 *
 * Alignment and width are single values on the column so headers and cells
 * cannot drift apart. Feature modules continue to own labels, cell content,
 * sorting callbacks, and which actions are available.
 */
export function defineTableColumns(columns) {
  if (!Array.isArray(columns)) {
    contractViolation('DataTable columns must be an array.');
    return Object.freeze([]);
  }

  const keys = new Set();

  // In a production build a check reports and returns (`contractViolation`): a
  // column that cannot be drawn, or not told apart from another by its key (the
  // React key of its header and of every cell), is left out, and a bad option
  // takes its default.
  return Object.freeze(columns.flatMap((column) => {
    if (!column || typeof column !== 'object') {
      contractViolation('Each DataTable column must be an object.');
      return [];
    }

    if (typeof column.key !== 'string' || column.key.trim() === '') {
      contractViolation('Each DataTable column requires a non-empty string key.');
      return [];
    }

    if (keys.has(column.key)) {
      contractViolation(`Duplicate DataTable column key: ${column.key}`);
      return [];
    }
    keys.add(column.key);

    if (typeof column.render !== 'function') {
      contractViolation(`DataTable column "${column.key}" requires a render function.`);
      return [];
    }

    const defaultPriority = column.rowHeader ? 'primary' : 'secondary';
    let align = column.align ?? 'start';
    let width = column.width ?? 'auto';
    let priority = column.priority ?? defaultPriority;
    let { mobileLabel } = column;

    if (!ALIGNMENTS.has(align)) {
      contractViolation(`Unsupported DataTable alignment "${align}" for "${column.key}".`);
      align = 'start';
    }

    if (!WIDTHS.has(width)) {
      contractViolation(`Unsupported DataTable width "${width}" for "${column.key}".`);
      width = 'auto';
    }

    if (!PRIORITIES.has(priority)) {
      contractViolation(`Unsupported DataTable priority "${priority}" for "${column.key}".`);
      priority = defaultPriority;
    }

    // The label a cell shows beside its value when the table is cards on a phone;
    // `''` shows none, and the cell takes the card's full width.
    if (mobileLabel !== undefined && typeof mobileLabel !== 'string') {
      contractViolation(`DataTable column "${column.key}" needs a string mobileLabel.`);
      mobileLabel = undefined;
    }

    return [Object.freeze({
      ...column,
      align,
      width,
      priority,
      mobileLabel,
      rowHeader: Boolean(column.rowHeader),
      stopPropagation: Boolean(column.stopPropagation),
      truncate: Boolean(column.truncate),
    })];
  }));
}
