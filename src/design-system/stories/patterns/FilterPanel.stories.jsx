import React, { useState } from 'react';
import { fn } from 'storybook/test';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ChoiceGroup,
  DataTable,
  FormField,
  FormSection,
  IconButton,
  Input,
  Radio,
  Select,
} from '@design-system/components';
import { Inline, PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { NOT_PROVIDED, RECORDS } from '../fixtures';

const resultColumns = [
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    width: 'lg',
    truncate: true,
    render: (row) => (
      <div>
        <strong>{row.title}</strong>
        <div style={{ color: 'var(--ds-color-content-muted)', fontSize: 'var(--ds-font-size-sm)' }}>
          {row.reference}
        </div>
      </div>
    ),
  },
  {
    key: 'owner',
    header: 'Owner',
    width: 'md',
    truncate: true,
    render: (row) => row.owner ?? <span style={{ color: 'var(--ds-color-content-muted)' }}>{NOT_PROVIDED}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 'sm',
    render: (row) => <Badge tone={row.tone}>{row.status}</Badge>,
  },
  {
    key: 'updated',
    header: 'Updated',
    width: 'sm',
    priority: 'tertiary',
    render: (row) => row.updated,
  },
];

/** The applied filters, shown as removable summary chips above the results. */
function AppliedFilters({ filters, onRemove }) {
  if (filters.length === 0) return null;
  return (
    <Inline gap="sm">
      <span style={{ color: 'var(--ds-color-content-secondary)', fontSize: 'var(--ds-font-size-sm)' }}>
        Filters applied:
      </span>
      {filters.map((filter) => (
        <Inline gap="sm" key={filter} wrap={false}>
          <Badge tone="info">{filter}</Badge>
          <IconButton size="sm" variant="ghost" label={`Remove filter: ${filter}`} onClick={onRemove}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Inline>
      ))}
    </Inline>
  );
}

function FilterPanelExample({ appliedFilters = ['Status: In review', 'Region: North'], data = RECORDS, empty }) {
  const [filters, setFilters] = useState(appliedFilters);

  return (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            description="Everything currently held in this workspace."
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />

          <div className="pattern-filter-layout">
            <FormSection
              title="Filters"
              description="Narrow the results below."
              actions={(
                <Button variant="ghost" size="sm" onClick={() => setFilters([])}>Clear all</Button>
              )}
            >
              <Stack gap="md">
                <FormField label="Search" description="Matches the title and the reference.">
                  <Input type="search" placeholder="Search records" onChange={fn()} />
                </FormField>

                <ChoiceGroup legend="Status">
                  <Checkbox label="Complete" onChange={fn()} />
                  <Checkbox label="In review" defaultChecked onChange={fn()} />
                  <Checkbox label="Pending" onChange={fn()} />
                  <Checkbox label="Blocked" onChange={fn()} />
                </ChoiceGroup>

                <FormField label="Region">
                  <Select defaultValue="north" onChange={fn()}>
                    <option value="">Any region</option>
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                  </Select>
                </FormField>

                <ChoiceGroup legend="Updated" orientation="vertical">
                  <Radio name="pattern-filter-updated" value="any" label="Any time" defaultChecked onChange={fn()} />
                  <Radio name="pattern-filter-updated" value="week" label="Last 7 days" onChange={fn()} />
                  <Radio name="pattern-filter-updated" value="month" label="Last 30 days" onChange={fn()} />
                </ChoiceGroup>

                <Checkbox
                  label="Include archived records"
                  description="Archived records are hidden by default."
                  onChange={fn()}
                />

                <Button variant="primary" fullWidth onClick={fn()}>
                  <Search size={16} aria-hidden="true" />
                  Apply filters
                </Button>
              </Stack>
            </FormSection>

            <Stack gap="md">
              <AppliedFilters filters={filters} onRemove={() => setFilters([])} />
              <DataTable
                ariaLabel="Filtered records"
                data={data}
                columns={resultColumns}
                density="compact"
                empty={empty ?? { title: 'No records match these filters.' }}
              />
            </Stack>
          </div>
        </Stack>
      </PageContainer>
    </div>
  );
}

