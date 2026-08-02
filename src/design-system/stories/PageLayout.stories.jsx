import React from 'react';
import { fn } from 'storybook/test';
import { Download, Plus } from 'lucide-react';
import { Badge, Button, Card, MetricCard } from '@design-system/components';
import {
  Inline,
  PageContainer,
  PageHeader,
  ResponsiveGrid,
  Section,
  Stack,
} from '@design-system/layouts';

/**
 * The page layout primitives — `PageContainer`, `PageHeader`, `Section`,
 * `Stack`, `Inline` and `ResponsiveGrid`. They own page geometry and nothing
 * else: no routing, no navigation, no domain knowledge.
 */
const meta = {
  title: 'Components/Page layout',
  component: PageHeader,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** These are consumed by the Company workspace shell and',
          'dashboard and by the Company Settings personal-profile slice.',
          '',
          '**Needs review:** there is no approved *split-panel* or *sticky page footer*',
          'primitive yet. Screens that need either currently hand-roll it; record the gap',
          'rather than adding a competing local layout.',
          '',
          '### The primitives',
          '',
          '| Primitive | Owns |',
          '| --- | --- |',
          '| `PageContainer` | Maximum page width and horizontal gutters. `width` is `wide` (default) or `standard`. |',
          '| `PageHeader` | The page `<h1>`, an optional description, and a right-hand action slot. |',
          '| `Section` | A labelled region within a page. Pass `labelledBy` pointing at its heading. |',
          '| `Stack` | Vertical rhythm. `gap` is `sm`, `md` (default) or `lg`. |',
          '| `Inline` | Horizontal grouping that wraps by default. Same `gap` scale. |',
          '| `ResponsiveGrid` | An auto-fitting grid; `minItemWidth` sets the reflow point. |',
          '',
          '### Accessibility expectations',
          '',
          '- `PageHeader` renders an `<h1>`. **One per page** — a second `PageHeader` on the',
          '  same screen produces two top-level headings and breaks the outline.',
          '- `Section` is a real `<section>`. An unnamed section is not a useful landmark, so',
          '  give it `labelledBy` referencing its own heading id.',
          '- Heading levels must descend without gaps: the `h1` from `PageHeader`, then `h2`',
          '  for each section.',
          '- `Stack` and `Inline` are presentational `div`s with no semantics. Never use them',
          '  where a `<ul>` is what the content actually is.',
          '- Actions in the header follow the header in DOM order, so keyboard order matches',
          '  reading order.',
          '',
          '### Common mistakes',
          '',
          '- Ad-hoc margins on children instead of a `Stack` gap; the rhythm drifts off the',
          '  token scale immediately.',
          '- More than two or three actions in `PageHeader`. Past that, the header wraps',
          '  awkwardly on mobile — move secondary actions into the content.',
          '- Using `Inline` for a list of records; that is a `ResponsiveGrid` or a table.',
          '- Nesting `PageContainer` inside another `PageContainer`, which doubles the gutter.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the page title, the description, which actions exist and what the',
          'sections contain. They must not set their own page widths, gutters or vertical',
          'rhythm. `CompanyAppShell` deliberately stays in its feature because it knows',
          'company navigation and deactivation behaviour.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** A page header with a description and two actions. */
export const Default = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <PageHeader
          title="Records"
          description="Everything currently held in this workspace."
          actions={(
            <>
              <Button variant="secondary" onClick={fn()}>
                <Download size={16} aria-hidden="true" />
                Export
              </Button>
              <Button variant="primary" onClick={fn()}>
                <Plus size={16} aria-hidden="true" />
                New record
              </Button>
            </>
          )}
        />
      </PageContainer>
    </div>
  ),
};

/** `width="standard"` narrows the column for reading-heavy or form pages. */
export const ContainerWidths = {
  render: () => (
    <div className="sb-page">
      <Stack gap="lg">
        <PageContainer width="wide">
          <Card>
            <p style={{ margin: 0 }}>
              <strong>width=&quot;wide&quot;</strong> — the default. For dashboards and tables,
              where horizontal space is useful.
            </p>
          </Card>
        </PageContainer>
        <PageContainer width="standard">
          <Card>
            <p style={{ margin: 0 }}>
              <strong>width=&quot;standard&quot;</strong> — a narrower measure for forms and
              long-form reading, where an over-wide line is hard to follow.
            </p>
          </Card>
        </PageContainer>
      </Stack>
    </div>
  ),
};

