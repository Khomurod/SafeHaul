import React from 'react';
import { fn } from 'storybook/test';
import { Checkbox, ChoiceGroup, Radio } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `Checkbox`, `Radio` and `ChoiceGroup` are the approved native-first choice
 * controls. `Checkbox` is documented here; `Radio` and `ChoiceGroup` share the
 * same row anatomy and appear in the stories below.
 */
const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { label: 'Send a confirmation message', onChange: fn() },
  argTypes: {
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    labelHidden: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** These closed the roadmap\'s Phase 4 "Checkbox, Radio" gap',
          'and are proven by the public driver application, agreements and custom questions.',
          '',
          '**Still open and deliberately not shown as approved here:** an ARIA `switch`',
          '(`ToggleSwitch`) and an *indeterminate* checkbox. `DataTable` has its own internal',
          'indeterminate select-all control, but that is table-owned and not a general',
          'primitive. Do not hand-roll either — record the need in the roadmap.',
          '',
          '### Intended use',
          '',
          '- `Checkbox` — an independent on/off choice, or several that are not mutually',
          '  exclusive.',
          '- `Radio` — one choice from a small mutually exclusive set. Always inside a',
          '  `ChoiceGroup`, and always with a shared `name`.',
          '- `ChoiceGroup` — the `<fieldset>`/`<legend>` wrapper that asks the question the',
          '  options answer. Orientation is `vertical` (default) or `horizontal`.',
          '',
          '### Why native inputs',
          '',
          'The browser already gives radio groups the correct roving-focus keyboard model',
          '(arrow keys move *and* select within a `name`, Tab leaves the group),',
          'required-group validation, and platform autofill. A `div`-with-role',
          'reimplementation loses all three.',
          '',
          '### Accessibility expectations',
          '',
          '- `label` is required and **throws** when missing or blank — an unlabelled box is',
          '  the defect this primitive exists to prevent.',
          '- `labelHidden` hides the label visually while keeping it as the accessible name.',
          '  Use it only where surrounding structure already carries the meaning for sighted',
          '  users, such as a checkbox in a matrix cell with row and column headers.',
          '- `Radio` throws without a `name`, because without one the browser cannot group the',
          '  options and arrow keys stop working.',
          '- The required marker belongs on the group legend, not on every option.',
          '  `requiredMark` exists to split those two so a group does not announce',
          '  "Yes required, No required".',
          '- Each row keeps a 44px touch target regardless of the visual control size.',
          '- Clicking the label toggles the control — that is native behaviour and must not',
          '  be broken.',
          '',
          '### Common mistakes',
          '',
          '- A single checkbox used to choose between two named alternatives. If both options',
          '  need names, that is a two-option radio group.',
          '- A group of radios with no `ChoiceGroup`, so nothing states the question.',
          '- Putting the question inside every option label.',
          '- Hiding a label with CSS rather than `labelHidden`, which loses the accessible',
          '  name too.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own which options exist, their wording, their order and what a choice',
          'means. They must not restyle the control or replace it with a styled `div`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** A single independent choice. */
export const Default = {};

/** A description adds detail without lengthening the accessible name. */
export const WithDescription = {
  args: {
    label: 'Send a confirmation message',
    description: 'The recipient is notified as soon as the record is saved.',
  },
};

/** Checked, required, invalid and disabled rows. */
export const States = {
  render: () => (
    <Stack gap="md">
      <Checkbox label="Unchecked" onChange={fn()} />
      <Checkbox label="Checked" defaultChecked onChange={fn()} />
      <Checkbox label="Required" required onChange={fn()} />
      <Checkbox label="Invalid" error="You must accept this to continue." onChange={fn()} />
      <Checkbox label="Disabled" disabled onChange={fn()} />
      <Checkbox label="Disabled and checked" disabled defaultChecked onChange={fn()} />
    </Stack>
  ),
};

/** Several independent options grouped under one question. */
export const CheckboxGroup = {
  render: () => (
    <div className="sb-measure">
      <ChoiceGroup
        legend="Which notifications should be sent?"
        description="Select every channel that applies. None is a valid answer."
      >
        <Checkbox label="Email" defaultChecked onChange={fn()} />
        <Checkbox label="Text message" onChange={fn()} />
        <Checkbox
          label="In-app notification"
          description="Only reaches users who have signed in during the last 30 days."
          onChange={fn()}
        />
      </ChoiceGroup>
    </div>
  ),
};

/**
 * A radio group. The required marker sits on the legend, and the browser's own
 * arrow-key model moves and selects within the group.
 */
export const RadioGroup = {
  render: () => (
    <div className="sb-measure">
      <ChoiceGroup legend="How should this record be delivered?" required>
        <Radio name="story-delivery" value="email" label="Email" required requiredMark={false} defaultChecked onChange={fn()} />
        <Radio name="story-delivery" value="link" label="Shareable link" required requiredMark={false} onChange={fn()} />
        <Radio
          name="story-delivery"
          value="download"
          label="Download only"
          description="Nothing is sent; the file is prepared for manual download."
          required
          requiredMark={false}
          onChange={fn()}
        />
      </ChoiceGroup>
    </div>
  ),
};

/** `orientation="horizontal"` suits two or three very short options. */
export const HorizontalGroup = {
  render: () => (
    <ChoiceGroup legend="Include archived records?" orientation="horizontal">
      <Radio name="story-archived" value="yes" label="Yes" onChange={fn()} />
      <Radio name="story-archived" value="no" label="No" defaultChecked onChange={fn()} />
    </ChoiceGroup>
  ),
};

/** A group-level error is announced once, not repeated on every option. */
export const GroupError = {
  render: () => (
    <div className="sb-measure">
      <ChoiceGroup
        legend="How should this record be delivered?"
        required
        error="Select a delivery method to continue."
      >
        <Radio name="story-delivery-error" value="email" label="Email" onChange={fn()} />
        <Radio name="story-delivery-error" value="link" label="Shareable link" onChange={fn()} />
      </ChoiceGroup>
    </div>
  ),
};

/**
 * `labelHidden` — the matrix case. Row and column headers carry the meaning for
 * sighted users, so printing the full name in every cell would be unusable; the
 * accessible name is still there and still unique.
 */
export const HiddenLabelMatrix = {
  render: () => (
    <table style={{ borderCollapse: 'collapse' }}>
      <caption className="sb-specimen__label" style={{ textAlign: 'left', paddingBottom: 'var(--ds-space-2)' }}>
        Permissions matrix
      </caption>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left', padding: 'var(--ds-space-2)' }}>Group</th>
          <th scope="col" style={{ padding: 'var(--ds-space-2)' }}>View</th>
          <th scope="col" style={{ padding: 'var(--ds-space-2)' }}>Edit</th>
        </tr>
      </thead>
      <tbody>
        {['Group A', 'Group B'].map((group) => (
          <tr key={group}>
            <th scope="row" style={{ textAlign: 'left', padding: 'var(--ds-space-2)', fontWeight: 400 }}>
              {group}
            </th>
            {['View', 'Edit'].map((permission) => (
              <td key={permission} style={{ padding: 'var(--ds-space-2)', textAlign: 'center' }}>
                <Checkbox label={`${permission} for ${group}`} labelHidden onChange={fn()} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

/** Long labels and descriptions wrap under the control, never beside it. */
export const LongContent = {
  render: () => (
    <div className="sb-measure">
      <ChoiceGroup
        legend="Consent"
        description="Long consent wording must stay fully readable — it is never truncated."
      >
        <Checkbox
          label="I confirm that the information provided in this record is accurate and complete to the best of my knowledge, and that it may be verified with the organisations listed."
          description="This confirmation is stored with the record together with the date it was given."
          required
          onChange={fn()}
        />
      </ChoiceGroup>
    </div>
  ),
};

/**
 * Keyboard behaviour. Tab reaches the group and lands on the selected radio;
 * arrow keys then move *and* select within it; Tab leaves the whole group.
 */
export const KeyboardFocus = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <p className="sb-note">
        <kbd>Tab</kbd> into the group, then use <kbd>↑</kbd>/<kbd>↓</kbd> to move between
        radios — selection follows focus, which is the native model. <kbd>Tab</kbd> again
        leaves the group entirely rather than stepping through every option. Also check the
        44px touch targets at this width.
      </p>
      <ChoiceGroup legend="Delivery method">
        <Radio name="story-keyboard" value="email" label="Email" defaultChecked onChange={fn()} />
        <Radio name="story-keyboard" value="link" label="Shareable link" onChange={fn()} />
        <Radio name="story-keyboard" value="download" label="Download only" onChange={fn()} />
      </ChoiceGroup>
      <Checkbox label="Also archive the record" onChange={fn()} />
    </Stack>
  ),
};
