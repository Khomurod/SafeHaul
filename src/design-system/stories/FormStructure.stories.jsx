import React from 'react';
import { fn } from 'storybook/test';
import {
  Badge,
  Button,
  Checkbox,
  FieldDisplay,
  FieldMessage,
  FormField,
  FormSection,
  Input,
  Label,
  Select,
  Textarea,
} from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

/**
 * The form structure primitives — `FormSection`, `FormField`, `Label`,
 * `FieldMessage` and `FieldDisplay`. They own the anatomy of a form; the
 * controls themselves are documented under Input, Select, Textarea and Checkbox.
 */
const meta = {
  title: 'Components/Form structure',
  component: FormField,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Proven by the Company Settings personal profile, billing,',
          'automated-message and email-settings forms, by Login, and by the public driver',
          'application.',
          '',
          '### The primitives',
          '',
          '| Primitive | Owns |',
          '| --- | --- |',
          '| `FormSection` | A titled `Card` grouping related fields, with an optional description and action slot. |',
          '| `FormField` | Label, description, error, and all of the ARIA wiring for exactly one control. |',
          '| `Label` | A standalone `<label>` with the required marker. Rarely needed directly. |',
          '| `FieldMessage` | A help, error or success message. Tones: `help`, `error`, `success`. |',
          '| `FieldDisplay` | A read-only label/value pair, for data that is shown but not edited. |',
          '',
          '### What `FormField` does for you',
          '',
          'It clones its single child control and wires up:',
          '',
          '- a generated `id` and a matching `htmlFor`, so clicking the label focuses the control;',
          '- `aria-required` when `required`;',
          '- `aria-invalid` when `error` is set;',
          '- `aria-describedby` joining the description **and** the error, without clobbering',
          '  any `aria-describedby` the child already had.',
          '',
          'It **throws** on a missing label or a child that is not a single valid element.',
          'That is deliberate: those two mistakes produce an unlabelled field, which is the',
          'defect the primitive exists to prevent.',
          '',
          '### Accessibility expectations',
          '',
          '- One control per `FormField`. Two controls in one field cannot share one label.',
          '- The error is a `role="alert"`, so it is announced when it appears — not only',
          '  when the user happens to move focus back to the field.',
          '- The required marker is decorative (`aria-hidden`) and is paired with a',
          '  screen-reader-only " required", so the asterisk is never announced as "star".',
          '- Descriptions stay visible while typing. A placeholder does not.',
          '- `FormSection` renders its title as an `h2` and labels the card with it. If a',
          '  section sits under another heading level, check the resulting outline.',
          '',
          '### Common mistakes',
          '',
          '- Rendering a `<label>` and a control by hand instead of using `FormField`, then',
          '  forgetting `htmlFor`.',
          '- Reusing one hard-coded `id` for a field rendered more than once on a page, which',
          '  silently breaks every label association after the first.',
          '- Showing an error with `FieldMessage tone="error"` **outside** a `FormField`, so',
          '  `aria-invalid` and `aria-describedby` are never set on the control.',
          '- Using `FieldDisplay` for something the user is expected to edit.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own field names, order, validation rules, messages and payload shapes.',
          'They must not restyle the field anatomy or invent their own error treatment.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** A single labelled and described field. */
export const Default = {
  render: () => (
    <div className="sb-measure">
      <FormField label="Reference" description="Shown on every generated document.">
        <Input onChange={fn()} />
      </FormField>
    </div>
  ),
};

/** A complete section: title, description, an action slot, and its fields. */
export const Section = {
  render: () => (
    <div className="sb-measure">
      <FormSection
        title="Contact details"
        description="Used when a record needs a response from its owner."
        actions={<Button variant="ghost" onClick={fn()}>Reset</Button>}
      >
        <Stack gap="md">
          <FormField label="Contact name" required>
            <Input autoComplete="name" onChange={fn()} />
          </FormField>
          <FormField label="Email address" required description="Confirmations are sent here.">
            <Input type="email" autoComplete="email" onChange={fn()} />
          </FormField>
          <FormField label="Region">
            <Select onChange={fn()}>
              <option value="">Select a region</option>
              <option value="north">North</option>
              <option value="south">South</option>
            </Select>
          </FormField>
          <Checkbox label="Send a copy to the record owner" onChange={fn()} />
        </Stack>
      </FormSection>
    </div>
  ),
};

/** The three `FieldMessage` tones. */
export const FieldMessages = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <FieldMessage tone="help">Help — guidance that stays visible while typing.</FieldMessage>
        <FieldMessage tone="error">Error — announced as an alert when it appears.</FieldMessage>
        <FieldMessage tone="success">Success — confirmation that a value was accepted.</FieldMessage>
      </Stack>
    </div>
  ),
};

