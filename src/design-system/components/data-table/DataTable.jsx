import React, { memo, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import { defineTableColumns } from './tableColumnContract';
import './DataTable.css';

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
        <AlertTriangle size={32} aria-hidden="true" />
        <p className="ds-data-table__state-title">Unable to load records</p>
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
      {EmptyIcon ? <EmptyIcon size={32} aria-hidden="true" /> : <Inbox size={32} aria-hidden="true" />}
      <p className="ds-data-table__state-title">{empty.title}</p>
      {empty.description && (
        <p className="ds-data-table__state-description">{empty.description}</p>
      )}
    </div>
  );
}

function LoadingRows({ columns, showSelection, loadingLabel }) {
  return Array.from({ length: 6 }, (_, rowIndex) => (
    <tr key={`loading-${rowIndex}`} aria-hidden={rowIndex > 0 || undefined}>
      {showSelection && (
        <td className="ds-data-table__selection-cell">
          <span className="ds-data-table__selection-skeleton" aria-hidden="true" />
        </td>
      )}
      {columns.map((column, columnIndex) => (
        <td
          key={column.key}
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
 * Features own data, column content, actions, sorting, and pagination
 * callbacks. This component owns the visual column contract, state treatment,
 * selection mechanics, keyboard row activation, and responsive scrolling.
 */
export const DataTable = memo(function DataTable({
  ariaLabel,
  data = [],
  columns = [],
  getRowId = (row) => row.id,
  getRowLabel,
  onRowActivate,
  getRowTone,
  density = 'comfortable',
  minWidth = 'wide',
  mobilePresentation = 'scroll',
  mobileHint = 'Swipe horizontally to view all columns and actions.',
  embedded = false,
  isLoading = false,
  loadingLabel = 'Loading records',
  empty = { title: 'No records found.' },
  error,
  selection,
  pagination,
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

  const handleRowKeyDown = (event, row) => {
    if (!onRowActivate || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate(row);
    }
  };

  const renderStateRow = (state) => (
    <tr>
      <td colSpan={columnCount || 1}>
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
      data-embedded={embedded || undefined}
      aria-busy={isLoading || undefined}
    >
      {showInlineError && (
        <div className="ds-data-table__notice" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{normalizedError.message}</span>
          {normalizedError.onRetry && (
            <button type="button" onClick={normalizedError.onRetry}>Retry</button>
          )}
        </div>
      )}

      {mobilePresentation === 'scroll' && (
        <p className="ds-data-table__mobile-hint">
          {mobileHint}
        </p>
      )}

      <div
        className="ds-data-table__scroll-region"
        role="region"
        aria-label={`${ariaLabel}. Scroll horizontally to view all columns.`}
        tabIndex={0}
      >
        <table data-min-width={minWidth}>
          <caption className="sr-only">{ariaLabel}</caption>
          <colgroup>
            {showSelection && <col data-width="selection" />}
            {normalizedColumns.map((column) => (
              <col key={column.key} data-width={column.width} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {showSelection && (
                <th className="ds-data-table__selection-cell" scope="col">
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
                  data-align={column.align}
                  data-width={column.width}
                  data-priority={column.priority}
                  data-truncate={column.truncate || undefined}
                >
                  {column.headerLabel && !column.header ? (
                    <span className="sr-only">{column.headerLabel}</span>
                  ) : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <LoadingRows
                columns={normalizedColumns}
                showSelection={showSelection}
                loadingLabel={loadingLabel}
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
                          data-align={column.align}
                          data-width={column.width}
                          data-priority={column.priority}
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
        <nav
          className="ds-data-table__pagination"
          aria-label={`${ariaLabel} pagination`}
        >
          <span className="ds-data-table__pagination-label">{pagination.label}</span>
          <div className="ds-data-table__pagination-controls">
            <button
              type="button"
              aria-label="Previous page"
              onClick={pagination.onPrev}
              disabled={!pagination.hasPrev}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span aria-live="polite">
              Page <strong>{pagination.currentPage}</strong> of{' '}
              <strong>{pagination.totalPages || 1}</strong>
            </span>
            <button
              type="button"
              aria-label="Next page"
              onClick={pagination.onNext}
              disabled={!pagination.hasNext}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
});

export default DataTable;
