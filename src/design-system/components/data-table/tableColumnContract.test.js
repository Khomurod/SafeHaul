import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defineTableColumns,
  TABLE_COLUMN_ALIGNMENTS,
  TABLE_COLUMN_MOBILE_ROLES,
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
    expect(TABLE_COLUMN_WIDTHS).toEqual(['auto', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'actions']);
    expect(TABLE_COLUMN_MOBILE_ROLES).toEqual(['lead', 'title', 'status', 'meta', 'line', 'actions', 'hidden']);
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
    [[{ key: 'status', render: () => null, mobileRole: 'corner' }], 'Unsupported DataTable mobileRole "corner"'],
    // The row header is what a card is; it cannot be moved into a corner or hidden.
    [[{ key: 'name', render: () => null, rowHeader: true, mobileRole: 'hidden' }], 'on a card it is the title, not "hidden"'],
    [[{ key: 'note', render: () => null, mobileRole: 'title' }], 'only if it is the row header'],
    // Only the row header's text is where a row detail lines up.
    [[{ key: 'note', render: () => null, leadingAvatar: true }], 'which only a row header (rowHeader: true) may'],
    [[
      { key: 'photo', render: () => null, mobileRole: 'lead' },
      { key: 'icon', render: () => null, mobileRole: 'lead' },
    ], 'both take the card\'s leading slot'],
    // One status corner: several statuses share its one cell, one under another.
    [[
      { key: 'stage', render: () => null, mobileRole: 'status' },
      { key: 'delivery', render: () => null, mobileRole: 'status' },
    ], 'both take the card\'s status corner'],
    // The leading slot is the first column, and the row header the one the pin holds after it.
    [[
      { key: 'name', render: () => null, rowHeader: true },
      { key: 'photo', render: () => null, mobileRole: 'lead' },
    ], 'so it must be the first column'],
    [[
      { key: 'photo', render: () => null, mobileRole: 'lead' },
      { key: 'note', render: () => null },
      { key: 'name', render: () => null, rowHeader: true },
    ], 'the row header must come right after it'],
  ])('rejects invalid contracts', (columns, message) => {
    expect(() => defineTableColumns(columns)).toThrow(message);
  });

  it('says whether a row header leads with its own avatar', () => {
    const [person, note] = defineTableColumns([
      { key: 'person', render: () => null, rowHeader: true, leadingAvatar: true },
      { key: 'note', render: () => null },
    ]);

    expect(person.leadingAvatar).toBe(true);
    expect(note.leadingAvatar).toBe(false);
  });

  it('keeps a phone card role, and leaves it unset where none is stated', () => {
    const [name, status, note] = defineTableColumns([
      { key: 'name', render: () => null, rowHeader: true, mobileRole: 'title' },
      { key: 'status', render: () => null, mobileRole: 'status' },
      { key: 'note', render: () => null },
    ]);

    expect(name.mobileRole).toBe('title');
    expect(status.mobileRole).toBe('status');
    expect(note.mobileRole).toBeUndefined();
    expect(defineTableColumns([name, status, note])).toEqual([name, status, note]);
  });

  describe('the leading slot', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('is the first column, the row header right after it, or no row header at all', () => {
      const [photo, name] = defineTableColumns([
        { key: 'photo', render: () => null, mobileRole: 'lead' },
        { key: 'name', render: () => null, rowHeader: true },
        { key: 'note', render: () => null },
      ]);
      expect(photo.mobileRole).toBe('lead');
      expect(name.rowHeader).toBe(true);

      const [icon] = defineTableColumns([
        { key: 'icon', render: () => null, mobileRole: 'lead' },
        { key: 'note', render: () => null },
      ]);
      expect(icon.mobileRole).toBe('lead');
    });

    it('is left out of a production build when it is out of place, the other roles kept', () => {
      vi.stubEnv('PROD', true);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const [name, photo, status] = defineTableColumns([
        { key: 'name', render: () => null, rowHeader: true },
        { key: 'photo', render: () => null, mobileRole: 'lead' },
        { key: 'status', render: () => null, mobileRole: 'status' },
      ]);

      expect(photo.mobileRole).toBeUndefined();
      expect(Object.isFrozen(photo)).toBe(true);
      expect(name.rowHeader).toBe(true);
      expect(status.mobileRole).toBe('status');
    });
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
