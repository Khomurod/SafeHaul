import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { defineTableColumns } from './tableColumnContract';

/**
 * The table options the list redesign (C2) added: a reserved checkbox place
 * (`reserveSelection`), a detail row under a record (`getRowDetail`), the
 * status under the title on a narrow phone card (`mobileStatus`), an empty
 * actions cell left off a card, the 44px header band, the sorted header's
 * resting colour, the `2xl` width, and a person's disc on a selected row.
 */

const rows = [
  { id: 'r1', name: 'Alpha Record', initials: 'AR', status: 'Open', note: 'Nothing to say', problem: null },
  { id: 'r2', name: 'Bravo Record', initials: 'BR', status: 'Closed', note: 'Called back', problem: 'This record points to nothing.' },
];

const plainColumns = defineTableColumns([
  { key: 'name', header: 'Record', rowHeader: true, width: 'lg', render: (row) => row.name },
  { key: 'status', header: 'Status', width: 'sm', render: (row) => row.status },
]);

const roleColumns = defineTableColumns([
  { key: 'initials', header: '', headerLabel: 'Initials', mobileRole: 'lead', render: (row) => <span aria-hidden="true">{row.initials}</span> },
  { key: 'name', header: 'Record', rowHeader: true, width: 'lg', render: (row) => row.name },
  { key: 'status', header: 'Status', mobileRole: 'status', width: 'sm', render: (row) => row.status },
  { key: 'note', header: 'Note', mobileRole: 'line', width: 'md', render: (row) => row.note },
  {
    key: 'actions',
    header: 'Actions',
    mobileRole: 'actions',
    width: 'sm',
    render: (row) => (row.id === 'r1' ? <button type="button">{`Open ${row.name}`}</button> : null),
  },
]);

const problemOf = (row) => (row.problem ? { tone: 'danger', content: row.problem } : null);

