import React from 'react';
import { fn } from 'storybook/test';
import { Icon, AlertTriangle, Inbox, Loader, Plus, RefreshCw } from '@design-system/icons';
import {
  Badge,
  Button,
  DataTable,
} from '@design-system/components';
import { EmptyState, ErrorState, LoadingState } from '@design-system/patterns';
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
          '**Status: Approved.** The in-table states are `DataTable`\'s and are covered by its',
          'tests. The full-page states are `EmptyState`, `ErrorState` and `LoadingState` from',
          '`@design-system/patterns`, added 2026-08-21 — this page used to hand-compose them',
          'from `Card`, `StatusMedallion` and inline styles, and said "follow this composition;',
          'do not invent a different one", which is a component waiting to be written.',
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
          '### The three props most often written by hand instead',
          '',
          'Each of these was hand-written at more than one call site before it was a prop,',
          'which is the bar for adding one:',
          '',
          '| Prop | For | Why not at the call site |',
          '| --- | --- | --- |',
          '| `titleId` | A full-page state that is the accessible name of its `<main>` | `role="status"` is not valid on `<main>`, so the landmark and the live region must be separate elements — leaving the landmark nothing to be named by unless the heading has an id. The alternative is duplicating the title into an `aria-label` |',
          '| `children` | A confirmation reference, a checklist of what is still outstanding | The description is a `<p>`, so a bordered panel or a list cannot go in it |',
          '| `focusOnMount` | A state that REPLACES the control the user just activated | Focus falls to `<body>`, so a keyboard or screen-reader user is never taken to the confirmation they asked for. Announcement does not move the reading position |',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the words, which action is offered and what retry does. They must not',
          'invent new state visuals or skip a state because it is "rare".',
          '',
          '**The failure mode this page exists to prevent is not a raw `<div>`.** It is a',
          '*hand-composed* state: `Card` + `StatusMedallion` + heading + body + actions, every',
          'ingredient approved, arranged into the shape these three components own. Fifteen of',
          'those were found in the product on 2026-08-25, several written after this pattern',
          'existed, and the nine full-page ones had two title sizes, two medallion sizes, icons',
          'at 28/32/40/48px and three different gaps under the medallion between them. No',
          'automated rule can see one, because there is nothing wrong with any of the parts.',
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

/**
 * The full-page equivalents, for screens that are not a list. Each picks its own
 * announcement: loading and empty are polite, the error is an alert.
 */
export const FullPageStates = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <LoadingState
            icon={Loader}
            title="Preparing your workspace"
            description="This usually takes a few seconds."
          />
          <EmptyState
            icon={Inbox}
            title="Nothing here yet"
            description="Records you create will appear here."
            actions={<Button variant="primary" onClick={fn()}><Icon icon={Plus} />New record</Button>}
          />
          <ErrorState
            title="This page could not be loaded"
            description="The connection was interrupted. Nothing has been lost — try again."
            actions={<Button variant="secondary" onClick={fn()}><Icon icon={RefreshCw} />Try again</Button>}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * On a dark console surface. `surface="inverse"` recolours the title and the
 * description to the on-inverse roles and drops the card — without it the title
 * renders in `--ds-color-content`, which is near-black and therefore invisible
 * here.
 *
 * The medallion is deliberately not inverted. Its tinted backgrounds are light,
 * so it reads as a light chip on the panel — the same way `Badge` already does
 * on these surfaces. Inverting it would make the state the one element on the
 * panel following different rules.
 */
export const OnAnInverseSurface = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <div className="rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse p-ds-4">
            <LoadingState
              surface="inverse"
              icon={Loader}
              title="Reading the current selection"
              description="This usually takes a few seconds."
            />
          </div>
          <div className="rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse p-ds-4">
            <EmptyState
              surface="inverse"
              icon={Inbox}
              title="No records match these filters"
              description="Widen a filter to see more."
            />
          </div>
          <div className="rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse p-ds-4">
            <ErrorState
              surface="inverse"
              title="This preview could not be loaded"
              description="The connection was interrupted. Nothing has been lost — try again."
              actions={<Button variant="secondary" onClick={fn()}><Icon icon={RefreshCw} />Try again</Button>}
            />
          </div>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * Empty is not one state. These three look identical and must not read
 * identically — the third is a permissions boundary, and saying "no records"
 * there implies data does not exist when the caller simply cannot see it.
 */
export const EmptyIsNotOneState = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <EmptyState
            icon={Inbox}
            title="No records yet"
            description="Create the first record to get started."
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />
          <EmptyState
            icon={Inbox}
            title="No records match these filters"
            description="Clear one or more filters to see more results."
            actions={<Button variant="secondary" onClick={fn()}>Clear all filters</Button>}
          />
          <EmptyState
            tone="warning"
            icon={AlertTriangle}
            title="You do not have access to these records"
            description="Ask an administrator to grant you access. Records may exist that are not shown here."
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
          <EmptyState
            icon={Inbox}
            title="Nothing here yet"
            description="Records you create will appear here."
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * The three props above, in the shape their real consumers use them: a full-page
 * state that names its own landmark, carries a reference the reader needs, and
 * takes focus because the control that produced it is gone.
 */
export const FullPageWithReferenceAndFocus = {
  render: () => (
    <main
      aria-labelledby="page-state-story-title"
      className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4"
    >
      <EmptyState
        className="w-full max-w-md"
        icon={Inbox}
        headingLevel={1}
        titleId="page-state-story-title"
        title="Submission received"
        description="We have your submission and someone will be in touch."
        actions={<Button variant="ghost" onClick={fn()}>Go to home</Button>}
      >
        <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3 text-center">
          <p className="mb-ds-1 text-ds-xs uppercase tracking-wide text-ds-content-secondary">
            Reference
          </p>
          <p className="font-mono text-ds-body-lg font-bold text-ds-content">REF-2026-0000123</p>
        </div>
      </EmptyState>
    </main>
  ),
};
