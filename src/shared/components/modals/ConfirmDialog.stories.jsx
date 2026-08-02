import React, { useState } from 'react';
import { Button, FieldDisplay } from '@design-system/components';
import { Stack } from '@design-system/layouts';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * `ConfirmDialog` renders nothing when `isOpen` is false, so each story owns a
 * trigger and can be reopened after cancelling.
 */
function ConfirmHarness({ startOpen = true, triggerLabel = 'Open confirmation', ...props }) {
    const [open, setOpen] = useState(startOpen);
    return (
        <>
            <Button variant="danger" onClick={() => setOpen(true)}>{triggerLabel}</Button>
            <ConfirmDialog
                {...props}
                isOpen={open}
                onCancel={() => setOpen(false)}
                onConfirm={props.onConfirm ?? (() => setOpen(false))}
            />
        </>
    );
}

/**
 * `ConfirmDialog` is the single approved confirmation. Every confirmation in
 * SafeHaul goes through it.
 */
const meta = {
    title: 'Components/ConfirmDialog',
    component: ConfirmDialog,
    args: {
        title: 'Delete this record?',
        description: 'This cannot be undone. The record and its attachments will be removed.',
        confirmLabel: 'Delete record',
        cancelLabel: 'Cancel',
        tone: 'danger',
    },
    argTypes: {
        tone: { control: 'inline-radio', options: ['danger', 'warning', 'info'] },
        loading: { control: 'boolean' },
        error: { control: 'text' },
        closeOnBackdrop: { control: 'boolean' },
        isOpen: { control: false },
        onConfirm: { control: false },
        onCancel: { control: false },
    },
    parameters: {
        layout: 'fullscreen',
        docs: {
            story: { inline: false, iframeHeight: 460 },
            description: {
                component: [
                    '**Status: Approved, and mandatory.** A permanent CI ratchet',
                    '(`src/tests/noBlockingBrowserDialogs.test.js`) fails the build on any',
                    'reachable `window.confirm` / `confirm()` / `window.alert` / `alert()` in',
                    '`src/`. Blocking browser dialogs came back three separate times during the',
                    'migration, which is why the check now looks for both the bare and',
                    '`window.`-prefixed forms.',
                    '',
                    '**Location caveat — Needs review.** Like `Modal`, this belongs in',
                    '`design-system/patterns` long-term. It sits beside `Modal` because the design',
                    'system must not depend on `shared`, and it moves when `Modal` moves.',
                    '',
                    '### Intended use',
                    '',
                    'A yes/no decision that guards work which is hard or impossible to reverse.',
                    'It is **not** a notification: for "that worked", use a toast or an inline',
                    '`FieldMessage`. A confirmation the user always says yes to is noise, and',
                    'trains them to click through the one that mattered.',
                    '',
                    '### Supported variants',
                    '',
                    '| Tone | Medallion | Confirm button | Use for |',
                    '| --- | --- | --- | --- |',
                    '| `danger` (default) | danger | `danger` | Irreversible destruction. |',
                    '| `warning` | warning | `danger` | Reversible but disruptive. |',
                    '| `info` | info | `primary` | A neutral choice worth pausing on. |',
                    '',
                    '### Behaviour contract',
                    '',
                    '- **Initial focus goes to Cancel**, not Confirm. These dialogs guard',
                    '  irreversible work, so the safe action is the one under the user\'s finger.',
                    '- Escape and backdrop dismissal are **disabled while `loading`**, so an',
                    '  operation in flight cannot be abandoned half-way.',
                    '- Backdrop dismissal is off by default: a stray click beside a delete dialog',
                    '  should not decide anything.',
                    '- `onConfirm` is guarded by a synchronous ref, so two activations dispatched',
                    '  inside one React render cannot both fire it. Disabling the button visually is',
                    '  not enough — `loading` only takes effect on the next render.',
                    '- `error` renders in an always-mounted live region and leaves the dialog open',
                    '  so the user can retry.',
                    '',
                    '### Accessibility expectations',
                    '',
                    '- `title` is the accessible name and the visible heading. It **throws** when',
                    '  missing or blank.',
                    '- The medallion is decorative; tone is never the only signal of severity.',
                    '- Write the confirm label as the action itself — `Delete record`, not `OK`. On',
                    '  a screen reader, `OK` in a list of buttons says nothing.',
                    '- Long titles and descriptions wrap with `overflow-wrap: anywhere`, so an',
                    '  unbroken identifier cannot force the dialog to scroll sideways.',
                    '',
                    '### Common mistakes',
                    '',
                    '- `Yes` / `No` labels instead of the action.',
                    '- Leaving `tone="danger"` on a harmless confirmation, which dilutes the tone.',
                    '- Closing the dialog optimistically on confirm and reporting the failure',
                    '  somewhere else. Keep it open, set `error`, and let the user retry.',
                    '- Forgetting `loading`, so a slow delete can be fired twice.',
                    '',
                    '### When feature-specific composition is acceptable',
                    '',
                    'Features own the words, the tone, the action and the in-flight state. Extra',
                    'context can go in `children`, which renders left-aligned below the description.',
                    'Features must not build their own confirmation dialog.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** The default: a destructive confirmation. Cancel is focused first. */
export const Default = {
    render: (args) => <ConfirmHarness {...args} />,
};

/** All three tones. */
export const Tones = {
    render: () => (
        <Stack gap="md">
            <ConfirmHarness
                startOpen={false}
                triggerLabel="Danger tone"
                tone="danger"
                title="Delete this record?"
                description="This cannot be undone."
                confirmLabel="Delete record"
            />
            <ConfirmHarness
                startOpen={false}
                triggerLabel="Warning tone"
                tone="warning"
                title="Archive this record?"
                description="Archived records are hidden from the default list but can be restored."
                confirmLabel="Archive record"
            />
            <ConfirmHarness
                startOpen={false}
                triggerLabel="Info tone"
                tone="info"
                title="Send this record for review?"
                description="The assigned reviewer is notified immediately."
                confirmLabel="Send for review"
            />
        </Stack>
    ),
};

/**
 * In flight. Both buttons are disabled, the confirm button shows its busy
 * state, and neither Escape nor a backdrop click can abandon the operation.
 */
export const Loading = {
    render: (args) => (
        <ConfirmHarness {...args} loading confirmLabel="Deleting…" />
    ),
};

/**
 * A failure. The dialog stays open and announces the error, so the user can
 * read what happened and retry rather than wondering whether it worked.
 */
export const ErrorState = {
    render: (args) => (
        <ConfirmHarness
            {...args}
            error="The record could not be deleted because it is referenced by another record."
        />
    ),
};

/** `children` adds context below the description, left-aligned. */
export const WithExtraContext = {
    render: (args) => (
        <ConfirmHarness {...args}>
            <Stack gap="sm">
                <FieldDisplay label="Reference">REC-000102</FieldDisplay>
                <FieldDisplay label="Attachments">8 files</FieldDisplay>
            </Stack>
        </ConfirmHarness>
    ),
};

/**
 * Long text and an unbroken identifier. Both wrap; the dialog never scrolls
 * horizontally.
 */
export const LongContent = {
    render: (args) => (
        <ConfirmHarness
            {...args}
            title="Delete the consolidated quarterly review record REC000000000000000000000000000042?"
            description="This removes the record, every attachment linked to it, and the entire history of changes made to it since it was created. This cannot be undone, and the record cannot be recovered from an archive afterwards."
            confirmLabel="Delete the record and all of its attachments"
        />
    ),
};

/** Mobile width: the footer stacks with the safe action nearest the thumb. */
export const NarrowViewport = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: (args) => <ConfirmHarness {...args} />,
};
