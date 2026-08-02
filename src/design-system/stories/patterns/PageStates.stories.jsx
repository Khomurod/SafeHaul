import React from 'react';
import { fn } from 'storybook/test';
import { AlertTriangle, Inbox, Loader, Plus, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  StatusMedallion,
} from '@design-system/components';
import { Inline, PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { NOT_PROVIDED, RECORDS } from '../fixtures';

const columns = [
  {
    key: 'title',
    header: 'Record',
    rowHeader: true,
    width: 'lg',
    truncate: true,
    render: (row) => <strong>{row.title}</strong>,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: 'md',
    render: (row) => row.owner ?? <span style={{ color: 'var(--ds-color-content-muted)' }}>{NOT_PROVIDED}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 'sm',
    render: (row) => <Badge tone={row.tone}>{row.status}</Badge>,
  },
];

function StatePage({ children, actions }) {
  return (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            description="Everything currently held in this workspace."
            actions={actions}
          />
          {children}
        </Stack>
      </PageContainer>
    </div>
  );
}

/** A full-page state: medallion, heading, explanation, and a way forward. */
function FullPageState({ tone, Icon, title, body, action }) {
  return (
    <Card>
      <div style={{ textAlign: 'center', padding: 'var(--ds-space-8) var(--ds-space-4)' }}>
        <Stack gap="sm">
          <StatusMedallion tone={tone} size="lg"><Icon /></StatusMedallion>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: 0, color: 'var(--ds-color-content-secondary)' }}>{body}</p>
          {action && (
            <Inline gap="sm" style={{ justifyContent: 'center' }}>{action}</Inline>
          )}
        </Stack>
      </div>
    </Card>
  );
}

/**
 * Loading, empty and error — the three states every data-backed page has, and
 * the three that are most often left to chance.
 */
