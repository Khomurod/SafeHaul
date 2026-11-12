import React from 'react';
import { AlertTriangle, Icon, Inbox } from '../../icons';
import { Button } from '../button';

/**
 * What a table shows instead of rows: loading, a failed load, or nothing to
 * list. `DataTable` draws it under the header row, or as a row of the cards.
 */
export function StateContent({ state, empty, error, loadingLabel }) {
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

/**
 * The reserved selection column's cell: as wide as the checkbox column, empty,
 * and nothing to assistive technology (`reserveSelection`).
 */
export function SelectionGutter() {
  return <td className="ds-data-table__selection-gutter" aria-hidden="true" />;
}

/**
 * Six skeleton rows in the table's own columns, the checkbox column (`gutter`
 * `selection`) or its reserved place (`reserve`) included, so nothing moves
 * when the rows arrive.
 */
export function LoadingRows({ columns, gutter, loadingLabel, role }) {
  return Array.from({ length: 6 }, (_, rowIndex) => (
    <tr key={`loading-${rowIndex}`} role={role('row')} aria-hidden={rowIndex > 0 || undefined}>
      {gutter === 'selection' && (
        <td className="ds-data-table__selection-cell" role={role('cell')}>
          <span className="ds-data-table__selection-skeleton" aria-hidden="true" />
        </td>
      )}
      {gutter === 'reserve' && <SelectionGutter />}
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
