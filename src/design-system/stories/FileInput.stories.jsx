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
          'controls feature-owned. Extended on 2026-08-25 to the three shapes the product',
          'actually has — see below. Nine raw file inputs are migrated onto it.',
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
          'filtering come for free; dropped files are handled explicitly by `onDrop`.',
          '',
          '### It is a picker, not an uploader',
          '',
          'Progress, retry, preview, size limits and the upload itself stay with the feature.',
          'The public application\'s upload field composes exactly this and owns all of that',
          'around it.',
          '',
          '### Three shapes',
          '',
          '| Prop | For |',
          '| --- | --- |',
          '| default | A picker beside other controls. A settings field, a per-row upload |',
          '| `variant="dropzone"` | The full-width dashed panel four uploads use. As a `<label>` the whole panel is the click target, and `onDrop` accepts a file dropped anywhere on it — a label forwards a click to its control but never a drop, so the handler is what makes the dashed border honest |',
          '| `loading` | An upload in flight. Spins, says so with `aria-busy`, and refuses a second file — which is why the two avatar pickers used `Button loading` plus a hidden input before this existed |',
          '| `labelHidden` | A picker whose field is already named on screen, such as a photo preview beside it. Same prop, same meaning, as `Checkbox` |',
          '',
          'Four days after this component shipped it had two consumers and nine raw',
          '`<input type="file">` controls were still in the tree, each under a comment saying',
          'no file-input contract existed. Migrating them is what showed why: the contract',
          'existed and its API covered one of three shapes. **A primitive that fits a third',
          'of its call sites does not get adopted.**',
          '',
          '### Accessibility',
          '',
          '- `label` is required and names what is being uploaded.',
          '- A caller\'s `aria-describedby` is **added** to the component\'s own, not replaced',
          '  by it. It used to sit after the prop spread, so a caller\'s help-text id was',
          '  silently dropped — found by migrating the profile-photo picker, whose "Accepts',
          '  image files under 2 MB" stopped being announced while everything still looked',
          '  right.',
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

/**
 * `variant="dropzone"` — the full-width dashed panel. Four uploads had built this
 * by hand; as a `<label>` the whole panel is also the browser's own
 * drag-and-drop target for the input it names.
 */
export const Dropzone = {
  render: () => (
    <Card>
      <FileInput
        label="Recipient list"
        variant="dropzone"
        buttonLabel="Click to upload a file"
        description="CSV, XLS or XLSX files"
        accept=".csv,.xlsx,.xls"
        onChange={fn()}
      />
    </Card>
  ),
};

/** `loading` — an upload in flight. It says so, and refuses a second file. */
export const Loading = {
  render: () => (
    <Card>
      <Stack>
        <FileInput label="Profile photo" buttonLabel="Uploading…" loading onChange={fn()} />
        <FileInput
          label="Company logo"
          variant="dropzone"
          buttonLabel="Uploading…"
          description="PNG, JPG or SVG"
          loading
          onChange={fn()}
        />
      </Stack>
    </Card>
  ),
};

/** `labelHidden` — the field is already named on screen by what sits beside it. */
export const LabelHidden = {
  render: () => (
    <Card>
      <Inline gap="md">
        <span
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--ds-radius-full)',
            background: 'var(--ds-color-surface-subtle)',
            border: '1px solid var(--ds-color-border)',
          }}
        />
        <FileInput label="Profile photo" labelHidden buttonLabel="Change photo" onChange={fn()} />
      </Inline>
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
