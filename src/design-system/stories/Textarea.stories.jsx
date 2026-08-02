import React from 'react';
import { fn } from 'storybook/test';
import { FormField, Textarea } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `Textarea` is the approved multi-line text control — a native `<textarea>`
 * sharing the same control styling, focus ring and invalid treatment as `Input`.
 */
const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  args: { rows: 4, onChange: fn() },
  argTypes: {
    rows: { control: { type: 'number', min: 2, max: 20 } },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    required: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Proven by the Company Settings automated-message templates',
          'and email settings forms, and by the public driver application.',
          '',
          '### Intended use',
          '',
          'Free-form text longer than one line: notes, message templates, descriptions. If',
          'the value is always short and single-line, use `Input` — a textarea invites more',
          'text than the field can handle.',
          '',
          '### Supported variants',
          '',
          'No visual variants. Size the field with `rows` to signal how much text is expected:',
          'roughly 3 for a note, 6–10 for a template. The user can still resize it.',
          '',
          '### Accessibility expectations',
          '',
          '- Wrap in `FormField` for the label, description, error and ARIA wiring.',
          '- If there is a length limit, say so in the description **and** enforce it with',
          '  `maxLength`. A silent truncation on save loses the user\'s work.',
          '- Do not remove the native resize handle; some users need a much larger editing',
          '  area than the default.',
          '- <kbd>Tab</kbd> must move to the next control, not insert a tab character.',
          '  The native element already behaves this way — do not override it.',
          '',
          '### Common mistakes',
          '',
          '- A single-row textarea used as a fancy text input.',
          '- A fixed height too small for the expected content, so the user edits through a',
          '  two-line window.',
          '- Placeholder text used to explain placeholder syntax or formatting rules; that',
          '  belongs in the field description, where it stays visible while typing.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the content, the template placeholder vocabulary and the length',
          'rules. They must not restyle the control or replace it with a rich-text editor —',
          'there is no approved rich-text primitive.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: four rows, labelled by a `FormField`. */
export const Default = {
  render: (args) => (
    <div className="sb-measure">
      <FormField label="Notes">
        <Textarea {...args} placeholder="Add a note" />
      </FormField>
    </div>
  ),
};

/** `rows` sets the expected amount of text. */
export const Sizes = {
  render: (args) => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField label="Short note (rows=3)">
          <Textarea {...args} rows={3} />
        </FormField>
        <FormField label="Message template (rows=8)" description="Long-form content gets a taller field.">
          <Textarea {...args} rows={8} />
        </FormField>
      </Stack>
    </div>
  ),
};

/** Required, invalid, disabled and read-only. */
export const States = {
  render: (args) => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField label="Required" required>
          <Textarea {...args} rows={3} />
        </FormField>
        <FormField label="Invalid" required error="Enter at least 20 characters.">
          <Textarea {...args} rows={3} defaultValue="Too short" />
        </FormField>
        <FormField label="Disabled" description="Disabled because the record is locked.">
          <Textarea {...args} rows={3} disabled defaultValue="Locked content" />
        </FormField>
        <FormField label="Read-only" description="Read-only keeps the text selectable and copyable.">
          <Textarea {...args} rows={3} readOnly defaultValue="This content cannot be edited here." />
        </FormField>
      </Stack>
    </div>
  ),
};

/** A length limit, stated in the description and enforced by `maxLength`. */
export const WithLengthLimit = {
  render: (args) => (
    <div className="sb-measure">
      <FormField
        label="Summary"
        description="Maximum 160 characters. The limit is enforced by the control, not only on save."
      >
        <Textarea {...args} rows={3} maxLength={160} />
      </FormField>
    </div>
  ),
};

/**
 * Long content. The field scrolls internally at its configured height; it never
 * grows without bound and pushes the rest of the form off-screen.
 */
export const LongContent = {
  render: (args) => (
    <div className="sb-measure">
      <FormField
        label="Description"
        description="The field scrolls at its configured height rather than growing without limit."
      >
        <Textarea
          {...args}
          rows={4}
          defaultValue={[
            'This value is deliberately long enough to overflow the configured height of the',
            'control so the internal scrolling behaviour can be reviewed.',
            '',
            'It also contains a hard line break and a second paragraph, because multi-line',
            'content is the entire reason this control exists, and wrapping plus explicit',
            'newlines have to render correctly together.',
            '',
            'Finally it contains an unbroken token — REC000000000000000000000000000000042 —',
            'to confirm that a long word wraps inside the control instead of forcing it to',
            'scroll sideways.',
          ].join('\n')}
        />
      </FormField>
    </div>
  ),
};

/** Mobile width: full-width control, comfortable typing target. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: (args) => (
    <Stack gap="md">
      <FormField label="Notes" description="Keep the field tall enough to type into on a phone.">
        <Textarea {...args} rows={5} />
      </FormField>
      <FormField label="Reason" required error="Enter a reason before continuing.">
        <Textarea {...args} rows={3} />
      </FormField>
    </Stack>
  ),
};
