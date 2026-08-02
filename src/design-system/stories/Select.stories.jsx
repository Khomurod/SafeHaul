import React from 'react';
import { fn } from 'storybook/test';
import { FormField, Select } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `Select` is the approved single-choice control for a known, closed list of
 * options. It is a real native `<select>`.
 */
const meta = {
  title: 'Components/Select',
  component: Select,
  args: { onChange: fn() },
  argTypes: {
    disabled: { control: 'boolean' },
    required: { control: 'boolean' },
    multiple: { control: 'boolean' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Proven by the public driver application and the driver',
          'dossier. The wider form-family roadmap item stays open while unmigrated raw',
          'selects remain elsewhere.',
          '',
          '### Intended use',
          '',
          'One choice from a short, stable, closed list — roughly 3 to 15 options. Fewer than',
          'three visible options is usually a `Radio` group; a list long enough to need typing',
          'is a search field.',
          '',
          '### Why a native `<select>`',
          '',
          'The browser already provides the correct keyboard model (type-ahead, arrow keys,',
          'Home/End), the mobile platform picker, and form autofill. A `div`-based listbox',
          'loses all three and has to reimplement them correctly — which is exactly where',
          'custom selects usually fail.',
          '',
          '### Accessibility expectations',
          '',
          '- Wrap in `FormField` for the label, description, error and ARIA wiring, the same',
          '  as `Input`.',
          '- If there is no sensible default, provide an explicit empty first option with',
          '  real words (`<option value="">Select an option</option>`). A blank first entry',
          '  is announced as nothing at all.',
          '- Do not use a disabled placeholder option as the label.',
          '- Use `<optgroup>` when the list has genuine categories; it is announced.',
          '',
          '### Common mistakes',
          '',
          '- A `Select` with two options where a `ChoiceGroup` of radios would show both',
          '  choices without a click.',
          '- Very long option lists (every country, every carrier) with no way to type. There',
          '  is **no approved Combobox/Listbox primitive yet** — the FMCSA employer combobox',
          '  is a recorded feature-owned exception, not a pattern to copy.',
          '- `multiple` on a native select: it is nearly undiscoverable and unusable on touch.',
          '  Use a checkbox group instead.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the option list, their order, their labels and the saved values. They',
          'must not restyle the control or replace it with a custom dropdown without a',
          'recorded roadmap decision.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default control, labelled by a `FormField`. */
export const Default = {
  render: (args) => (
    <div className="sb-measure">
      <FormField label="Status">
        <Select {...args}>
          <option value="">Select a status</option>
          <option value="draft">Draft</option>
          <option value="in-review">In review</option>
          <option value="complete">Complete</option>
          <option value="archived">Archived</option>
        </Select>
      </FormField>
    </div>
  ),
};

/** Categories become `<optgroup>`s, which assistive technology announces. */
export const WithOptionGroups = {
  render: (args) => (
    <div className="sb-measure">
      <FormField label="Document type" description="Grouped by where the document originates.">
        <Select {...args}>
          <option value="">Select a document type</option>
          <optgroup label="Generated">
            <option value="summary">Summary report</option>
            <option value="certificate">Certificate</option>
          </optgroup>
          <optgroup label="Uploaded">
            <option value="scan">Scanned document</option>
            <option value="photo">Photograph</option>
            <option value="other">Other attachment</option>
          </optgroup>
        </Select>
      </FormField>
    </div>
  ),
};

/** Required, invalid and disabled states. */
export const States = {
  render: (args) => (
    <div className="sb-measure">
      <Stack gap="md">
        <FormField label="Required" required>
          <Select {...args}>
            <option value="">Select an option</option>
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </Select>
        </FormField>
        <FormField label="Invalid" required error="Select an option to continue.">
          <Select {...args} defaultValue="">
            <option value="">Select an option</option>
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </Select>
        </FormField>
        <FormField label="Disabled" description="Disabled because the record is locked.">
          <Select {...args} disabled defaultValue="a">
            <option value="a">Option A</option>
          </Select>
        </FormField>
      </Stack>
    </div>
  ),
};

/**
 * Long option text. The closed control truncates to its width — which is why an
 * option label should be scannable, with the detail in a description instead.
 */
export const LongOptionText = {
  render: (args) => (
    <div className="sb-measure">
      <FormField
        label="Retention policy"
        description="Long option labels truncate in the closed control. Keep the distinguishing words first."
      >
        <Select {...args} defaultValue="long">
          <option value="short">Standard retention</option>
          <option value="long">
            Extended retention for records subject to a secondary review requirement lasting
            three years from the date of completion
          </option>
        </Select>
      </FormField>
    </div>
  ),
};

/** Mobile width: the native platform picker, at a touch-sized target. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: (args) => (
    <Stack gap="md">
      <FormField label="Status" required>
        <Select {...args}>
          <option value="">Select a status</option>
          <option value="draft">Draft</option>
          <option value="in-review">In review</option>
          <option value="complete">Complete</option>
        </Select>
      </FormField>
      <FormField label="Region" error="Select a region to continue.">
        <Select {...args} defaultValue="">
          <option value="">Select a region</option>
          <option value="north">North</option>
          <option value="south">South</option>
        </Select>
      </FormField>
    </Stack>
  ),
};