/** `FieldDisplay` shows data that is read-only by nature. */
export const ReadOnlyValues = {
  render: () => (
    <div className="sb-measure">
      <FormSection title="Record summary" description="These values are set when the record is created.">
        <Stack gap="md">
          <FieldDisplay label="Reference">REC-000102</FieldDisplay>
          <FieldDisplay label="Created">11 March 2026</FieldDisplay>
          <FieldDisplay label="Owner" emphasis="strong">M. Delacroix-Whitfield</FieldDisplay>
          <FieldDisplay label="Region">Not provided</FieldDisplay>
        </Stack>
      </FormSection>
    </div>
  ),
};

/** A standalone `Label` with the required marker. */
export const StandaloneLabel = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="sm">
        <Label htmlFor="story-standalone-input" required>Reference</Label>
        <Input id="story-standalone-input" onChange={fn()} />
        <FieldMessage tone="help">
          Prefer <code>FormField</code>. Use a standalone <code>Label</code> only where the
          field anatomy genuinely differs.
        </FieldMessage>
      </Stack>
    </div>
  ),
};

/** A form showing every field state at once. */
export const AllFieldStates = {
  render: () => (
    <div className="sb-measure">
      <FormSection title="Field states">
        <Stack gap="md">
          <FormField label="Default"><Input onChange={fn()} /></FormField>
          <FormField label="Required" required><Input onChange={fn()} /></FormField>
          <FormField label="With description" description="Guidance shown under the control.">
            <Input onChange={fn()} />
          </FormField>
          <FormField label="Invalid" required error="Enter a value to continue.">
            <Input onChange={fn()} />
          </FormField>
          <FormField label="Disabled" description="Disabled because the record is locked.">
            <Input disabled onChange={fn()} />
          </FormField>
          <FormField label="Notes"><Textarea rows={3} onChange={fn()} /></FormField>
        </Stack>
      </FormSection>
    </div>
  ),
};

/** A section reporting a save failure, with the submit row beneath it. */
export const SubmissionError = {
  render: () => (
    <div className="sb-measure">
      <FormSection title="Contact details">
        <Stack gap="md">
          <FormField label="Contact name" required error="Enter a contact name.">
            <Input onChange={fn()} />
          </FormField>
          <FormField
            label="Email address"
            required
            error="This address could not be delivered to. Check it and try again."
          >
            <Input type="email" defaultValue="name@" onChange={fn()} />
          </FormField>
          <FieldMessage tone="error">
            The section could not be saved. Fix the two fields above and try again.
          </FieldMessage>
          <Inline gap="sm">
            <Button variant="primary" onClick={fn()}>Save changes</Button>
            <Button variant="secondary" onClick={fn()}>Cancel</Button>
          </Inline>
        </Stack>
      </FormSection>
    </div>
  ),
};

/** Long labels, descriptions and errors all wrap; nothing is truncated. */
export const LongContent = {
  render: () => (
    <div className="sb-measure">
      <FormSection
        title="Details about the organisation responsible for maintaining this record"
        description="A section description can run to several lines when the rules it explains genuinely need them; it wraps rather than truncating."
      >
        <FormField
          label="Name of the organisation currently responsible for this record"
          description="If responsibility has changed since the record was created, enter the organisation that holds it today rather than the one that created it."
          error="This organisation could not be matched to a known entry. Check the spelling, or continue and it will be created as a new entry when the record is saved."
          required
        >
          <Input onChange={fn()} />
        </FormField>
      </FormSection>
    </div>
  ),
};

/** Mobile width: labels above controls, actions stacked full-width. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <FormSection title="Contact details" actions={<Badge tone="info">Draft</Badge>}>
      <Stack gap="md">
        <FormField label="Contact name" required><Input onChange={fn()} /></FormField>
        <FormField label="Email address" required error="Enter a valid email address.">
          <Input type="email" defaultValue="name@" onChange={fn()} />
        </FormField>
        <Button variant="primary" fullWidth onClick={fn()}>Save changes</Button>
      </Stack>
    </FormSection>
  ),
};
