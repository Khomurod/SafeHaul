import React, { memo, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Icon, Inbox } from '../../icons';
import { Button } from '../button';
import { defineTableColumns } from './tableColumnContract';
import { useCardsLayout } from './useCardsLayout';
import { ariaSortOf, checkSort } from './sorting';
import { CardSortControl, SortButton } from './SortControls';
import { TablePagination } from './TablePagination';
import { contractViolation } from '../../contract';
import './DataTable.css';
import './pinnedColumn.css';
import './mobileCards.css';

/**
 * The narrowest a table may get before its region scrolls sideways. `none` sets
 * no floor, for a small table whose columns squeeze to fit their container.
 */
const MIN_WIDTHS = new Set(['none', 'standard', 'wide']);

/**
 * The tallest the rows may get before they scroll under the sticky header:
 * `sm` 256px, `md` 400px. Without it the table grows with its rows, or fills a
 * parent of bounded height.
 */
const MAX_HEIGHTS = new Set(['sm', 'md']);

/**
 * The page sizes the "Rows per page" list may offer, or `null` for no list. A
 * setting the table cannot act on is reported and the list left out, so a
 * production build keeps Previous and Next rather than a list that does nothing.
 */
function usablePageSizes(pagination) {
  const sizes = pagination?.pageSizes;
  if (sizes === undefined || sizes === null) return null;
  const counts = Array.isArray(sizes) && sizes.length > 0
    && sizes.every((size) => Number.isInteger(size) && size > 0);
  if (!counts) {
    contractViolation('DataTable pagination.pageSizes must be a non-empty list of whole numbers above 0.');
    return null;
  }
  if (typeof pagination.onPageSizeChange !== 'function') {
    contractViolation('DataTable pagination.pageSizes needs pagination.onPageSizeChange.');
    return null;
  }
  if (!sizes.includes(pagination.pageSize)) {
    contractViolation(`DataTable pagination.pageSize "${pagination.pageSize}" is not one of pagination.pageSizes.`);
    return null;
  }
  return sizes;
}

/**
 * The label a cell shows beside its value as a card on a phone: the column's
 * `mobileLabel`, else its visible header, else its accessible one. `''` is none.
 */
function mobileLabelOf(column) {
  if (column.mobileLabel !== undefined) return column.mobileLabel || undefined;
  return (typeof column.header === 'string' && column.header) || column.headerLabel || undefined;
}

function SelectionCheckbox({ checked, indeterminate = false, label, onChange }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="ds-data-table__selection-control">
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}