/**
 * A filter panel beside its results: the standard "narrow a list" composition,
 * built from approved form primitives.
 */
const meta = {
  title: 'Patterns/Filter panel',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Needs review.** Every control here is an approved primitive, but two',
          'pieces of the pattern are not settled:',
          '',
          '- **There is no approved filter-chip primitive.** The removable "filters applied"',
          '  summary below is composed from `Badge` + `IconButton` because a `Badge` is',
          '  deliberately non-interactive. That composition works and is accessible, but it is',
          '  not yet an approved component — record the gap before reusing it widely.',
          '- **There is no approved collapsible/disclosure primitive**, so the mobile',
          '  behaviour here is a full-width panel above the results rather than a collapsed',
          '  drawer.',
          '',
          '### Anatomy',
          '',
          '1. `FormSection` titled "Filters", with a "Clear all" action in its slot.',
          '2. A search `Input`, then grouped filters — `ChoiceGroup` with checkboxes for',
          '   multi-select, radios for single-select, `Select` for a longer closed list.',
          '3. An explicit "Apply filters" action.',
          '4. A summary of applied filters above the results, each individually removable.',
          '5. The results themselves — here a compact `DataTable`.',
          '',
          '### Accessibility expectations',
          '',
          '- Every filter group needs a `ChoiceGroup` legend. A column of checkboxes with no',
          '  legend never states what is being filtered.',
          '- The applied-filter summary is the accessible equivalent of "you are not seeing',
          '  everything". Without it, an empty result set is indistinguishable from no data.',
          '- Each remove control names the filter it removes — `Remove filter: Status: In',
          '  review`, never a bare `Remove`.',
          '- If results update as filters change, the result count must be a polite live',
          '  region. `DataTable` already announces its loading and empty states.',
          '- Filter controls come before the results in DOM order, matching the visual order.',
          '- "Clear all" must be reachable and must not also submit the form.',
          '',
          '### Common mistakes',
          '',
          '- Applying filters on every keystroke, so the results move while the user is still',
          '  typing and a screen reader is interrupted continuously.',
          '- Hiding the applied filters once the panel is collapsed, leaving no explanation',
          '  for a short result list.',
          '- An empty state that says "No records" when the truth is "no records *match these',
          '  filters*" — the fix is a different message and a way to clear them.',
          '- Making the filter panel a scroll region taller than the viewport with the Apply',
          '  action stranded below the fold.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own which filters exist, their vocabulary, their defaults and how they',
          'are applied. They must not restyle the controls or invent a local chip.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: filters applied, results showing. */
export const Default = { render: () => <FilterPanelExample /> };

/** No filters applied — the summary row is absent rather than empty. */
export const NoFiltersApplied = {
  render: () => <FilterPanelExample appliedFilters={[]} />,
};

/**
 * The filtered-empty case. The message says the filters are the reason, which
 * is the difference between a dead end and an obvious next step.
 */
export const NoMatchingResults = {
  render: () => (
    <FilterPanelExample
      data={[]}
      empty={{
        title: 'No records match these filters.',
        description: 'Clear one or more filters, or widen the date range, to see more results.',
      }}
    />
  ),
};

/** Tablet: the panel and results stack, both keeping full width. */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  render: () => <FilterPanelExample />,
};

/**
 * Mobile. Until an approved disclosure primitive exists, the panel sits above
 * the results at full width rather than collapsing into a drawer.
 */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <p className="sb-note">
        <SlidersHorizontal size={14} aria-hidden="true" /> There is no approved collapsible
        primitive yet, so the panel is shown in full above the results. A collapsed
        filter drawer is a recorded roadmap gap, not something to hand-roll here.
      </p>
      <FilterPanelExample />
    </Stack>
  ),
};
