import React from 'react';
import { Card } from '@design-system/components';

/**
 * Hand-written fixtures only, so the story renders identically on every run —
 * which is what lets the browser guards measure it.
 */
const ROWS = [
  { id: 'r-1', reference: 'REF-4821', owner: 'Northern Route', quota: '120' },
  { id: 'r-2', reference: 'REF-4822', owner: 'Coastal Division with a deliberately long owner name', quota: '40' },
  { id: 'r-3', reference: 'REF-4823', owner: 'Central', quota: '8' },
];

const meta = {
  title: 'Patterns/Native table',
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved, for one table.** Every table in the product is `DataTable` —',
          'display tables, editable matrices and rows of per-row controls alike. One native',
          '`<table>` remains: the `sr-only` text equivalent of the Analytics activity chart.',
          '`ds/native-table` refuses a `<table>` in any file roadmap §5 does not approve, and',
          'an approved one carries `ds-native-table` on every branch of its class list.',
          '',
          'The class keeps such a table the same table as `DataTable` should it ever be',
          'shown: header, divider, row surface, cell padding and row height from the same',
          '`--ds-table-*` roles, and `data-density="compact"` mirroring `DataTable`\'s prop.',
          'Selection, sorting, pagination, states, a pinned column and cards on a phone are',
          '`DataTable`\'s; a new need for any of them is a reason to use `DataTable`.',
          '',
          'This story is what `check:visual-contract` and `check:table-layout` measure.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The contract at the comfortable density, beside nothing but itself. */
export const Default = {
  render: () => (
    <Card padding="none">
      <table className="ds-native-table">
        <caption className="ds-visually-hidden">Reference allocation</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Owner</th>
            <th scope="col">Quota</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.reference}</th>
              <td>{row.owner}</td>
              <td>{row.quota}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  ),
};