/** The three `Stack` gaps, which are the same scale `Inline` uses. */
export const StackAndInlineGaps = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <ResponsiveGrid minItemWidth="260px">
          {['sm', 'md', 'lg'].map((gap) => (
            <div className="sb-specimen" key={gap}>
              <span className="sb-specimen__label">gap={gap}</span>
              <Card>
                <Stack gap={gap}>
                  <Badge tone="info">First</Badge>
                  <Badge tone="info">Second</Badge>
                  <Badge tone="info">Third</Badge>
                </Stack>
              </Card>
            </div>
          ))}
        </ResponsiveGrid>
      </PageContainer>
    </div>
  ),
};

/** `Inline` wraps by default; `wrap={false}` keeps a row on one line. */
export const InlineWrapping = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <div className="sb-specimen">
            <span className="sb-specimen__label">wrap (default) — reflows on narrow widths</span>
            <Card>
              <Inline gap="sm">
                {['Complete', 'In review', 'Pending', 'Archived', 'Blocked', 'Escalated'].map((label) => (
                  <Badge key={label} tone="neutral">{label}</Badge>
                ))}
              </Inline>
            </Card>
          </div>
          <div className="sb-specimen">
            <span className="sb-specimen__label">wrap=false — only where overflow is handled</span>
            <Card>
              <Inline gap="sm" wrap={false}>
                {['Complete', 'In review', 'Pending', 'Archived', 'Blocked', 'Escalated'].map((label) => (
                  <Badge key={label} tone="neutral">{label}</Badge>
                ))}
              </Inline>
            </Card>
          </div>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/** A full page skeleton: header, metric row, and two labelled sections. */
export const FullPageComposition = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            description="Everything currently held in this workspace."
            actions={<Button variant="primary" onClick={fn()}>New record</Button>}
          />

          <ResponsiveGrid minItemWidth="200px">
            <MetricCard label="Total" value="1,284" tone="neutral" />
            <MetricCard label="In review" value="36" tone="info" />
            <MetricCard label="Complete" value="912" tone="success" />
            <MetricCard label="Blocked" value="4" tone="danger" />
          </ResponsiveGrid>

          <Section labelledBy="story-section-recent">
            <Card>
              <Stack gap="sm">
                <h2 id="story-section-recent" style={{ margin: 0 }}>Recent activity</h2>
                <p style={{ margin: 0 }}>
                  Each section names itself, so the page outline is `h1` then `h2` with no gaps.
                </p>
              </Stack>
            </Card>
          </Section>

          <Section labelledBy="story-section-attention">
            <Card>
              <Stack gap="sm">
                <h2 id="story-section-attention" style={{ margin: 0 }}>Needs attention</h2>
                <p style={{ margin: 0 }}>A second section at the same heading level.</p>
              </Stack>
            </Card>
          </Section>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * Long title and many actions — the case that breaks page headers. The title
 * wraps and the actions drop below it rather than being squeezed or clipped.
 */
export const LongTitleAndActions = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <PageHeader
          title="Consolidated quarterly review of every retained record held under the extended retention policy"
          description="Long titles wrap onto as many lines as they need. The action slot keeps its alignment and drops below the title when there is no room beside it — verify this at the tablet and mobile viewports too."
          actions={(
            <>
              <Button variant="ghost" onClick={fn()}>Configure</Button>
              <Button variant="secondary" onClick={fn()}>Export</Button>
              <Button variant="primary" onClick={fn()}>New record</Button>
            </>
          )}
        />
      </PageContainer>
    </div>
  ),
};

/** Mobile: the header stacks and actions go full width. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Records"
            description="Everything currently held in this workspace."
            actions={<Button variant="primary" fullWidth onClick={fn()}>New record</Button>}
          />
          <ResponsiveGrid minItemWidth="200px">
            <MetricCard label="Total" value="1,284" tone="neutral" />
            <MetricCard label="In review" value="36" tone="info" />
          </ResponsiveGrid>
        </Stack>
      </PageContainer>
    </div>
  ),
};
