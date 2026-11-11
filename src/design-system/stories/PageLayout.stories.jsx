import React from 'react';
import { fn } from 'storybook/test';
import { Icon, Download, Plus, Save, X } from '@design-system/icons';
import { Badge, Button, Card, MetricCard } from '@design-system/components';
import {
  Inline,
  PageContainer,
  PageEyebrow,
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
          '| `PageContainer` | The page canvas. `standard` is 1200px of content between 40px gutters (16px under 768px), 32px from the top and 48px from the bottom (20 and 40 on a phone). `wide` (default) is for work surfaces with side panes, up to 1600px. |',
          '| `PageHeader` | The page `<h1>` (30px; 24px on a phone and at `level={2}`), an optional `eyebrow` and `back` link above it, an optional record `count` beside it, the `actions` on its row, and a `description` under both. `mobileActions` is `row` (default: a full-width row after the description under 768px) or `sticky` (a bar pinned to the bottom of a phone screen). |',
          '| `PageEyebrow` | The line above a title — back link, rule, eyebrow — for a frame that draws it once above several pages. |',
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
          '- The DOM order is title, description, actions at every width. The actions are',
          '  drawn on the title row on a wide screen, but reading and Tab order never move.',
          '- `back` is a link (`Link`, with an `href`), first in the header; a page that routes',
          '  in script passes `onClick` too, and calls `preventDefault`. On a phone it has a',
          '  44px target. The eyebrow is plain text, read before the heading.',
          '- The `sticky` phone bar is the same actions element, pinned on the page-content',
          '  layer (`raised`), so the top bar, the navigation drawer and every dialog cover it.',
          '- `count` sits beside the `<h1>`, not inside it, so the heading keeps the page\'s',
          '  name. It is a `status` region read with `countLabel` ("8 records"), so a',
          '  screen reader hears the number change when a filter changes the list.',
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
                <Icon icon={Download} size="md" />
                Export
              </Button>
              <Button variant="primary" onClick={fn()}>
                <Icon icon={Plus} size="md" />
                New record
              </Button>
            </>
          )}
        />
      </PageContainer>
    </div>
  ),
};

/**
 * A list page's header: the number of records beside the heading. The screen
 * shows the number; a screen reader reads it with `countLabel`.
 */
export const HeaderWithCount = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <PageHeader
          title="Records"
          count={1284}
          countLabel="records"
          actions={<Button variant="primary" onClick={fn()}>New record</Button>}
        />
      </PageContainer>
    </div>
  ),
};

/**
 * `width="standard"` is the canvas every company workspace page uses: 1200px of
 * content, whatever the gutters. `wide` stays for work surfaces with side panes.
 */
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
              <strong>width=&quot;standard&quot;</strong> — 1200px of content between the
              gutters, the same left edge on every page that uses it.
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
 * wraps into balanced lines and keeps at least 20rem; when the actions do not
 * fit beside that, they wrap among themselves on the title row rather than
 * squeeze the title into a column of short lines. Check it at 820px too.
 */
export const LongTitleAndActions = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <PageHeader
          title="Consolidated quarterly review of every retained record held under the extended retention policy"
          description="Long titles wrap onto as many lines as they need. The actions stay on the title row and wrap among themselves when there is no room beside the title; on a phone they move under this description — verify this at the tablet and mobile viewports too."
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

/**
 * The line above the title: a back link, a rule and the eyebrow (the section the
 * page belongs to). The actions sit on the title's row, centred on its line.
 */
export const EyebrowAndBackLink = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <PageHeader
            eyebrow="Records and owners"
            title="Records"
            count={1284}
            countLabel="records"
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>
                  <Icon icon={Download} />
                  Export
                </Button>
                <Button variant="primary" onClick={fn()}>
                  <Icon icon={Plus} />
                  New record
                </Button>
              </>
            )}
          />
          <PageHeader
            back={{ label: 'Records', href: '#records' }}
            eyebrow="Records and owners"
            title="New record"
            description="Fill in what you know; everything else can be added later."
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>
                  <Icon icon={X} />
                  Cancel
                </Button>
                <Button variant="primary" onClick={fn()}>
                  <Icon icon={Save} />
                  Save record
                </Button>
              </>
            )}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * A phone: eyebrow, title, description, then the actions as a full-width row,
 * each taking an equal share.
 */
export const PhoneActionRow = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <PageHeader
          back={{ label: 'Records', href: '#records' }}
          eyebrow="Records and owners"
          title="Records"
          count={8}
          countLabel="records"
          description="Everything currently held in this workspace."
          actions={(
            <>
              <Button variant="secondary" onClick={fn()}>Export</Button>
              <Button variant="primary" onClick={fn()}>New record</Button>
            </>
          )}
        />
      </PageContainer>
    </div>
  ),
};

/**
 * `mobileActions="sticky"` on a phone: the one-form page keeps Cancel and Save
 * in a bar at the bottom of the screen, and the page makes room for it.
 */
export const StickyPhoneBar = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <PageHeader
            back={{ label: 'Records', href: '#records' }}
            eyebrow="Records and owners"
            title="New record"
            description="Fill in what you know; everything else can be added later."
            mobileActions="sticky"
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>
                  <Icon icon={X} />
                  Cancel
                </Button>
                <Button variant="primary" onClick={fn()}>
                  <Icon icon={Save} />
                  Save record
                </Button>
              </>
            )}
          />
          <Card>
            <p style={{ margin: 0 }}>The form&apos;s fields go here. The bar stays in reach while they scroll.</p>
          </Card>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * `PageEyebrow` on its own: a frame holding several pages under one eyebrow
 * draws the row once, `--ds-space-2` above each page's header.
 */
export const EyebrowDrawnByAFrame = {
  render: () => (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="sm">
          <PageEyebrow eyebrow="Preferences" />
          <PageHeader title="Notifications" description="Choose what reaches you, and how." />
        </Stack>
      </PageContainer>
    </div>
  ),
};
