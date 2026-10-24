import React from 'react';
import { ArrowDown, ArrowUp, Icon } from '../../icons';
import { FormField, Select } from '../form';
import { nextSortDirection } from './sorting';
import './sorting.css';

/**
 * A sortable header's content: one button, named by the header, with one arrow.
 * The sorted column's arrow shows its direction; any other sortable column shows
 * the direction a press would ask for, on hover or focus only.
 */
export function SortButton({ column, sort, onSortChange }) {
  const active = sort?.key === column.key;
  const arrowDirection = active ? sort.direction : column.sortable.first;
  return (
    <button
      type="button"
      className="ds-data-table__sort"
      data-active={active || undefined}
      onClick={() => onSortChange?.({ key: column.key, direction: nextSortDirection(column, sort) })}
    >
      <span className="ds-data-table__sort-label">{column.header}</span>
      <Icon icon={arrowDirection === 'asc' ? ArrowUp : ArrowDown} size="xs" />
    </button>
  );
}

/**
 * On a phone the header row is hidden behind the cards, so the sort moves above
 * them: one list of every sortable column in both directions.
 */
export function CardSortControl({ columns, sort, onSortChange }) {
  const sortable = columns.filter((column) => column.sortable);
  if (sortable.length === 0) return null;
  const value = sort ? `${sort.key}:${sort.direction}` : '';
  return (
    <FormField label="Sort by" className="ds-data-table__card-sort">
      <Select
        value={value}
        onChange={(event) => {
          const [key, direction] = event.target.value.split(':');
          onSortChange?.({ key, direction });
        }}
      >
        {!sort && <option value="">Choose an order</option>}
        {sortable.flatMap((column) => ['asc', 'desc'].map((direction) => (
          <option key={`${column.key}:${direction}`} value={`${column.key}:${direction}`}>
            {`${column.header} — ${column.sortable.labels[direction]}`}
          </option>
        )))}
      </Select>
    </FormField>
  );
}
