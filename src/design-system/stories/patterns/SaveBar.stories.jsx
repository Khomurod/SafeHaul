import React, { useState } from 'react';
import { fn } from 'storybook/test';
import { FormField, FormSection, Input } from '@design-system/components';
import { PageContainer, PageHeader, Stack } from '@design-system/layouts';
import { SaveBar } from '@design-system/patterns';

const SAVED = { name: 'North depot', region: 'North' };

/**
 * A settings page as the pattern composes it: the form, and the bar under it
 * while something is changed. The story owns the values, as a page would.
 */
function SettingsExample({ initial = { name: 'North depot', region: 'South' }, saving = false, error }) {
  const [form, setForm] = useState(initial);
  const changed = Object.keys(SAVED).filter((key) => form[key] !== SAVED[key]);
  const summary = `${changed.length} ${changed.length === 1 ? 'change' : 'changes'} · ${changed.map((key) => (key === 'name' ? 'Name' : 'Region')).join(', ')}`;

  return (
    <div className="sb-page">
      <PageContainer width="standard">
        <Stack gap="lg">
          <PageHeader title="Record settings" description="How this record is named and where it belongs." />
          <FormSection title="Details">
            <Stack gap="md">
              <FormField id="save-bar-name" label="Name">
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </FormField>
              <FormField id="save-bar-region" label="Region">
                <Input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} />
              </FormField>
            </Stack>
          </FormSection>
          {changed.length > 0 && (
            <SaveBar
              summary={summary}
              saving={saving}
              error={error}
              onSave={fn()}
              onDiscard={() => setForm(SAVED)}
            />
          )}
        </Stack>
      </PageContainer>
    </div>
  );
}

const meta = {
  title: 'Patterns/Save bar',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          '**Status: Approved.** The one bar a page shows while it has changes that are not',
          'saved. The rules are in `src/design-system/patterns/save-bar/README.md`.',
          '',
          '- Rendered only while something is changed; never disabled on a clean page.',
          '- What changed, Discard, Save, in one row at every width.',
          '- `useUnsavedChanges` asks before the tab closes; a shell routes its section',
          '  switches through `useUnsavedChangesGuard` and a `ConfirmDialog`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

export const Default = { render: () => <SettingsExample /> };

export const Saving = { render: () => <SettingsExample saving /> };

export const WithError = {
  render: () => <SettingsExample initial={{ name: 'North yard', region: 'South' }} error="Could not save. Try again." />,
};
