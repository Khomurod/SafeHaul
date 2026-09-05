import React, { useState } from 'react';
import { SelectableCard, Card, Badge } from '@design-system/components';
import { Icon, Building2, FileText } from '@design-system/icons';
import { Stack, Inline } from '@design-system/layouts';

const meta = {
  title: 'Components/SelectableCard',
  component: SelectableCard,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions',
          'across four files and closing a gap this catalog had recorded three times',
          'under three names — Listbox, Combobox, SelectableCard.',
          '',
          '### What it is',
          '',
          'A block of *record content* that behaves as one option. The audit found one',
          'shape behind all three recorded names: a card carrying multi-line structured',
          'content that a person picks. `SegmentedControl` could take none of them,',
          'because its `label` is a string.',
          '',
          '### Three states, and only one at a time',
          '',
          'The four migrated sites carried three different ARIA states between them, and',
          'the primitive keeps them apart rather than averaging them:',
          '',
          '- `selected` → `aria-pressed`. A two-state choice you can turn off.',
          '- `current` → `aria-current`. Which one of a set you are on.',
          '- neither. A plain activation that goes somewhere.',
          '',
          'Both together throws. They answer different questions — "is this one on" and',
          '"is this the one you are on" — and an element asserting both tells assistive',
          'technology two stories about itself.',
          '',
          '### `as="div"` is the non-interactive twin',
          '',
          'One consumer deliberately renders some rows as non-controls. `as="div"` gives',
          'them the same box and refuses a state or an `onSelect`, rather than accepting',
          'one and rendering something that looks clickable and is not.',
          '',
          '### Selected and current look identical',
          '',
          'On purpose. They differ in what they *tell* assistive technology, not in what',
          'they look like — a person looking at the screen wants one answer ("this is the',
          'one"), and a second visual language for the difference is a distinction nobody',
          'asked for. The selected weight is an inset ring rather than a thicker border,',
          'so nothing shifts by a pixel when the choice moves.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

function Record({ title, line, note }) {
  return (
    <span className="flex w-full items-start justify-between gap-ds-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ds-content">{title}</span>
        <span className="block text-ds-xs text-ds-content-secondary">{line}</span>
        {note && <span className="mt-0.5 block text-ds-xs text-ds-content-secondary">{note}</span>}
      </span>
    </span>
  );
}

/** The two-state choice: pick one record out of several suggestions. */
export const Selectable = {
  render: function Selectable() {
    const [picked, setPicked] = useState('b');
    const rows = [
      { id: 'a', title: 'Northbound Supply Co', line: 'Reference 1180422 · Denver, CO', note: 'Includes contact details' },
      { id: 'b', title: 'Northbound Supply LLC', line: 'Reference 2214870 · Aurora, CO', note: 'Identity match only' },
      { id: 'c', title: 'North Bound Supply', line: 'Reference 3390115 · Boulder, CO', note: 'Identity match only' },
    ];
    return (
      <Card>
        <ul className="m-0 flex list-none flex-col gap-ds-2 p-0">
          {rows.map((row) => (
            <li key={row.id}>
              <SelectableCard selected={picked === row.id} onSelect={() => setPicked(row.id)}>
                <Record {...row} />
              </SelectableCard>
            </li>
          ))}
        </ul>
      </Card>
    );
  },
};

/** The other state: which one of a set you are looking at. */
export const CurrentOfASet = {
  render: function CurrentOfASet() {
    const [page, setPage] = useState(2);
    return (
      <Card>
        {/* The CONTAINER sets the width, not the card. A card fills the box it is
            given — three of the four consumers are full-width rows — so a `w-24`
            written on the card itself would be silently ignored. The real page
            rail constrains its own list the same way. */}
        <Inline gap="sm" wrap>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="w-24">
            <SelectableCard
              current={page === n}
              padding="xs"
              className="flex-col gap-ds-1"
              aria-label={`Page ${n}`}
              onSelect={() => setPage(n)}
            >
              <span aria-hidden="true" className="flex h-20 w-full items-center justify-center rounded-ds-sm bg-ds-surface-subtle">
                <Icon icon={FileText} size="xl" />
              </span>
              <span className="text-ds-xs text-ds-content-secondary">Page {n}</span>
            </SelectableCard>
            </div>
          ))}
        </Inline>
      </Card>
    );
  },
};

/** Neither state: picking one signs you in, so it is an ordinary button. */
export const PlainActivation = {
  render: () => (
    <Card>
      <Stack gap="sm">
        {['Northbound Supply Co', 'Summit Works Ltd'].map((name) => (
          <SelectableCard key={name} padding="md" className="justify-between" onSelect={() => {}}>
            <span className="flex min-w-0 items-center gap-ds-3">
              <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-ds-full bg-ds-status-info-bg p-ds-2 text-ds-status-info-fg">
                <Icon icon={Building2} size="xl" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-ds-heading-sm font-semibold text-ds-content">{name}</span>
                <span className="block text-ds-sm text-ds-content-secondary">Your role: administrator</span>
              </span>
            </span>
            <span className="shrink-0 text-ds-sm font-semibold text-ds-action-primary">Select &rarr;</span>
          </SelectableCard>
        ))}
      </Stack>
    </Card>
  ),
};

/** Tone outlines the record; the inverse surface is the console panel. */
export const TonedAndInverse = {
  render: () => (
    <div className="rounded-ds-lg bg-ds-surface-inverse p-ds-4">
      <Stack gap="sm">
        <SelectableCard surface="inverse" selected>
          <span className="text-ds-content-on-inverse">Included in this run</span>
        </SelectableCard>
        <SelectableCard surface="inverse" selected={false}>
          <span className="text-ds-content-on-inverse">Excluded from this run</span>
        </SelectableCard>
        <SelectableCard as="div" surface="inverse" tone="warning">
          <Inline gap="sm">
            <span className="text-ds-content-on-inverse">Already contacted</span>
            <Badge tone="warning">Skipped</Badge>
          </Inline>
        </SelectableCard>
      </Stack>
    </div>
  ),
};
