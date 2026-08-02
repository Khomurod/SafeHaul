import React from 'react';
import { fn } from 'storybook/test';
import { FormField, Input } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `Input` is the approved single-line text control. It is a thin, native
 * `<input>` wearing the design system's control styling.
 */
const meta = {
  title: 'Components/Input',
  component: Input,
  args: { placeholder: 'Enter a value', onChange: fn() },
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'tel', 'number', 'date', 'password', 'search', 'url'],
    },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    required: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** The primitive is proven by the public driver application,',
          'Login and several Company Settings forms. The roadmap keeps the wider *form',
          'family* item open because unmigrated raw inputs still exist elsewhere.',
          '',
          '### Intended use',
          '',
          'Any single-line value. Because it is a real `<input>`, every native prop works:',
          '`type`, `inputMode`, `autoComplete`, `pattern`, `maxLength`, `readOnly`.',
          '',
          '### Supported variants',
          '',
          'There are no visual variants by design — one control appearance, one focus ring,',
          'one invalid treatment. What changes is the *native type* and whether the field is',
          'disabled, read-only or invalid.',
          '',
          '### Accessibility expectations',
          '',
          '- **`Input` has no label of its own.** Almost always wrap it in a `FormField`,',
          '  which owns the `<label>`, the description, the error text and the',
          '  `aria-describedby` / `aria-invalid` wiring. A bare `Input` with only a',
          '  `placeholder` is unlabelled.',
          '- A placeholder is not a label: it disappears on the first keystroke and fails',
          '  contrast in most browsers.',
          '- `FormField` sets `aria-invalid` and links the error message, and the error is a',
          '  `role="alert"` so it is announced when it appears.',
          '- Set `autoComplete` and `inputMode` for real-world fields — that is what makes a',
          '  form usable one-handed on a phone.',
          '',
          '### Common mistakes',
          '',
          '- Using `placeholder` instead of a label.',
          '- Communicating an error with a red border only, and no message.',
          '- `type="number"` for values that are not quantities (identifiers, phone numbers,',
          '  postal codes) — it adds spinners and silently drops leading zeros. Use',
          '  `inputMode="numeric"` on a `type="text"` field instead.',
          '- Using `disabled` for a field the user must eventually complete; `readOnly` keeps',
          '  the value focusable and copyable.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own field names, validation rules, messages and saved payloads. They must',
          'not restyle the control. There is still **no approved file-input contract** — file',
          'uploads remain a documented feature-owned exception in the roadmap.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** A bare control. In real screens this is always wrapped in a `FormField`. */
export const Default = {};

/** The realistic usage: labelled, described and wired up by `FormField`. */
export const WithFormField = {
  render: () => (
    <div className="sb-measure">
      <FormField
        label="Reference number"
        description="Shown on every document generated from this record."
      >
        <Input placeholder="REC-000000" onChange={fn()} />
      </FormField>
    </div>
  ),
};

/** Native input types keep one appearance and one focus treatment. */
export const Types = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField label="Full name">
          <Input autoComplete="name" onChange={fn()} />
        </FormField>
        <FormField label="Email address">
          <Input type="email" autoComplete="email" placeholder="name@example.com" onChange={fn()} />
        </FormField>
        <FormField label="Phone number" description="Digits only; formatting is applied on save.">
          <Input type="tel" inputMode="tel" autoComplete="tel" onChange={fn()} />
        </FormField>
        <FormField label="Effective date">
          <Input type="date" onChange={fn()} />
        </FormField>
        <FormField label="Quantity">
          <Input type="number" min={0} onChange={fn()} />
        </FormField>
      </Stack>
    </div>
  ),
};

/** Required, invalid, disabled and read-only, side by side for comparison. */
export const States = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField label="Required field" required>
          <Input onChange={fn()} />
        </FormField>
        <FormField
          label="Invalid field"
          required
          error="Enter a value in the format REC-000000."
        >
          <Input defaultValue="not-a-reference" onChange={fn()} />
        </FormField>
        <FormField
          label="Disabled field"
          description="Disabled because the record is locked."
        >
          <Input disabled defaultValue="Locked value" onChange={fn()} />
        </FormField>
        <FormField
          label="Read-only field"
          description="Read-only keeps the value focusable and copyable."
        >
          <Input readOnly defaultValue="REC-000042" onChange={fn()} />
        </FormField>
      </Stack>
    </div>
  ),
};

/**
 * The error state on its own. The message is a live region, so it is announced
 * when it appears rather than only being visible.
 */
export const Error = {
  render: () => (
    <div className="sb-measure">
      <FormField
        label="Email address"
        required
        error="Enter a valid email address, for example name@example.com."
      >
        <Input type="email" defaultValue="name@" onChange={fn()} />
      </FormField>
    </div>
  ),
};

/**
 * Long content. Labels, descriptions and error messages wrap; the value itself
 * scrolls inside the control rather than stretching the layout.
 */
export const LongContent = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField
          label="Name of the organisation responsible for maintaining this record"
          description="If the responsible organisation has changed since the record was created, enter the organisation that holds it today, not the one that created it."
          error="This organisation could not be matched to a known entry. Check the spelling, or continue and it will be created as a new entry when the record is saved."
        >
          <Input
            defaultValue="An extremely long single-line value that keeps going well past the width of the control to prove it scrolls instead of stretching the form"
            onChange={fn()}
          />
        </FormField>
      </Stack>
    </div>
  ),
};

/** Mobile width. Controls remain full-width and keep a touch-sized target. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <FormField label="Full name">
        <Input autoComplete="name" onChange={fn()} />
      </FormField>
      <FormField label="Email address" required error="Enter a valid email address.">
        <Input type="email" defaultValue="name@" onChange={fn()} />
      </FormField>
    </Stack>
  ),
};

/**
 * Keyboard focus. Tab through the fields and confirm the focus ring is visible
 * on the default, invalid and read-only controls alike.
 */
export const KeyboardFocus = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <p className="sb-note">
          Press <kbd>Tab</kbd> to move between fields. The disabled field is correctly skipped;
          the read-only one is not, because its value must still be reachable and copyable.
        </p>
        <FormField label="Default"><Input onChange={fn()} /></FormField>
        <FormField label="Invalid" error="Enter a value."><Input onChange={fn()} /></FormField>
        <FormField label="Read-only"><Input readOnly defaultValue="REC-000042" onChange={fn()} /></FormField>
        <FormField label="Disabled"><Input disabled onChange={fn()} /></FormField>
      </Stack>
    </div>
  ),
};
