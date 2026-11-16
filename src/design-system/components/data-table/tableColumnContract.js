import { contractViolation } from '../../contract';
const ALIGNMENTS = new Set(['start', 'end']);
const WIDTHS = new Set(['auto', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'actions']);
const SORT_DIRECTIONS = new Set(['asc', 'desc']);
const SORT_LABELS = Object.freeze({ asc: 'Ascending', desc: 'Descending' });
/**
 * Where a column's value goes on a phone card (`mobilePresentation="cards"`):
 * `lead` the leading avatar or icon slot, `title` the row header, `status` the
 * top-right corner, `meta` an inline item after the title, `line` a line of its
 * own, `actions` the card's full width, `hidden` nowhere. See `mobileRoles.js`.
 */
const MOBILE_ROLES = new Set(['lead', 'title', 'status', 'meta', 'line', 'actions', 'hidden']);

export const TABLE_COLUMN_ALIGNMENTS = Object.freeze([...ALIGNMENTS]);
export const TABLE_COLUMN_WIDTHS = Object.freeze([...WIDTHS]);
export const TABLE_COLUMN_MOBILE_ROLES = Object.freeze([...MOBILE_ROLES]);

/**
 * Defines the business-neutral column contract shared by every approved table.
 *
 * Alignment and width are single values on the column so headers and cells
 * cannot drift apart. Text reads from the start edge and numbers line up on the
 * end edge; nothing is centred, because a centred column has no edge to scan.
 * Feature modules continue to own labels, cell content, sorting callbacks, and
 * which actions are available.
 */
export function defineTableColumns(columns) {
  if (!Array.isArray(columns)) {
    contractViolation('DataTable columns must be an array.');
    return Object.freeze([]);
  }

  const keys = new Set();
  const roleKeys = { lead: null, status: null };

  // In a production build a check reports and returns (`contractViolation`): a
  // column that cannot be drawn, or not told apart from another by its key (the
  // React key of its header and of every cell), is left out, and a bad option
  // takes its default.
  const defined = columns.flatMap((column) => {
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

    const sortable = sortableOf(column);

    let align = column.align ?? 'start';
    let width = column.width ?? 'auto';
    let { mobileLabel } = column;
    const mobileRole = mobileRoleOf(column, roleKeys);
    if (mobileRole === 'lead' || mobileRole === 'status') roleKeys[mobileRole] = column.key;

    if (!ALIGNMENTS.has(align)) {
      contractViolation(`Unsupported DataTable alignment "${align}" for "${column.key}".`);
      align = 'start';
    }

    if (!WIDTHS.has(width)) {
      contractViolation(`Unsupported DataTable width "${width}" for "${column.key}".`);
      width = 'auto';
    }

    // The label a cell shows beside its value when the table is cards on a phone;
    // `''` shows none, and the cell takes the card's full width.
    if (mobileLabel !== undefined && typeof mobileLabel !== 'string') {
      contractViolation(`DataTable column "${column.key}" needs a string mobileLabel.`);
      mobileLabel = undefined;
    }

    // A row header that draws its own `sm` avatar before its text (a person
    // cell); a row detail lines its words up with that text.
    let leadingAvatar = Boolean(column.leadingAvatar);
    if (leadingAvatar && !column.rowHeader) {
      contractViolation(`DataTable column "${column.key}" sets leadingAvatar, which only a row header (rowHeader: true) may.`);
      leadingAvatar = false;
    }

    return [Object.freeze({
      ...column,
      align,
      width,
      mobileLabel,
      mobileRole,
      sortable,
      leadingAvatar,
      rowHeader: Boolean(column.rowHeader),
      stopPropagation: Boolean(column.stopPropagation),
      truncate: Boolean(column.truncate),
    })];
  });
  return Object.freeze(placeLead(defined));
}

/**
 * The leading avatar or icon is the first column, the row header right after
 * it: the card draws it in the leading slot, and at 768px and up the pinned
 * column skips it to hold the column after it (`pinnedColumn.css`), which must
 * be what names the row. A lead anywhere else is reported and left out.
 */
