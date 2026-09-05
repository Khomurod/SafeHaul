import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
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
                <Trash2 aria-hidden="true" />
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
          '### A frozen first column',
          '',
          'One rule the contract has to state that `DataTable` never needed: **a `sticky`',
          'cell gets its own background from the contract.** The row paints the surface, not',
          'the cell, so a frozen column with a transparent background lets the other columns',
          'text paint straight through it as they scroll under. Add `sticky left-0` (and a',
          'stacking context) and the surface, the hover tint and the padding follow. The',
          '`StickyFirstColumn` story is the one to scroll sideways.',
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
 * the row paints the surface, not the cell, so a transparent `sticky` cell lets
 * the scrolled columns paint through it. Scroll this one sideways.
 */
export const StickyFirstColumn = {
  render: () => (
    <Card padding="none">
      {/* `isolate` is what makes the two layers below local to this table:
          a sticky first column only has to outrank the cells beside it. */}
      <div className="isolate overflow-x-auto">
        <table className="ds-native-table min-w-[1100px]" data-density="compact" data-row-hover>
          <caption className="ds-visually-hidden">Reference allocation matrix, wide</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-ds-layer-2">Reference</th>
              {['Owner', 'Quota', 'Region', 'Contact', 'Renewal', 'Notes', 'Reviewer'].map((h) => (
                <th key={h} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="sticky left-0 z-ds-layer-1 border-r border-ds-border-subtle">
                  {row.reference}
                </th>
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