/** A screen of the given width, as `useCardsLayout` asks for it. */
function screenWidth(narrow) {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    matches: narrow,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** A stylesheet of this folder, its comments left out. */
const stylesheet = (name) => readFileSync(path.join(__dirname, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector holds every part. */
function declarationsFor(css, ...parts) {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, selector]) => parts.every((part) => selector.includes(part)));
  return rule?.[2] ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataTable reserveSelection', () => {
  it('keeps the checkbox column\'s place, empty and hidden from assistive technology', () => {
    const { container } = render(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} reserveSelection />);

    const table = container.querySelector('.ds-data-table');
    expect(table).toHaveAttribute('data-reserve-selection', 'true');
    expect(table).not.toHaveAttribute('data-has-selection');
    expect(container.querySelector('col[data-width="selection"]')).not.toBeNull();
    const gutters = container.querySelectorAll('.ds-data-table__selection-gutter');
    // One in the header row, one in each record row.
    expect(gutters).toHaveLength(1 + rows.length);
    gutters.forEach((gutter) => {
      expect(gutter.tagName).toBe('TD');
      expect(gutter).toHaveAttribute('aria-hidden', 'true');
      expect(gutter).toBeEmptyDOMElement();
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
    // Nothing new to read: the same headers, the same cells under them.
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Record', 'Status']);
    const [, first] = screen.getAllByRole('row');
    expect(within(first).getAllByRole('cell')).toHaveLength(1);
  });

  it('keeps the place while loading, so nothing moves when the rows arrive', () => {
    const { container } = render(<DataTable ariaLabel="Records" columns={plainColumns} data={[]} isLoading reserveSelection />);

    const bodyRows = container.querySelectorAll('tbody > tr');
    bodyRows.forEach((row) => expect(row.firstElementChild).toHaveClass('ds-data-table__selection-gutter'));
  });

  it('gives way to a real selection', () => {
    const { container } = render(
      <DataTable
        ariaLabel="Records"
        columns={plainColumns}
        data={rows}
        reserveSelection
        selection={{ selectedIds: [], onToggleRow: vi.fn(), onToggleAll: vi.fn() }}
      />,
    );

    expect(container.querySelector('.ds-data-table__selection-gutter')).toBeNull();
    expect(container.querySelectorAll('col[data-width="selection"]')).toHaveLength(1);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-reserve-selection');
  });

  it('pins and scrolls as a table with checkboxes does, and leaves a card alone', () => {
    const pinned = stylesheet('pinnedColumn.css');
    expect(pinned).toContain(':is([data-has-selection], [data-reserve-selection]) tbody > tr > :nth-child(2)');
    expect(pinned).not.toMatch(/(?<!:is\(|:not\()\[data-has-selection\](?!, \[data-reserve-selection\])/);
    expect(declarationsFor(stylesheet('mobileCards.css'), 'td.ds-data-table__selection-gutter')).toMatch(/display:\s*none/);
    expect(declarationsFor(stylesheet('roleCards.css'), '[data-reserve-selection]', 'td.ds-data-table__selection-gutter')).toMatch(/display:\s*none/);
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} reserveSelection />);

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('DataTable getRowDetail', () => {
  it('draws a detail as a row of its own under its record, one cell across every column', () => {
    screenWidth(false);
    const { container } = render(
      <DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={problemOf} reserveSelection />,
    );

    const bodyRows = [...container.querySelectorAll('tbody > tr')];
    expect(bodyRows).toHaveLength(3);
    const [alpha, bravo, detailRow] = bodyRows;
    expect(alpha).not.toHaveAttribute('data-has-detail');
    expect(bravo).toHaveAttribute('data-has-detail', 'true');
    expect(detailRow).toHaveClass('ds-data-table__detail-row');
    const cell = within(detailRow).getByRole('cell');
    // The two columns and the reserved checkbox place.
    expect(cell).toHaveAttribute('colspan', '3');
    expect(cell).toHaveAttribute('data-detail-tone', 'danger');
    expect(cell).toHaveTextContent('This record points to nothing.');
    // A danger detail leads with its glyph, so the tone is never colour alone.
    expect(cell.querySelector('svg')).not.toBeNull();
  });

  it('describes the record\'s header cell, and is never part of its name', () => {
    screenWidth(false);
    render(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={problemOf} onRowActivate={vi.fn()} getRowLabel={(row) => `Open ${row.name}`} />);

    const header = screen.getByRole('rowheader', { name: 'Bravo Record' });
    expect(header).toHaveAccessibleDescription('This record points to nothing.');
    // A focusable row is described too, since focus lands on it.
    expect(screen.getByRole('row', { name: 'Open Bravo Record' })).toHaveAccessibleDescription('This record points to nothing.');
    expect(screen.getByRole('rowheader', { name: 'Alpha Record' })).not.toHaveAttribute('aria-describedby');
  });

  it('draws nothing for null, an empty detail, or no getRowDetail at all', () => {
    const { container, rerender } = render(
      <DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={() => ({ tone: 'warning', content: '—' })} />,
    );
    expect(container.querySelector('.ds-data-table__detail')).toBeNull();

    rerender(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={() => null} />);
    expect(container.querySelector('.ds-data-table__detail')).toBeNull();

    rerender(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} />);
    expect(container.querySelectorAll('tbody > tr')).toHaveLength(2);
  });

  it('draws a neutral detail as a quiet note, without a glyph', () => {
    const { container } = render(
      <DataTable ariaLabel="Records" columns={plainColumns} data={rows.slice(0, 1)} getRowDetail={() => ({ content: 'A note.' })} />,
    );

    const cell = container.querySelector('.ds-data-table__detail');
    expect(cell).toHaveAttribute('data-detail-tone', 'neutral');
    expect(cell.querySelector('svg')).toBeNull();
  });

  it('refuses a tone a row does not have', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(
      <DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={() => ({ tone: 'success', content: 'Done.' })} />,
    )).toThrow('Unsupported DataTable row detail tone "success"');
  });

  it('is a line of a card by role, after its lines and before its actions', () => {
    screenWidth(true);
    const { container } = render(
      <DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" getRowDetail={problemOf} />,
    );

    // No row of its own: the card holds it, after every column's cell.
    expect(container.querySelector('.ds-data-table__detail-row')).toBeNull();
    const bravo = screen.getByRole('rowheader', { name: 'Bravo Record' }).closest('tr');
    expect(bravo.lastElementChild).toHaveClass('ds-data-table__detail');
    expect(bravo.lastElementChild).not.toHaveAttribute('colspan');
    expect(screen.getByRole('rowheader', { name: 'Bravo Record' })).toHaveAccessibleDescription('This record points to nothing.');

    const css = stylesheet('rowDetail.css');
    const inCard = declarationsFor(css, '[data-mobile-roles]', 'td.ds-data-table__detail');
    expect(inCard).toMatch(/order:\s*5/);
    expect(inCard).toMatch(/flex-basis:\s*100%/);
    const actions = [...stylesheet('roleCards.css').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(([, selector]) => selector.trim().endsWith("> [data-mobile-role='actions']"));
    expect(actions[2]).toMatch(/order:\s*6/);
  });

  it('starts its words where the row header\'s text starts', () => {
    const avatarColumns = defineTableColumns([
      { key: 'name', header: 'Record', rowHeader: true, leadingAvatar: true, render: (row) => row.name },
      { key: 'status', header: 'Status', render: (row) => row.status },
    ]);
    const { container, rerender } = render(<DataTable ariaLabel="Records" columns={avatarColumns} data={rows} getRowDetail={problemOf} />);
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-row-header-avatar', 'true');

    rerender(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} getRowDetail={problemOf} />);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-row-header-avatar');

    // After the checkbox column or its place, a lead column and a row header's own avatar.
    const css = stylesheet('rowDetail.css');
    expect(declarationsFor(css, ':is([data-has-selection], [data-reserve-selection])')).toMatch(/--ds-table-detail-gutter:\s*var\(--ds-table-selection-width\)/);
    expect(declarationsFor(css, '[data-mobile-lead]')).toMatch(/--ds-table-detail-lead:/);
    expect(declarationsFor(css, '[data-row-header-avatar]')).toMatch(/--ds-table-detail-avatar:/);
    // No divider between a record and its detail.
    expect(declarationsFor(css, 'tr[data-has-detail] > *')).toMatch(/border-bottom:\s*0/);
  });

  it('has no structural accessibility violations, as a table and as cards', async () => {
    screenWidth(false);
    const { container, unmount } = render(
      <DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" getRowDetail={problemOf} />,
    );
    let results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    unmount();
    vi.restoreAllMocks();

    screenWidth(true);
    const cards = render(
      <DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" getRowDetail={problemOf} />,
    );
    results = await axe(cards.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('DataTable mobileStatus', () => {
  it('moves a card\'s status under its title on a narrow phone when asked', () => {
    const { container, rerender } = render(
      <DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" mobileStatus="below" />,
    );
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-mobile-status', 'below');

    rerender(<DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" />);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-mobile-status');

    const css = readFileSync(path.join(__dirname, 'roleCards.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 411px)'));
    expect(narrow).toContain("[data-mobile-status='below']");
    expect(declarationsFor(narrow, "[data-mobile-role='status']")).toMatch(/flex-basis:\s*100%/);
  });

  it('refuses a place it does not know, and "below" with no status column', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(
      <DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" mobileStatus="top" />,
    )).toThrow('Unsupported DataTable mobileStatus "top"');
    const noStatus = defineTableColumns([
      { key: 'name', header: 'Record', rowHeader: true, render: (row) => row.name },
      { key: 'note', header: 'Note', mobileRole: 'line', render: (row) => row.note },
    ]);
    expect(() => render(
      <DataTable ariaLabel="Records" columns={noStatus} data={rows} mobilePresentation="cards" mobileStatus="below" />,
    )).toThrow('no column has mobileRole "status"');
  });
});

describe('DataTable cards: an empty actions cell', () => {
  it('is left off the card, as an empty line is', () => {
    screenWidth(true);
    render(<DataTable ariaLabel="Records" columns={roleColumns} data={rows} mobilePresentation="cards" />);

    const bravo = screen.getByRole('rowheader', { name: 'Bravo Record' }).closest('tr');
    const actions = bravo.querySelector('[data-mobile-role="actions"]');
    expect(actions).toHaveAttribute('data-mobile-empty', 'true');
    const alpha = screen.getByRole('rowheader', { name: 'Alpha Record' }).closest('tr');
    expect(alpha.querySelector('[data-mobile-role="actions"]')).not.toHaveAttribute('data-mobile-empty');
    expect(declarationsFor(stylesheet('roleCards.css'), "[data-mobile-empty]:is(", "[data-mobile-role='actions']")).toMatch(/clip-path:\s*inset\(50%\)/);
  });
});

describe('DataTable header and selected row', () => {
  it('keeps the header band 44px whatever a header holds', () => {
    const rule = declarationsFor(stylesheet('DataTable.css'), '.ds-data-table thead th,');
    expect(rule).toMatch(/height:\s*var\(--ds-table-header-height\)/);
    expect(rule).toMatch(/padding-block:\s*0/);
  });

  it('draws the sorted header in the colour of every other at rest, darker only when pointed at or focused', () => {
    const css = stylesheet('sorting.css');
    expect(css).not.toMatch(/\.ds-data-table__sort\[data-active\]\s*\{/);
    expect(declarationsFor(css, '.ds-data-table__sort:hover,', '.ds-data-table__sort:focus-visible')).toMatch(/color:\s*var\(--ds-color-content\)/);
    expect(declarationsFor(css, '.ds-data-table__sort[data-active] > svg')).toMatch(/color:\s*inherit/);
  });

  it('rings a person\'s disc on a selected row with an outline, which forced colours keep', () => {
    const rule = declarationsFor(stylesheet('selection.css'), "tr[data-selected='true'] .ds-avatar[data-tone='brand']");
    expect(rule).toMatch(/outline:\s*2px solid var\(--ds-color-surface\)/);
  });

  it('takes the 2xl width, 256px', () => {
    const wide = defineTableColumns([{ key: 'role', header: 'Role', width: '2xl', render: () => 'x' }]);
    render(<DataTable ariaLabel="Records" columns={wide} data={rows} />);

    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveAttribute('data-width', '2xl');
    expect(declarationsFor(stylesheet('DataTable.css'), "col[data-width='2xl']")).toMatch(/width:\s*256px/);
  });

  it('takes the 3xl width, 324px: three buttons side by side', () => {
    const wide = defineTableColumns([{ key: 'actions', header: 'Actions', width: '3xl', render: () => 'x' }]);
    render(<DataTable ariaLabel="Records" columns={wide} data={rows} />);

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toHaveAttribute('data-width', '3xl');
    expect(declarationsFor(stylesheet('DataTable.css'), "col[data-width='3xl']")).toMatch(/width:\s*324px/);
  });

  it('pads a tight table 12px between columns and 16px at its edges, from 768px', () => {
    const { container, rerender } = render(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} cellPadding="tight" />);
    expect(container.querySelector('.ds-data-table')).toHaveAttribute('data-cell-padding', 'tight');

    rerender(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} />);
    expect(container.querySelector('.ds-data-table')).not.toHaveAttribute('data-cell-padding');

    const css = stylesheet('DataTable.css');
    const root = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) => selector.trim() === ".ds-data-table[data-cell-padding='tight']");
    expect(root?.[2]).toMatch(/--ds-table-cell-padding-inline:\s*var\(--ds-space-3\)/);
    expect(declarationsFor(css, ".ds-data-table[data-cell-padding='tight'] tr > :first-child")).toMatch(/padding-left:\s*var\(--ds-space-4\)/);
    expect(declarationsFor(css, ".ds-data-table[data-cell-padding='tight'] tr > :last-child")).toMatch(/padding-right:\s*var\(--ds-space-4\)/);
  });

  it('refuses a cell padding it does not draw', () => {
    expect(() => render(<DataTable ariaLabel="Records" columns={plainColumns} data={rows} cellPadding="loose" />))
      .toThrow(/Unsupported DataTable cellPadding "loose"/);
  });
});