const meta = {
  title: 'Patterns/Page states',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved** for the in-table states, which `DataTable` owns and covers',
          'with tests. **Needs review** for the full-page states: they are composed here from',
          '`Card`, `StatusMedallion`, `Button` and `Stack`, and the roadmap\'s',
          '`design-system/patterns` layer — where a shared `PageState` / `EmptyState` belongs —',
          'is still empty. Follow this composition; do not invent a different one.',
          '',
          '### The three states',
          '',
          '| State | Announcement | Must include |',
          '| --- | --- | --- |',
          '| Loading | polite live region | A skeleton that preserves layout, and a spoken "Loading…" |',
          '| Empty | polite live region | Why it is empty, and the action that fills it |',
          '| Error | `role="alert"` | What failed, in plain words, and a retry |',
          '',
          '### Empty is not one state',
          '',
          'Three different situations look identical and must not read identically:',
          '',
          '1. **Nothing exists yet** — offer the action that creates the first record.',
          '2. **Nothing matches the current filters** — say so, and offer to clear them.',
          '3. **Nothing is visible to you** — a permissions boundary. Say that plainly rather',
          '   than implying the data does not exist.',
          '',
          '### Accessibility expectations',
          '',
          '- A loading state must **announce**, not just animate. `DataTable` renders a',
          '  screen-reader-only "Loading records" in a polite live region.',
          '- Skeletons must preserve the column geometry, so the page does not jump when data',
          '  arrives — a jump moves focus targets out from under the user.',
          '- Errors are `role="alert"` and are announced immediately. Empty states are',
          '  `polite` and must not interrupt.',
          '- Every state needs an accessible way forward: retry, clear filters, or create.',
          '  A dead end with no control is not a state, it is a wall.',
          '- The medallion is decorative, so the heading and body must fully distinguish the',
          '  states with the colour removed.',
          '- Skeleton animation is disabled under `prefers-reduced-motion`.',
          '',
          '### Common mistakes',
          '',
          '- A bare spinner with no text, which announces nothing.',
          '- Replacing already-loaded content with a full-page spinner on refresh. Keep the',
          '  stale data and report the failure above it — see the last story here.',
          '- "Something went wrong" with no indication of what or what to do next.',
          '- Showing an empty state while data is still loading, which reads as "no results"',
          '  for a moment and then flips.',
          '- An empty state with no action.',
          '',
          '### Determinism',
          '',
          'Every state here is driven by a prop, never by a timer. No story transitions on its',
          'own, so what you see is what a reviewer sees.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the words, which action is offered and what retry does. They must not',
          'invent new state visuals or skip a state because it is "rare".',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** Loading. Skeleton rows hold the column geometry; the announcement is polite. */
export const Loading = {
  render: () => (
    <StatePage actions={<Button variant="primary" disabled>New record</Button>}>
      <DataTable ariaLabel="Records" data={[]} columns={columns} isLoading loadingLabel="Loading records" />
    </StatePage>
  ),
};

/** Empty because nothing exists yet — the action creates the first record. */
export const EmptyNothingYet = {
  render: () => (
    <StatePage actions={<Button variant="primary" onClick={fn()}>New record</Button>}>
      <DataTable
        ariaLabel="Records"
        data={[]}
        columns={columns}
        empty={{
          icon: Inbox,
          title: 'No records yet.',
          description: 'Create the first record to get started.',
        }}
      />
    </StatePage>
  ),
};

/** Empty because of filters — a different message and a different way out. */
export const EmptyNoMatches = {
  render: () => (
    <StatePage actions={<Button variant="primary" onClick={fn()}>New record</Button>}>
      <Stack gap="md">
        <Inline gap="sm">
          <Badge tone="info">Status: In review</Badge>
          <Badge tone="info">Region: North</Badge>
          <Button variant="ghost" size="sm" onClick={fn()}>Clear all filters</Button>
        </Inline>
        <DataTable
          ariaLabel="Records"
          data={[]}
          columns={columns}
          empty={{
            icon: Inbox,
            title: 'No records match these filters.',
            description: 'Clear one or more filters to see more results.',
          }}
        />
      </Stack>
    </StatePage>
  ),
};

/** Error with nothing loaded: the failure takes the whole table body. */
export const ErrorNothingLoaded = {
  render: () => (
    <StatePage actions={<Button variant="primary" disabled>New record</Button>}>
      <DataTable
        ariaLabel="Records"
        data={[]}
        columns={columns}
        error={{ message: 'The record list could not be loaded.', onRetry: fn() }}
      />
    </StatePage>
  ),
};

/**
 * Error on refresh, with data already on screen. The stale rows stay and the
 * failure is reported above them — discarding visible data on a refresh failure
 * is strictly worse than showing it with a warning.
 */
export const ErrorWithStaleData = {
  render: () => (
    <StatePage actions={<Button variant="primary" onClick={fn()}>New record</Button>}>
      <DataTable
        ariaLabel="Records"
        data={RECORDS}
        columns={columns}
        error={{ message: 'Could not refresh. Showing the last loaded results.', onRetry: fn() }}
      />
    </StatePage>
  ),
};

/** The full-page equivalents, for screens that are not a list. */
export const FullPageStates = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <FullPageState
            tone="info"
            Icon={Loader}
            title="Preparing your workspace"
            body="This usually takes a few seconds."
          />
          <FullPageState
            tone="neutral"
            Icon={Inbox}
            title="Nothing here yet"
            body="Records you create will appear here."
            action={<Button variant="primary" onClick={fn()}><Plus size={16} aria-hidden="true" />New record</Button>}
          />
          <FullPageState
            tone="danger"
            Icon={AlertTriangle}
            title="This page could not be loaded"
            body="The connection was interrupted. Nothing has been lost — try again."
            action={<Button variant="secondary" onClick={fn()}><RefreshCw size={16} aria-hidden="true" />Try again</Button>}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/** Tablet width. */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  render: EmptyNoMatches.render,
};

/** Mobile: states keep their padding and the action stays reachable. */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader title="Records" />
          <FullPageState
            tone="neutral"
            Icon={Inbox}
            title="Nothing here yet"
            body="Records you create will appear here."
            action={<Button variant="primary" fullWidth onClick={fn()}>New record</Button>}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};
