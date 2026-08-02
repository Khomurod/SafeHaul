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
    throw new TypeError('DataTable columns must be an array.');
  }

  const keys = new Set();

  return Object.freeze(columns.map((column) => {
    if (!column || typeof column !== 'object') {
      throw new TypeError('Each DataTable column must be an object.');
    }

    if (typeof column.key !== 'string' || column.key.trim() === '') {
      throw new TypeError('Each DataTable column requires a non-empty string key.');
    }

    if (keys.has(column.key)) {
      throw new TypeError(`Duplicate DataTable column key: ${column.key}`);
    }
    keys.add(column.key);

    if (typeof column.render !== 'function') {
      throw new TypeError(`DataTable column "${column.key}" requires a render function.`);
    }

    const align = column.align ?? 'start';
    const width = column.width ?? 'auto';
    const priority = column.priority ?? (column.rowHeader ? 'primary' : 'secondary');

    if (!ALIGNMENTS.has(align)) {
      throw new TypeError(`Unsupported DataTable alignment "${align}" for "${column.key}".`);
    }

    if (!WIDTHS.has(width)) {
      throw new TypeError(`Unsupported DataTable width "${width}" for "${column.key}".`);
    }

    if (!PRIORITIES.has(priority)) {
      throw new TypeError(`Unsupported DataTable priority "${priority}" for "${column.key}".`);
    }

    return Object.freeze({
      ...column,
      align,
      width,
      priority,
      rowHeader: Boolean(column.rowHeader),
      stopPropagation: Boolean(column.stopPropagation),
      truncate: Boolean(column.truncate),
    });
  }));
}
