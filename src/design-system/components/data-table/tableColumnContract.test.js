import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  defineTableColumns,
  TABLE_COLUMN_ALIGNMENTS,
  TABLE_COLUMN_WIDTHS,
} from './tableColumnContract';

describe('DataTable column contract', () => {
  it('normalizes shared alignment and width values', () => {
    const columns = defineTableColumns([
      { key: 'name', header: 'Name', render: (row) => row.name, rowHeader: true },
      { key: 'status', header: 'Status', render: (row) => row.status, align: 'end', width: 'sm' },
    ]);

    expect(columns[0]).toMatchObject({
      align: 'start',
      width: 'auto',
      rowHeader: true,
      stopPropagation: false,
      truncate: false,
    });
    expect(columns[1]).toMatchObject({ align: 'end', width: 'sm' });
    expect(Object.isFrozen(columns)).toBe(true);
    expect(Object.isFrozen(columns[0])).toBe(true);
  });

  it('publishes a finite visual vocabulary', () => {
    expect(TABLE_COLUMN_ALIGNMENTS).toEqual(['start', 'end']);
    expect(TABLE_COLUMN_WIDTHS).toEqual(['auto', 'xs', 'sm', 'md', 'lg', 'xl', 'actions']);
  });

  it.each([
    [[{ key: 'status', render: () => null, align: 'middle' }], 'Unsupported DataTable alignment'],
    // A centred column has no edge to scan: text reads from the start, numbers line up at the end.
    [[{ key: 'status', render: () => null, align: 'center' }], 'Unsupported DataTable alignment'],
    [[{ key: 'status', render: () => null, width: 'one-off-width' }], 'Unsupported DataTable width'],
    [[{ key: 'status' }], 'requires a render function'],
    [[{ key: 'status', render: () => null, mobileLabel: 42 }], 'needs a string mobileLabel'],
    [[{ key: 'status', render: () => null }, { key: 'status', render: () => null }], 'Duplicate DataTable column key'],
    [[{ key: 'status', header: 'Status', render: () => null, sortable: 'yes' }], 'unsupported sortable setting'],
    // The header names the sort button and the phone's "Sort by" options.
    [[{ key: 'status', header: createElement('span', null, 'Status'), render: () => null, sortable: true }], 'needs a text header'],
    [[{ key: 'status', render: () => null, sortable: true }], 'needs a text header'],
    [[{ key: 'status', header: 'Status', render: () => null, sortable: { first: 'up' } }], 'Unsupported first sort direction'],
    [[{ key: 'status', header: 'Status', render: () => null, sortable: { labels: { asc: 1 } } }], 'needs string sort labels'],
  ])('rejects invalid contracts', (columns, message) => {
    expect(() => defineTableColumns(columns)).toThrow(message);
  });

  describe('a sortable column', () => {
    it('sorts up first, in plain words, unless told otherwise', () => {
      const [plain, dated, still] = defineTableColumns([
        { key: 'name', header: 'Name', render: () => null, sortable: true },
        {
          key: 'added',
          header: 'Added',
          render: () => null,
          sortable: { first: 'desc', labels: { desc: 'Newest first', asc: 'Oldest first' } },
        },
        { key: 'note', header: 'Note', render: () => null },
      ]);

      expect(plain.sortable).toEqual({ first: 'asc', labels: { asc: 'Ascending', desc: 'Descending' } });
      expect(dated.sortable).toEqual({ first: 'desc', labels: { asc: 'Oldest first', desc: 'Newest first' } });
      expect(Object.isFrozen(dated.sortable)).toBe(true);
      expect(still.sortable).toBeNull();
    });

    it('passes through the contract a second time unchanged', () => {
      const once = defineTableColumns([
        { key: 'name', header: 'Name', render: () => null, sortable: { first: 'desc' } },
        { key: 'note', header: 'Note', render: () => null },
      ]);

      expect(defineTableColumns(once)).toEqual(once);
    });
  });
});
