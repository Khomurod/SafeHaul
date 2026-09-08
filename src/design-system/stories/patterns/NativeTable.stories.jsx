import React, { useState } from 'react';
import { Icon, Trash2 } from '@design-system/icons';
import {
  Badge, Button, Card, IconButton, Input, Switch,
} from '@design-system/components';

/**
 * Hand-written fixtures only. No production data, no generated values, so the
 * story renders identically on every run — which is what lets the browser guards
 * measure it.
 */
const ROWS = [
  { id: 'r-1', reference: 'REF-4821', owner: 'Northern Route', quota: '120', live: true, tone: 'success', state: 'Active' },
  { id: 'r-2', reference: 'REF-4822', owner: 'Coastal Division with a deliberately long owner name', quota: '40', live: false, tone: 'warning', state: 'Paused' },
  { id: 'r-3', reference: 'REF-4823', owner: 'Central', quota: '8', live: true, tone: 'neutral', state: 'Draft' },
];

function Matrix({ density }) {
  const [live, setLive] = useState(() => Object.fromEntries(ROWS.map((r) => [r.id, r.live])));
  return (
    <table className="ds-native-table" data-density={density}>
      <caption className="ds-visually-hidden">Reference allocation matrix</caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Owner</th>
          <th scope="col">Quota</th>
          <th scope="col" className="text-center">State</th>
          <th scope="col" className="text-center">Enabled</th>
          <th scope="col" className="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.reference}</th>
            <td>{row.owner}</td>
            <td>
              <Input size="sm" defaultValue={row.quota} aria-label={`Quota for ${row.reference}`} />
            </td>
            <td className="text-center"><Badge tone={row.tone}>{row.state}</Badge></td>
            <td className="text-center">
              <Switch
                label={`Enable ${row.reference}`}
                checked={live[row.id]}
                onChange={() => setLive((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
              />
            </td>
            <td className="text-right">
              <IconButton variant="ghost" size="sm" label={`Remove ${row.reference}`}>
                <Icon icon={Trash2} />
              </IconButton>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5}>3 references</td>
          <td className="text-right"><Button variant="secondary" size="sm">Add</Button></td>
        </tr>
      </tfoot>
    </table>
  );
}

const meta = {
  title: 'Patterns/Native table',
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** The `ds-native-table` contract, added 2026-08-25.',
          '',
          '### What it is for',
          '',
          '`DataTable` is a *display*-table contract. The roadmap approves a native `<table>`',
          'for the two things it does not cover — an **editable matrix** (a form control in',
          'every row) and a **grid with per-row interactive controls** — and eleven tables in',
          'the product use that permission.',
          '',
          'It has always said the other half too: *"a native table is not a licence to style a',
          'table by hand."* On 2026-08-25 that was measured. **Seven of the eleven referenced',
          'no `--ds-table-*` role at all**, and the four that did referenced one or two. They',
          'looked right because `bg-ds-surface-subtle` happens to be what the header role',
          'resolves to — a coincidence, not a contract, and one a re-tuned role would have',
          'broken in silence. Inline cell padding had already drifted to **three** different',
          'values (24px, 20px, 16px) against a contract of 20px.',
          '',
          '### The contract',
          '',
          'One class on the `<table>`. Header background and foreground, divider, row',
          'background, hover, cell padding and row height all come from the same',
          '`--ds-table-*` roles `DataTable` reads, so the two kinds of table are the same',
          'table and a re-tuned role moves both.',
          '',
          '| Attribute | Does |',
          '| --- | --- |',
          '| `data-density="compact"` | The compact row height and block padding, mirroring `DataTable`\'s prop |',
          '| `data-row-hover` | A hover tint. Only for a table whose rows are activatable — on a matrix of form controls a hover tint suggests a row activation that is not there |',
          '| `.text-center` / `.text-right` on a cell | Still wins, for a status or actions column |',
          '',
          'It deliberately does **not** supply selection, sorting, pagination, empty/error',
          'states or a scroll container. Those are what make `DataTable` a contract rather',
          'than a stylesheet, and a native table is chosen precisely when the feature owns',
          'the row\'s interaction.',
          '',
          '### Why this story exists',
          '',
          '`check:table-layout` and `check:visual-contract` measure the **catalog** in a real',
          'browser. Before this story, no native table was measured anywhere — the guard that',
          'exists to catch a cell narrower than its content had nothing to look at for the',
          'eleven tables that are not `DataTable`. The long owner name and the 8-character',
          'quota are here for that: extremes in the same row.',
          '',
          '`check:ui-contract` requires every file with an approved `raw-table` exception to',
          'reference `ds-native-table`, so "we kept a native table" can no longer quietly mean',
          '"we styled a table by hand".',
          '',
          '### The state row',
          '',
          'A native table owns its own loading/error/empty row, and needs no styling from this',
          'contract for it — one `<td colSpan>` and the cell padding are enough. It does need',
          'one rule, and three of the eleven broke it: **the live-region role goes on a',
          'wrapper inside the cell, never on the `<td>`.** `role="status"` on a cell replaces',
          'the cell role, and a row whose only child is not a cell is a row assistive',
          'technology may drop from the table altogether. `CompaniesView` and `UsersView` had',
          'it on the cell; `FeaturesView` had no role at all, so filtering the matrix down to',
          'nothing was silent. The `EmptyRow` story is the shape to copy.',
          '',
          '### Tables on phones: the rule (audit step K, 2026-09-06)',
          '',
          'A table whose rows are **compared** keeps the table on a phone: a labelled,',
          'focusable horizontal-scroll region, a sticky header, and the first column pinned so',
          'the row label stays in view while the rest scrolls — Nielsen Norman Group\'s guidance',
          'for mobile tables (*"the leftmost column … should be locked in place, so users can',
          'see the necessary labels at all times"*). A matrix of per-row form controls that is',
          'worked **one record at a time** becomes one card per row under 768px. Both are one',
          'attribute on the `<table>`:',
          '',
          '| Attribute | Does |',
          '| --- | --- |',
          '| `data-pin-first-column` | Freezes the first column (header corner included) with its own surface, hover tint and — under 768px — a 1px seam; the table isolates its own stacking. `DataTable` does the same by default |',
          '| `data-mobile-presentation="cards"` | Under 768px: one card per row, the row header as its title, every `<td data-label="…">` as label + value. The caller states the table roles explicitly, because `display: block` may drop them |',
          '',
          '### A frozen first column',
          '',
          'One rule the contract has to state that `DataTable` never needed: **a frozen cell',
          'gets its own background from the contract.** The row paints the surface, not the',
          'cell, so a frozen column with a transparent background lets the other columns\' text',
          'paint straight through it as they scroll under. `data-pin-first-column` supplies the',
          'surface, the hover tint, the stacking order and the seam (`pinnedColumn.css`); the',
          'hand-written `sticky left-0` form is kept only by the feature matrix, whose three',
          'layers cross. The `StickyFirstColumn` story is the one to scroll sideways.',
          '',
          '### Cards on a phone',
          '',
          'The `CardsOnMobile` story is the shape to copy for an editable matrix: the same',
          '`<table>` at 1440px, one card per row at 412px, labels from `data-label`, roles',
          'stated on every element. Nothing is hidden and nothing is reordered.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The editable matrix: a form control and a per-row action in every row. */
export const EditableMatrix = {
  render: () => <Card padding="none"><Matrix density="comfortable" /></Card>,
};

/** Compact, for an operator console. Same roles, the compact density step. */
export const Compact = {
  render: () => <Card padding="none"><Matrix density="compact" /></Card>,
};

/** Both densities together — the thing a reviewer actually needs to compare. */
export const DensityComparison = {
  render: () => (
    <Card padding="none">
      <Matrix density="comfortable" />
      <Matrix density="compact" />
    </Card>
  ),
};

/** Mobile width. Every cell must still contain its content. */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => <Card padding="none"><Matrix density="compact" /></Card>,
};

/**
 * The empty row. The announcement lives in a wrapper inside the cell — on the
 * `<td>` it would replace the cell role, and a row whose only child is not a
 * cell is a row assistive technology may drop from the table.
 */
export const EmptyRow = {
  render: () => (
    <Card padding="none">
      <table className="ds-native-table">
        <caption className="ds-visually-hidden">Reference allocation matrix</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Owner</th>
            <th scope="col">Quota</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3} className="text-center">
              <div role="status">No references match this filter.</div>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  ),
};

/**
 * A frozen first column, which is the case that needs the contract's sticky rule:
 * the row paints the surface, not the cell, so a transparent frozen cell lets
 * the scrolled columns paint through it. Since 2026-09-06 the whole of it is one
 * attribute — surface, hover tint, stacking and the seam. Scroll this one
 * sideways.
 */
export const StickyFirstColumn = {
  render: () => (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="ds-native-table min-w-[1100px]" data-density="compact" data-row-hover data-pin-first-column>
          <caption className="ds-visually-hidden">Reference allocation matrix, wide</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              {['Owner', 'Quota', 'Region', 'Contact', 'Renewal', 'Notes', 'Reviewer'].map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.reference}</th>
                <td>{row.owner}</td>
                <td>{row.quota}</td>
                <td>Northern</td>
                <td>ops@example.test</td>
                <td>2027-01-01</td>
                <td>Renewed early, pending review</td>
                <td>A. Reviewer</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  ),
};

/**
 * The editable matrix as a phone sees it. One `<table>`: at 1440px the matrix
 * above; at 412px (`data-mobile-presentation="cards"`) one card per row, every
 * value under the label of its column, in column order, nothing hidden. The
 * roles are stated on every element because `display: block` can drop the
 * implicit ones — redundant while it is a table, load-bearing while it is cards.
 */
export const CardsOnMobile = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Card padding="none">
      <div role="region" aria-label="Reference allocation" tabIndex={0} className="overflow-x-auto">
        <table
          className="ds-native-table min-w-[720px]"
          role="table"
          data-density="compact"
          data-pin-first-column
          data-mobile-presentation="cards"
        >
          <caption className="ds-visually-hidden">Reference allocation matrix, stacked on a phone</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Reference</th>
              <th scope="col" role="columnheader">Owner</th>
              <th scope="col" role="columnheader">Quota</th>
              <th scope="col" role="columnheader" className="text-center">State</th>
              <th scope="col" role="columnheader" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {ROWS.map((row) => (
              <tr key={row.id} role="row">
                <th scope="row" role="rowheader">{row.reference}</th>
                <td role="cell" data-label="Owner">{row.owner}</td>
                <td role="cell" data-label="Quota">
                  <Input size="sm" defaultValue={row.quota} aria-label={`Quota for ${row.reference}`} />
                </td>
                <td role="cell" data-label="State" className="text-center"><Badge tone={row.tone}>{row.state}</Badge></td>
                <td role="cell" data-label="Actions" className="text-right">
                  <IconButton variant="ghost" size="sm" label={`Remove ${row.reference}`}>
                    <Icon icon={Trash2} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  ),
};