function StateContent({ state, empty, error, loadingLabel }) {
  if (state === 'loading') {
    return (
      <div className="ds-data-table__state" role="status" aria-live="polite">
        <span className="sr-only">{loadingLabel}</span>
        <div className="ds-data-table__state-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="ds-data-table__state ds-data-table__state--error" role="alert">
        <Icon icon={AlertTriangle} size="3xl" />
        <p className="ds-data-table__state-title">{error.title || 'Unable to load records'}</p>
        <p className="ds-data-table__state-description">{error.message}</p>
        {error.onRetry && (
          <button
            type="button"
            className="ds-data-table__retry"
            onClick={error.onRetry}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const EmptyIcon = empty.icon;
  return (
    <div className="ds-data-table__state" role="status" aria-live="polite">
      <Icon icon={EmptyIcon || Inbox} size="3xl" />
      <p className="ds-data-table__state-title">{empty.title}</p>
      {empty.description && (
        <p className="ds-data-table__state-description">{empty.description}</p>
      )}
      {empty.action && (
        <Button variant="secondary" size="sm" onClick={empty.action.onClick}>
          {empty.action.label}
        </Button>
      )}
    </div>
  );
}

function LoadingRows({ columns, showSelection, loadingLabel, role }) {
  return Array.from({ length: 6 }, (_, rowIndex) => (
    <tr key={`loading-${rowIndex}`} role={role('row')} aria-hidden={rowIndex > 0 || undefined}>
      {showSelection && (
        <td className="ds-data-table__selection-cell" role={role('cell')}>
          <span className="ds-data-table__selection-skeleton" aria-hidden="true" />
        </td>
      )}
      {columns.map((column, columnIndex) => (
        <td
          key={column.key}
          role={role('cell')}
          data-align={column.align}
          data-width={column.width}
        >
          {rowIndex === 0 && columnIndex === 0 ? (
            <div className="sr-only" role="status" aria-live="polite">{loadingLabel}</div>
          ) : (
            <span
              className="ds-data-table__cell-skeleton"
              style={{ '--ds-skeleton-width': `${Math.max(40, 78 - (columnIndex * 8))}%` }}
              aria-hidden="true"
            />
          )}
        </td>
      ))}
    </tr>
  ));
}

/**
 * Accessible, business-neutral table primitive.
 *
 * Features own data, column content, actions, the sort order (`sort` and
 * `onSortChange`), and pagination callbacks. This component owns the visual
 * column contract, the sort control in a sortable column's header (a "Sort by"
 * list above the cards on a phone), state treatment, selection mechanics,
 * keyboard row activation, and responsive scrolling.
 *
 * On a phone the table scrolls sideways inside its labelled region and, by
 * default, pins its first column so the row's label stays in view — the
 * checkbox column too when there is a selection, with the identifying column
 * pinned beside it. `pinFirstColumn={false}` opts out for a table whose first
 * column is not what identifies the row. See pinnedColumn.css for the rule and
 * the standard it applies.
 *
 * `mobilePresentation="cards"` is the other shape that rule allows, for rows
 * worked one record at a time: under 768px each row is a card, its row header
 * the title and every value under its column's label (`mobileCards.css`). The
 * table then states its roles itself, since `display: block` can drop them, and a
 * card pins nothing; at 768px and up it is the table it always was, its first
 * column pinned. It takes no `selection`: a list worked one record at a time has
 * no bulk action, and a card has no header row to hold "select all".
 *
 * `maxHeight` caps a table that shares its space, such as one inside a panel or
 * a dialog: its rows scroll under the sticky header. A parent of bounded height
 * needs no cap, since the table fills it and scrolls the same way.
 */
export const DataTable = /* @__PURE__ */ memo(function DataTable({
  ariaLabel,
  data = [],
  columns = [],
  getRowId = (row) => row.id,
  getRowLabel,
  onRowActivate,
  getRowTone,
  density = 'comfortable',
  minWidth = 'wide',
  maxHeight,
  mobilePresentation = 'scroll',
  pinFirstColumn = true,
  mobileHint = 'Swipe horizontally to view all columns and actions.',
  embedded = false,
  isLoading = false,
  loadingLabel = 'Loading records',
  empty = { title: 'No records found.' },
  error,
  selection,
  pagination,
  sort,
  onSortChange,
}) {
  const normalizedColumns = useMemo(() => defineTableColumns(columns), [columns]);
  const selectedSet = useMemo(() => {
    if (selection?.selectedIds instanceof Set) return selection.selectedIds;
    return new Set(selection?.selectedIds || []);
  }, [selection?.selectedIds]);

  const rowIds = useMemo(() => data.map(getRowId), [data, getRowId]);
  const selectedOnPage = rowIds.filter((id) => selectedSet.has(id)).length;
  const allRowsSelected = rowIds.length > 0 && selectedOnPage === rowIds.length;
  const someRowsSelected = selectedOnPage > 0 && !allRowsSelected;
  const showSelection = Boolean(selection);
  const columnCount = normalizedColumns.length + (showSelection ? 1 : 0);
  const normalizedError = typeof error === 'string' ? { message: error } : error;
  const showInlineError = normalizedError && data.length > 0 && !isLoading;
  const cards = mobilePresentation === 'cards';
  /** Cards on screen now; at 768px and up the same table can scroll sideways. */
  const cardsOnScreen = useCardsLayout(cards);
  if (cards && showSelection) {
    contractViolation('A DataTable with mobilePresentation="cards" takes no selection; use mobilePresentation="scroll".');
  }
  checkSort(normalizedColumns, sort, onSortChange);
  let tableMinWidth = minWidth;
  if (!MIN_WIDTHS.has(minWidth)) {
    contractViolation(`Unsupported DataTable minWidth "${minWidth}"; use ${[...MIN_WIDTHS].join(', ')}.`);
    tableMinWidth = 'wide';
  }
  let tableMaxHeight = maxHeight ?? undefined;
  if (tableMaxHeight !== undefined && !MAX_HEIGHTS.has(tableMaxHeight)) {
    contractViolation(`Unsupported DataTable maxHeight "${maxHeight}"; use ${[...MAX_HEIGHTS].join(', ')}.`);
    tableMaxHeight = undefined;
  }
  const pageSizes = usablePageSizes(pagination);
  /** A role stated outright, in cards only; a table's own markup carries it otherwise. */
  const role = (name) => (cards ? name : undefined);

  const handleRowKeyDown = (event, row) => {
    if (!onRowActivate || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate(row);
    }
  };

  const renderStateRow = (state) => (
    <tr role={role('row')}>
      <td role={role('cell')} colSpan={columnCount || 1}>
        <StateContent
          state={state}
          empty={empty}
          error={normalizedError}
          loadingLabel={loadingLabel}
        />
      </td>
    </tr>
  );

  return (
    <section
      className="ds-data-table"
      data-density={density}
      data-mobile-presentation={mobilePresentation}
      data-pin-first-column={pinFirstColumn || undefined}
      data-has-selection={showSelection || undefined}
      data-embedded={embedded || undefined}
      data-max-height={tableMaxHeight}
      aria-busy={isLoading || undefined}
    >
      {showInlineError && (
        <div className="ds-data-table__notice" role="alert">
          <Icon icon={AlertTriangle} size="lg" />
          <span>{normalizedError.message}</span>
          {normalizedError.onRetry && (
            <button type="button" onClick={normalizedError.onRetry}>Retry</button>
          )}
        </div>
      )}

      {cardsOnScreen && (
        <CardSortControl columns={normalizedColumns} sort={sort} onSortChange={onSortChange} />
      )}

      {mobilePresentation === 'scroll' && (
        <p className="ds-data-table__mobile-hint">
          {mobileHint}
        </p>
      )}

      <div
        className="ds-data-table__scroll-region"
        role="region"
        aria-label={cardsOnScreen ? ariaLabel : `${ariaLabel}. Scroll horizontally to view all columns.`}
        tabIndex={0}
      >
        <table data-min-width={tableMinWidth} role={role('table')}>
          <caption className="sr-only">{ariaLabel}</caption>
          <colgroup>
            {showSelection && <col data-width="selection" />}
            {normalizedColumns.map((column) => (
              <col key={column.key} data-width={column.width} />
            ))}
          </colgroup>
          <thead role={role('rowgroup')}>
            <tr role={role('row')}>
              {showSelection && (
                <th className="ds-data-table__selection-cell" scope="col" role={role('columnheader')}>
                  <SelectionCheckbox
                    checked={allRowsSelected}
                    indeterminate={someRowsSelected}
                    label={selection.selectAllLabel || 'Select all rows on this page'}
                    onChange={(event) => selection.onToggleAll?.(!allRowsSelected, event)}
                  />
                </th>
              )}
              {normalizedColumns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  role={role('columnheader')}
                  data-align={column.align}
                  data-width={column.width}
                  data-truncate={column.truncate || undefined}
                  aria-sort={ariaSortOf(column, sort)}
                >
                  {column.headerLabel && !column.header ? (
                    <span className="sr-only">{column.headerLabel}</span>
                  ) : column.sortable && !cardsOnScreen ? (
                    <SortButton column={column} sort={sort} onSortChange={onSortChange} />
                  ) : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role={role('rowgroup')}>
            {isLoading ? (
              <LoadingRows
                columns={normalizedColumns}
                showSelection={showSelection}
                loadingLabel={loadingLabel}
                role={role}
              />
            ) : normalizedError && data.length === 0 ? (
              renderStateRow('error')
            ) : data.length === 0 ? (
              renderStateRow('empty')
            ) : (
              data.map((row) => {
                const rowId = getRowId(row);
                const isSelected = selectedSet.has(rowId);
                const rowTone = getRowTone?.(row) || 'neutral';

                return (
                  <tr
                    key={rowId}
                    role={role('row')}
                    data-interactive={Boolean(onRowActivate)}
                    data-selected={isSelected || undefined}
                    data-tone={rowTone}
                    aria-label={getRowLabel?.(row)}
                    aria-selected={showSelection ? isSelected : undefined}
                    tabIndex={onRowActivate ? 0 : undefined}
                    onClick={() => onRowActivate?.(row)}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                  >
                    {showSelection && (
                      <td
                        className="ds-data-table__selection-cell"
                        role={role('cell')}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <SelectionCheckbox
                          checked={isSelected}
                          label={selection.getRowLabel?.(row) || `Select row ${rowId}`}
                          onChange={(event) => selection.onToggleRow?.(rowId, event)}
                        />
                      </td>
                    )}
                    {normalizedColumns.map((column) => {
                      const Cell = column.rowHeader ? 'th' : 'td';
                      return (
                        <Cell
                          key={column.key}
                          scope={column.rowHeader ? 'row' : undefined}
                          role={role(column.rowHeader ? 'rowheader' : 'cell')}
                          data-label={cards && !column.rowHeader ? mobileLabelOf(column) : undefined}
                          data-align={column.align}
                          data-width={column.width}
                          data-truncate={column.truncate || undefined}
                          onClick={column.stopPropagation
                            ? (event) => event.stopPropagation()
                            : undefined}
                        >
                          {column.render(row)}
                        </Cell>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && !isLoading && (
        <TablePagination ariaLabel={ariaLabel} pagination={pagination} pageSizes={pageSizes} />
      )}
    </section>
  );
});

export default DataTable;