function placeLead(columns) {
  const leadIndex = columns.findIndex((column) => column.mobileRole === 'lead');
  if (leadIndex === -1) return columns;
  const headerIndex = columns.findIndex((column) => column.rowHeader);
  if (leadIndex === 0 && (headerIndex === -1 || headerIndex === 1)) return columns;
  const lead = columns[leadIndex];
  contractViolation(leadIndex === 0
    ? `DataTable column "${lead.key}" takes the card's leading slot, so the row header must come right after it.`
    : `DataTable column "${lead.key}" takes the card's leading slot, so it must be the first column.`);
  return columns.map((column, index) => (
    index === leadIndex ? Object.freeze({ ...column, mobileRole: undefined }) : column
  ));
}

/**
 * The column's place on a phone card, or `undefined` for none stated. The row
 * header is the card's title, so it takes no other place; only one column may
 * hold the leading slot, and only one the status corner (several statuses go
 * in its one cell, one under another). `roleKeys` names the columns that took
 * those so far. A bad setting is reported and left out.
 */
function mobileRoleOf(column, roleKeys) {
  const { mobileRole } = column;
  if (mobileRole === undefined) return undefined;
  if (!MOBILE_ROLES.has(mobileRole)) {
    contractViolation(`Unsupported DataTable mobileRole "${mobileRole}" for "${column.key}"; use ${[...MOBILE_ROLES].join(', ')}.`);
    return undefined;
  }
  if (column.rowHeader && mobileRole !== 'title') {
    contractViolation(`DataTable column "${column.key}" is the row header, so on a card it is the title, not "${mobileRole}".`);
    return undefined;
  }
  if (!column.rowHeader && mobileRole === 'title') {
    contractViolation(`DataTable column "${column.key}" is the card title only if it is the row header (rowHeader: true).`);
    return undefined;
  }
  if (mobileRole === 'lead' && roleKeys.lead !== null) {
    contractViolation(`DataTable columns "${roleKeys.lead}" and "${column.key}" both take the card's leading slot; one may.`);
    return undefined;
  }
  if (mobileRole === 'status' && roleKeys.status !== null) {
    contractViolation(`DataTable columns "${roleKeys.status}" and "${column.key}" both take the card's status corner; put both statuses in one column.`);
    return undefined;
  }
  return mobileRole;
}

/**
 * A column the reader can sort by pressing its header: `sortable: true`, or
 * `{ first, labels }` — the direction a first press asks for (`asc` unless set)
 * and the words a phone's "Sort by" list uses for each direction. The feature
 * still owns the order itself (`DataTable`'s `sort` / `onSortChange`). Returns
 * the normalised setting, or `null` for a column that does not sort.
 */
function sortableOf(column) {
  const { sortable } = column;
  // `null` is what this function returns for a plain column, so a column list
  // that has already been through `defineTableColumns` passes again unchanged.
  if (sortable === undefined || sortable === null || sortable === false) return null;
  const spec = sortable === true ? {} : sortable;
  if (!spec || typeof spec !== 'object') {
    contractViolation(`DataTable column "${column.key}" has an unsupported sortable setting.`);
    return null;
  }
  // The header is the button's name and the phone's "Sort by" option.
  if (typeof column.header !== 'string' || column.header.trim() === '') {
    contractViolation(`Sortable DataTable column "${column.key}" needs a text header.`);
    return null;
  }
  const first = spec.first ?? 'asc';
  if (!SORT_DIRECTIONS.has(first)) {
    contractViolation(`Unsupported first sort direction "${first}" for "${column.key}".`);
    return null;
  }
  const labels = { ...SORT_LABELS, ...spec.labels };
  if (typeof labels.asc !== 'string' || typeof labels.desc !== 'string') {
    contractViolation(`DataTable column "${column.key}" needs string sort labels.`);
    return null;
  }
  return Object.freeze({ first, labels: Object.freeze(labels) });
}
