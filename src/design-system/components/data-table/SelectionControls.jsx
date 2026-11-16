import React, { useEffect, useRef } from 'react';
import { CardSortControl } from './SortControls';

/**
 * One selection checkbox: a row's, or "select all" for the rows on the page.
 * The label element is the hit area around the box. `text` is words shown
 * beside the box; they are hidden from assistive technology, which hears
 * `label`, so a visible "Select all" must be part of that name.
 */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
  text,
  className = 'ds-data-table__selection-control',
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={className}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onChange}
      />
      {text && <span aria-hidden="true">{text}</span>}
    </label>
  );
}

/**
 * The strip above phone cards, where the header row is hidden: "Select all"
 * (the header's checkbox, under the same name) when the table has a selection,
 * and the "Sort by" list when a column sorts. Nothing when it has neither.
 */
export function CardStrip({ selectAll, columns, sort, onSortChange }) {
  const sortable = columns.some((column) => column.sortable);
  if (!selectAll && !sortable) return null;
  return (
    <div className="ds-data-table__card-strip">
      {selectAll && (
        <SelectionCheckbox {...selectAll} text="Select all" className="ds-data-table__select-all" />
      )}
      <CardSortControl columns={columns} sort={sort} onSortChange={onSortChange} />
    </div>
  );
}
