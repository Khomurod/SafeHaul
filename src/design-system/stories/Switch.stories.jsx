import React, { useState } from 'react';
import { Card, Switch } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

function Row({ label, tone = 'primary', initial = false, disabled = false }) {
  const [on, setOn] = useState(initial);
  return (
    <Inline gap="sm">
      <Switch checked={on} onChange={setOn} label={label} tone={tone} disabled={disabled} />
      <span style={{ color: 'var(--ds-color-content)' }}>{label}</span>
    </Inline>
  );
}

const meta = {
  title: 'Components/Switch',
  component: Switch,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21, promoted from a feature-owned',
          '`ToggleSwitch` that was already correct — it lived in Company Settings only',
          'because the design system had no switch, which meant the Super Admin feature',
          'matrix could not import it and used a `Checkbox` instead, announcing the wrong',
          'role.',
          '',
          '### A switch is not a checkbox',
          '',
          'A checkbox is a value you set and then submit. A switch takes effect the moment',
          'it moves. Use `Checkbox` inside a form with a Save button; use `Switch` where the',
          'change applies at once. Getting this backwards gives you either a control that',
          'announces a state it has not reached, or a form field that saves behind the',
          'user\'s back.',
          '',
          '### Accessibility',
          '',
          '- `role="switch"` with `aria-checked`, on a real `<button>` — so Space and Enter',
          '  work with no key handler of our own.',
          '- `label` is required and is the accessible name. In a matrix, name **both**',
          '  dimensions: "Enable exports for Northwind Ltd", not "Enable".',
          '- The thumb\'s position is the non-colour signal. `tone` only tints the *on*',
          '  state, so state never depends on colour alone.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

export const Default = {
  render: () => (
    <Card>
      <Stack gap="md">
        <Row label="Enable exports" initial />
        <Row label="Enable notifications" />
        <Row label="Restrict public access" tone="danger" initial />
        <Row label="Verified organisation" tone="success" initial />
        <Row label="Unavailable on this plan" disabled />
      </Stack>
    </Card>
  ),
};

/** Both states side by side: the thumb moves, so colour is never the only cue. */
export const States = {
  render: () => (
    <Inline gap="lg">
      <Switch checked={false} label="Off" onChange={() => {}} />
      <Switch checked label="On" onChange={() => {}} />
      <Switch checked disabled label="On and locked" onChange={() => {}} />
    </Inline>
  ),
};

export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Card>
      <Stack gap="md">
        <Row label="Enable exports" initial />
        <Row label="Enable notifications" />
      </Stack>
    </Card>
  ),
};
