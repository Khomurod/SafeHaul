import React, { useId } from 'react';
import { ChevronLeft, ChevronRight, Icon } from '../../icons';
import { Label, Select } from '../form';

/**
 * The bar under the rows: the feature's range label, an optional "Rows per
 * page" list, and Previous / Next around the page indicator. The feature owns
 * the paging itself; this only draws it. `pageSizes` is the checked list, or
 * `null` for none.
 */
export function TablePagination({ ariaLabel, pagination, pageSizes }) {
  const pageSizeId = `ds-table-page-size-${useId().replace(/:/g, '')}`;

  return (
    <nav className="ds-data-table__pagination" aria-label={`${ariaLabel} pagination`}>
      <span className="ds-data-table__pagination-label">{pagination.label}</span>
      <div className="ds-data-table__pagination-controls">
        {pageSizes && (
          <span className="ds-data-table__page-size">
            <Label htmlFor={pageSizeId}>Rows per page</Label>
            <Select
              id={pageSizeId}
              size="sm"
              value={String(pagination.pageSize)}
              onChange={(event) => pagination.onPageSizeChange(Number(event.target.value))}
            >
              {pageSizes.map((size) => (
                <option key={size} value={String(size)}>{size}</option>
              ))}
            </Select>
          </span>
        )}
        <button
          type="button"
          aria-label="Previous page"
          onClick={pagination.onPrev}
          disabled={!pagination.hasPrev}
        >
          <Icon icon={ChevronLeft} size="lg" />
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
          <Icon icon={ChevronRight} size="lg" />
        </button>
      </div>
    </nav>
  );
}
