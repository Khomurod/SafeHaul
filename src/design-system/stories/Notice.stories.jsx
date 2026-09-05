import React from 'react';
import { Button, Notice } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/Notice',
  component: Notice,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-09-05.',
          '',
          'A tinted, bordered block carrying a short message — the single most',
          'copy-pasted shape in the application. The audit that preceded it found',
          '**66 hand-built ones across 52 files**, every one using correct `--ds-*`',
          'roles, which is why no colour rule ever saw them. This is composition drift.',
          '',
          '### What it is not',
          '',
          'Six tinted blocks in the tree hold form controls rather than a message.',
          'Those are highlighted *regions*, and `Notice` is the wrong answer for every',
          'one. `FieldMessage` owns a message about one form field; `PageState` owns a',
          'whole empty or failed slot. This owns the block between them.',
          '',
          '### `announce` defaults to off, and that is a measurement',
          '',
          'Only 26 of the 64 notices in the tree announce themselves; 38 are silent.',
          'Announcing by default would turn those 38 into interruptions, and most',
          'describe something already visible beside them. `polite` renders',
          '`role="status"`, `assertive` renders `role="alert"`.',
          '',
          '### The icon is decorative',
          '',
          'The glyph is `aria-hidden`, so the sentence is heard once rather than',
          '"warning icon, warning:". Each tone has a default chosen from what the',
          'application already reaches for. `null` hides it; `undefined` takes the',
          'tone-s own.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** Every tone, at the default size. */
export const Tones = {
  render: () => (
    <Stack gap="md" style={{ maxWidth: 560 }}>
      <Notice tone="info">Two of these steps are still outstanding.</Notice>
      <Notice tone="success">Everything was saved.</Notice>
      <Notice tone="warning">This will be visible to everyone in the workspace.</Notice>
      <Notice tone="danger">The message could not be delivered.</Notice>
      <Notice tone="neutral">Nothing has been scheduled yet.</Notice>
      <Notice tone="accent">A suggestion is ready for review.</Notice>
    </Stack>
  ),
};

/** The majority shape: a title with a body under it — 27 of the 64 audited. */
export const WithTitle = {
  render: () => (
    <Stack gap="md" style={{ maxWidth: 560 }}>
      <Notice tone="warning" title="Two items need attention">
        They were left incomplete when the form was last saved, and both are
        required before it can be finished.
      </Notice>
      <Notice tone="danger" title="Could not reach the mail server">
        The address and port look right, so this is most likely the password.
      </Notice>
    </Stack>
  ),
};

/** Nine consumers carry a button. Below 640px it drops under the message. */
export const WithActions = {
  render: () => (
    <Stack gap="md" style={{ maxWidth: 560 }}>
      <Notice
        tone="danger"
        title="Upload failed"
        actions={<Button size="sm" variant="secondary">Retry</Button>}
      >
        The file was larger than the twenty megabyte limit.
      </Notice>
      <Notice tone="info" actions={<Button size="sm" variant="secondary">Review</Button>}>
        Three entries were changed since you last looked.
      </Notice>
    </Stack>
  ),
};

/** `size="sm"` for a notice inside a panel that is already tight. */
export const Compact = {
  render: () => (
    <Stack gap="sm" style={{ maxWidth: 420 }}>
      <Notice tone="info" size="sm">Saved automatically a moment ago.</Notice>
      <Notice tone="warning" size="sm" title="Nearly full">
        Ninety per cent of the allowance is used.
      </Notice>
    </Stack>
  ),
};

/** Without a glyph — the 27 sites that carry none today look like this. */
export const WithoutIcon = {
  render: () => (
    <Stack gap="md" style={{ maxWidth: 560 }}>
      <Notice tone="info" icon={null}>No glyph, by explicit request.</Notice>
      <Notice tone="info">The same notice with the tone-s own glyph, for comparison.</Notice>
    </Stack>
  ),
};

export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <Notice tone="danger" title="Could not send" actions={<Button size="sm" variant="secondary">Retry</Button>}>
        The connection closed before the message was accepted.
      </Notice>
      <Notice tone="success" size="sm">Saved.</Notice>
    </Stack>
  ),
};
