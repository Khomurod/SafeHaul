import React from 'react';
import { fn } from 'storybook/test';
import { ArrowLeft, Download, MoreHorizontal, Share2 } from 'lucide-react';
import { Badge, Button, Card, IconButton } from '@design-system/components';
import { Inline, PageContainer, PageHeader, Stack } from '@design-system/layouts';

/**
 * The pattern for a detail page reached from a list: a back affordance above the
 * page title, the title itself, and the page-level actions on the right.
 */
const meta = {
  title: 'Patterns/Back navigation and page header',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Needs review.** The composition below is built entirely from approved',
          'primitives, but one piece of it is not settled: **there is no approved `Link` or',
          '`ButtonLink` primitive.** A back affordance is semantically a *link* — it should be',
          'openable in a new tab and announced as a link — yet the only approved control that',
          'looks right is `Button`.',
          '',
          'The driver dossier already carries four styled `<a>` navigations as a recorded',
          'feature-owned exception for exactly this reason. This pattern therefore shows the',
          'layout as approved and flags the element choice as open. Record the gap rather',
          'than inventing a local link component.',
          '',
          '### Anatomy',
          '',
          '1. A back affordance, above the title, aligned to the container gutter.',
          '2. `PageHeader` with the record title as the page `<h1>` and an optional',
          '   description.',
          '3. Page-level actions in the header\'s action slot, primary action last.',
          '4. Status, if any, beside the title — not inside it.',
          '',
          '### Accessibility expectations',
          '',
          '- Back comes **before** the `<h1>` in DOM order, so it is the first thing reached',
          '  and matches the visual order.',
          '- Its accessible name should say where it goes — `Back to records`, not `Back`.',
          '  When the destination is genuinely unknown, `Back` is acceptable but weaker.',
          '- Browser back is not a substitute: users arrive at detail pages from search,',
          '  notifications and direct links.',
          '- Keep one `<h1>` per page — the one `PageHeader` renders.',
          '- Do not put the status badge inside the `<h1>`; it becomes part of the page name.',
          '',
          '### Common mistakes',
          '',
          '- A bare `←` with no text, so the accessible name is a glyph.',
          '- Putting back navigation *inside* the header actions on the right, where it reads',
          '  as an action rather than a way out.',
          '- Three or more prominent actions, which wrap badly at tablet width.',
          '- A breadcrumb trail and a back affordance doing the same job.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the destination, the title, the description, the status vocabulary',
          'and which actions exist. They must not restyle the header or add a second `<h1>`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

function BackLink({ children = 'Back to records' }) {
  return (
    <Button variant="ghost" size="sm" onClick={fn()}>
      <ArrowLeft size={16} aria-hidden="true" />
      {children}
    </Button>
  );
}

/** The default detail-page header. */
export const Default = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="md">
          <div><BackLink /></div>
          <PageHeader
            title="Northern intake batch"
            description="REC-000103 · Updated 11 March 2026"
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>
                  <Download size={16} aria-hidden="true" />
                  Export
                </Button>
                <Button variant="primary" onClick={fn()}>Open record</Button>
              </>
            )}
          />
          <Card>
            <p style={{ margin: 0 }}>Page content begins here.</p>
          </Card>
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * Status sits in its own row next to the back affordance — *not* inside the
 * `<h1>`. A badge nested in the heading becomes part of the page's accessible
 * name, and a `div` inside an `h1` is invalid HTML besides.
 */
export const WithStatus = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="md">
          <Inline gap="sm">
            <BackLink />
            <Badge tone="warning">Pending</Badge>
          </Inline>
          <PageHeader
            title="Northern intake batch"
            description="REC-000103 · Updated 11 March 2026"
            actions={<Button variant="primary" onClick={fn()}>Open record</Button>}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/**
 * More actions than fit comfortably. Two named actions plus an overflow control
 * is the ceiling; anything else belongs in the page body.
 */
export const WithOverflowActions = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="md">
          <div><BackLink /></div>
          <PageHeader
            title="Northern intake batch"
            description="REC-000103 · Updated 11 March 2026"
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>
                  <Share2 size={16} aria-hidden="true" />
                  Share
                </Button>
                <Button variant="primary" onClick={fn()}>Open record</Button>
                <IconButton variant="ghost" label="More actions" onClick={fn()}>
                  <MoreHorizontal size={18} aria-hidden="true" />
                </IconButton>
              </>
            )}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/** A long title wraps; the back affordance and actions keep their alignment. */
export const LongTitle = {
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="md">
          <div><BackLink>Back to the consolidated record list</BackLink></div>
          <PageHeader
            title="Quarterly consolidated review of every retained record held under the extended retention policy"
            description="REC-000102 · Updated 11 March 2026 · Owned by M. Delacroix-Whitfield"
            actions={(
              <>
                <Button variant="secondary" onClick={fn()}>Export</Button>
                <Button variant="primary" onClick={fn()}>Open record</Button>
              </>
            )}
          />
        </Stack>
      </PageContainer>
    </div>
  ),
};

/** Tablet width — where the action row first competes with the title. */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  render: Default.render,
};

/** Mobile: back stays first, the title wraps, and actions go full width. */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="md">
          <div><BackLink /></div>
          <PageHeader
            title="Northern intake batch"
            description="REC-000103 · Updated 11 March 2026"
            actions={<Button variant="primary" fullWidth onClick={fn()}>Open record</Button>}
          />
          <Card>
            <p style={{ margin: 0 }}>Page content begins here.</p>
          </Card>
        </Stack>
      </PageContainer>
    </div>
  ),
};
