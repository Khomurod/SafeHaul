import React from 'react';
import { fn } from 'storybook/test';
import { Button, Card, FileInput } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/FileInput',
  component: FileInput,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21, closing the gap that kept four upload',
          'controls feature-owned.',
          '',
          '### The one structural rule',
          '',
          'A **real `<input type="file">`**, visually hidden but still focusable, with a',
          '`<label>` styled as the visible control.',
          '',
          'Not `display: none` — that removes the input from the tab order and takes the',
          'keyboard path to the picker with it, which is exactly what two of the four',
          'hand-built controls did. Not a `<button>` calling `.click()` on a hidden input,',
          'which works with a mouse and leaves the accessible name on the wrong element.',
          '',
          'With a real input and a real label: Tab reaches it, Space and Enter open the',
          'picker, the label is its accessible name, and the browser\'s own file-type',
          'filtering and drag-and-drop target come for free.',
          '',
          '### It is a picker, not an uploader',
          '',
          'Progress, retry, preview, size limits and the upload itself stay with the feature.',
          'The public application\'s upload field composes exactly this and owns all of that',
          'around it.',
          '',
          '### Accessibility',
          '',
          '- `label` is required and names what is being uploaded.',
          '- `description` becomes `aria-describedby`, so a screen-reader user hears the',
          '  accepted types **before** opening the picker rather than discovering them from a',
          '  rejection afterwards.',
          '- The focus ring is drawn on the label through `:focus-within`, because the input',
          '  itself is clipped.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

export const Default = {
  render: () => (
    <Card>
      <FileInput label="Supporting document" onChange={fn()} />
    </Card>
  ),
};

/** With the constraint announced up front. */
export const WithDescription = {
  render: () => (
    <Card>
      <FileInput
        label="Supporting document"
        description="PDF or JPEG, up to 10 MB."
        accept="application/pdf,image/jpeg"
        buttonLabel="Choose a file"
        onChange={fn()}
      />
    </Card>
  ),
};

/** Several files at once. */
export const Multiple = {
  render: () => (
    <Card>
      <FileInput label="Attachments" description="Select one or more files." multiple onChange={fn()} />
    </Card>
  ),
};

/** Disabled: the label dims with the control, not separately. */
export const Disabled = {
  render: () => (
    <Card>
      <FileInput label="Supporting document" description="Unavailable until the record is saved." disabled onChange={fn()} />
    </Card>
  ),
};

/** Beside a Button — same control height, because both read the same scale. */
export const BesideAButton = {
  render: () => (
    <Card>
      <Stack gap="md">
        <FileInput label="Supporting document" onChange={fn()} />
        <Inline gap="sm">
          <Button variant="primary">Save</Button>
          <Button variant="secondary">Cancel</Button>
        </Inline>
      </Stack>
    </Card>
  ),
};

export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Card>
      <FileInput label="Supporting document" description="PDF or JPEG, up to 10 MB." onChange={fn()} />
    </Card>
  ),
};
