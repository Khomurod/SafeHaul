import { describe, expect, it } from 'vitest';
import {
  defineTableColumns,
  TABLE_COLUMN_ALIGNMENTS,
  TABLE_COLUMN_PRIORITIES,
  TABLE_COLUMN_WIDTHS,
} from './tableColumnContract';

describe('DataTable column contract', () => {
  it('normalizes shared alignment and width values', () => {
    const columns = defineTableColumns([
      { key: 'name', header: 'Name', render: (row) => row.name, rowHeader: true },
      { key: 'status', header: 'Status', render: (row) => row.status, align: 'center', width: 'sm' },
    ]);

    expect(columns[0]).toMatchObject({
      align: 'start',
      width: 'auto',
      priority: 'primary',
      rowHeader: true,
      stopPropagation: false,
      truncate: false,
    });
    expect(columns[1]).toMatchObject({ align: 'center', width: 'sm' });
    expect(Object.isFrozen(columns)).toBe(true);
    expect(Object.isFrozen(columns[0])).toBe(true);
  });

  it('publishes a finite visual vocabulary', () => {
    expect(TABLE_COLUMN_ALIGNMENTS).toEqual(['start', 'center', 'end']);
    expect(TABLE_COLUMN_WIDTHS).toEqual(['auto', 'xs', 'sm', 'md', 'lg', 'xl', 'actions']);
    expect(TABLE_COLUMN_PRIORITIES).toEqual(['primary', 'secondary', 'tertiary', 'actions']);
  });

  it.each([
    [[{ key: 'status', render: () => null, align: 'middle' }], 'Unsupported DataTable alignment'],
    [[{ key: 'status', render: () => null, width: 'one-off-width' }], 'Unsupported DataTable width'],
    [[{ key: 'status', render: () => null, priority: 'hide-it' }], 'Unsupported DataTable priority'],
    [[{ key: 'status' }], 'requires a render function'],
    [[{ key: 'status', render: () => null }, { key: 'status', render: () => null }], 'Duplicate DataTable column key'],
  ])('rejects invalid contracts', (columns, message) => {
    expect(() => defineTableColumns(columns)).toThrow(message);
  });
});
