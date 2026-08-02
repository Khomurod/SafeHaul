import React, { useState } from 'react';
import { fn } from 'storybook/test';
import { Bell, FileText, History, Settings, Shield, SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  FieldDisplay,
  FormField,
  Input,
  SectionNavigation,
} from '@design-system/components';
import { Inline, PageContainer, PageHeader, Section, Stack } from '@design-system/layouts';

const ICONS = {
  overview: FileText,
  details: SlidersHorizontal,
  history: History,
  preferences: Settings,
  notifications: Bell,
  advanced: Shield,
};

const GROUPS = [
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'overview', label: 'Overview', icon: ICONS.overview },
      { id: 'details', label: 'Details', icon: ICONS.details },
      { id: 'history', label: 'History', icon: ICONS.history },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { id: 'preferences', label: 'Preferences', icon: ICONS.preferences },
      { id: 'notifications', label: 'Notifications', icon: ICONS.notifications },
      { id: 'advanced', label: 'Advanced', icon: ICONS.advanced, disabled: true },
    ],
  },
];

const PANELS = {
  overview: {
    heading: 'Overview',
    body: (
      <Stack gap="md">
        <FieldDisplay label="Reference">REC-000102</FieldDisplay>
        <FieldDisplay label="Created">11 March 2026</FieldDisplay>
        <FieldDisplay label="Owner" emphasis="strong">M. Delacroix-Whitfield</FieldDisplay>
      </Stack>
    ),
  },
  details: {
    heading: 'Details',
    body: (
      <Stack gap="md">
        <FormField label="Title" required><Input defaultValue="Northern intake batch" onChange={fn()} /></FormField>
        <FormField label="Reference" description="Generated when the record is created.">
          <Input readOnly defaultValue="REC-000102" onChange={fn()} />
        </FormField>
        <Inline gap="sm">
          <Button variant="primary" onClick={fn()}>Save changes</Button>
          <Button variant="secondary" onClick={fn()}>Cancel</Button>
        </Inline>
      </Stack>
    ),
  },
  history: {
    heading: 'History',
    body: <p style={{ margin: 0 }}>Every change made to this record, most recent first.</p>,
  },
  preferences: {
    heading: 'Preferences',
    body: <p style={{ margin: 0 }}>Settings that apply to this record only.</p>,
  },
  notifications: {
    heading: 'Notifications',
    body: <p style={{ margin: 0 }}>Who is told when this record changes.</p>,
  },
  advanced: {
    heading: 'Advanced',
    body: <p style={{ margin: 0 }}>Unavailable for this record.</p>,
  },
};

const PANEL_ID = 'pattern-section-panel';

function SectionLayout({ initialId = 'overview' }) {
  const [currentId, setCurrentId] = useState(initialId);
  const panel = PANELS[currentId];

  return (
    <div className="sb-page">
      <PageContainer>
        <Stack gap="lg">
          <PageHeader
            title="Record settings"
            description="Everything configurable about this record, grouped by area."
            actions={<Badge tone="info">Draft</Badge>}
          />

          <div className="pattern-section-layout">
            <SectionNavigation
              label="Record settings sections"
              groups={GROUPS}
              currentId={currentId}
              onSelect={setCurrentId}
              controlsId={PANEL_ID}
            />

            <Section labelledBy={`${PANEL_ID}-heading`} id={PANEL_ID}>
              <Card>
                <Stack gap="md">
                  <h2 id={`${PANEL_ID}-heading`} style={{ margin: 0 }}>{panel.heading}</h2>
                  {panel.body}
                </Stack>
              </Card>
            </Section>
          </div>
        </Stack>
      </PageContainer>
    </div>
  );
}

/**
 * The settings-style layout: grouped section navigation beside the region it
 * controls.
 */
const meta = {
  title: 'Patterns/Section navigation and content',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** This is the Company Settings shell composition, built from',
          '`SectionNavigation`, `PageHeader`, `Section` and `Card`. The settings feature keeps',
          'its own tab state, labels, feature flags, permissions and rendered content.',
          '',
          '**Not a tablist.** This pattern is *navigation between sections*, not a WAI-ARIA',
          'tab widget, and the two have different keyboard contracts. There is still no',
          'approved `Tabs` primitive — the driver dossier\'s tablist is a recorded',
          'feature-owned exception. Do not restyle this into a horizontal tab strip to fake',
          'one.',
          '',
          '### Anatomy',
          '',
          '1. `PageHeader` — the page `<h1>`, shared by every section.',
          '2. `SectionNavigation` — grouped items, with `controlsId` pointing at the panel.',
          '3. A `Section` containing a `Card`, headed by an `<h2>` that names the panel.',
          '',
          'The two-column grid collapses to one column below the tablet breakpoint.',
          '',
          '### Accessibility expectations',
          '',
          '- The page keeps **one `<h1>`**. Each panel heading is an `<h2>` — the section title',
          '  never becomes a second page title.',
          '- The panel is a named `Section`, labelled by its own `<h2>`, and the navigation',
          '  points at it with `controlsId`, so the relationship is announced.',
          '- The current item carries `aria-current="page"`.',
          '- Arrow keys move focus within the navigation; activation changes the panel.',
          '  Focus is not forced into the panel on selection — that would strand keyboard',
          '  users who are still scanning the list.',
          '- A disabled item needs an explanation somewhere on the page. Here, "Advanced" is',
          '  disabled and the panel says why.',
          '',
          '### Common mistakes',
          '',
          '- Rendering an `<h1>` inside each panel, producing several page titles.',
          '- Losing unsaved form state when switching sections with no warning.',
          '- Hiding panels with CSS instead of not rendering them, so hidden controls stay in',
          '  the tab order.',
          '- Collapsing the navigation into an unlabelled icon rail at tablet width.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the groups, labels, permissions, which items are disabled, and',
          'everything each panel renders. They must not restyle the navigation or the grid.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default two-column settings layout. */
export const Default = { render: () => <SectionLayout /> };

/** A section whose panel is a form rather than read-only values. */
export const FormPanel = { render: () => <SectionLayout initialId="details" /> };

/** Tablet width — the point at which the two columns start to feel tight. */
export const TabletViewport = {
  globals: { viewport: { value: 'safehaulTablet' } },
  render: () => <SectionLayout />,
};

/** Mobile: the navigation stacks above the panel, keeping its labels. */
export const MobileViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => <SectionLayout />,
};
