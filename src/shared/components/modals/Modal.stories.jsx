import React, { useRef, useState } from 'react';
import { fn } from 'storybook/test';
import { X } from 'lucide-react';
import {
    Button,
    FormField,
    IconButton,
    Input,
    Select,
    Textarea,
} from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';
import { Modal } from './Modal';

/**
 * Modals are rendered conditionally by their owner (`{open && <Modal …/>}`), so
 * every story that shows dismissal needs a trigger to reopen it.
 */
function ModalHarness({ children, triggerLabel = 'Open dialog', startOpen = true, ...modalProps }) {
    const [open, setOpen] = useState(startOpen);
    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>{triggerLabel}</Button>
            {open && (
                <Modal {...modalProps} onClose={() => setOpen(false)}>
                    {typeof children === 'function' ? children(() => setOpen(false)) : children}
                </Modal>
            )}
        </>
    );
}

function DialogShell({ titleId, title, onClose, children, footer }) {
    return (
        <Stack gap="md">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--ds-space-3)', padding: 'var(--ds-space-5) var(--ds-space-5) 0' }}>
                <h2 id={titleId} style={{ margin: 0, flex: 1 }}>{title}</h2>
                {onClose && (
                    <IconButton variant="ghost" size="sm" label="Close dialog" onClick={onClose}>
                        <X size={18} aria-hidden="true" />
                    </IconButton>
                )}
            </div>
            <div style={{ padding: '0 var(--ds-space-5)' }}>{children}</div>
            {footer && (
                <div
                    style={{
                        borderTop: '1px solid var(--ds-color-border-subtle)',
                        background: 'var(--ds-color-surface-subtle)',
                        padding: 'var(--ds-space-4) var(--ds-space-5)',
                    }}
                >
                    {footer}
                </div>
            )}
        </Stack>
    );
}

/**
 * `Modal` is SafeHaul's shared accessible dialog primitive.
 */
const meta = {
    title: 'Components/Modal',
    component: Modal,
    parameters: {
        layout: 'fullscreen',
        docs: {
            // Each story opens a `position: fixed` overlay. Rendered inline, six of
            // them would stack on top of each other and cover the documentation
            // page. One iframe per story keeps each dialog in its own viewport.
            story: { inline: false, iframeHeight: 460 },
            description: {
                component: [
                    '**Status: Approved.** It is the dialog contract every migrated overlay now uses,',
                    'and its behaviour is covered by unit and a11y tests.',
                    '',
                    '**Location caveat — Needs review.** The design-system README places dialog',
                    'structure in `design-system/patterns`, and that is where `Modal` belongs',
                    'long-term. It currently lives in `src/shared/components/modals` because the',
                    'design system must not depend on `shared`, and moving it is a migration of its',
                    'own. Its story is colocated with it and is pulled into this catalog until then.',
                    '',
                    '### Intended use',
                    '',
                    'A focused task or decision that must interrupt the page. If the content is long,',
                    'browsable, or something the user will want to keep open alongside the page, it',
                    'is a page or a panel, not a modal.',
                    '',
                    '### Rendering convention',
                    '',
                    '**Rendering the component means the dialog is open.** There is no `open` prop —',
                    'the owner writes `{open && <Modal …/>}`. That is what makes focus restoration',
                    'work: unmounting is the close event.',
                    '',
                    '### Accessibility expectations',
                    '',
                    '- `role="dialog"` with `aria-modal="true"`, and a name by construction: pass',
                    '  either `label` or `labelledBy`. **An unnamed dialog is announced as just',
                    '  "dialog".**',
                    '- Focus moves into the dialog on open — to `initialFocusRef`, else the first',
                    '  focusable child, else the panel itself — and is restored to the previously',
                    '  focused element on close.',
                    '- Tab and Shift+Tab are trapped inside the panel while it is open.',
                    '- Escape closes, and a backdrop click closes only when the press *starts and',
                    '  ends* on the backdrop, so a drag that began inside the panel cannot dismiss it.',
                    '- Both dismissals are opt-out: `closeOnEscape={false}` and',
                    '  `closeOnBackdrop={false}` for a forced choice or an operation in flight.',
                    '- Omitting `onClose` entirely makes the dialog non-dismissable. Use that',
                    '  sparingly, and only when there is a real in-dialog way forward.',
                    '- Focus restoration skips a detached element, so nested dialogs closing in the',
                    '  same commit cannot strand focus on `<body>`.',
                    '',
                    '### Common mistakes',
                    '',
                    '- No accessible name — neither `label` nor `labelledBy`.',
                    '- `labelledBy` pointing at an id that is not rendered, which names the dialog',
                    '  nothing at all.',
                    '- A dialog with no visible close control, relying on Escape alone.',
                    '- Opening a modal from a modal. Two stacked dialogs are almost always a sign',
                    '  the flow should be a page.',
                    '- Long scrolling content in a dialog: on a short viewport the footer actions',
                    '  scroll out of reach. Give the body its own scroll region, as the last story',
                    '  here does.',
                    '',
                    '### When feature-specific composition is acceptable',
                    '',
                    'Features own the dialog\'s title, body, actions and what confirming does. They',
                    'must not reimplement focus trapping, Escape handling or the backdrop. For a',
                    'confirmation, use `ConfirmDialog` rather than composing one from `Modal`.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** A standard dialog: named heading, body, and a footer with two actions. */
export const Default = {
    render: () => (
        <ModalHarness labelledBy="story-modal-title" closeOnBackdrop>
            {(close) => (
                <DialogShell
                    titleId="story-modal-title"
                    title="Rename record"
                    onClose={close}
                    footer={(
                        <Inline gap="sm">
                            <Button variant="primary" onClick={close}>Save</Button>
                            <Button variant="secondary" onClick={close}>Cancel</Button>
                        </Inline>
                    )}
                >
                    <p style={{ margin: 0 }}>
                        The dialog is named by its visible heading through <code>labelledBy</code>,
                        which is preferred over <code>label</code> whenever a heading is on screen.
                    </p>
                </DialogShell>
            )}
        </ModalHarness>
    ),
};

/**
 * A dialog containing a form. `initialFocusRef` puts focus on the first field
 * rather than the close button, so a keyboard user can start typing.
 */
export const WithForm = {
    render: function WithFormStory() {
        const firstFieldRef = useRef(null);
        return (
            <ModalHarness labelledBy="story-modal-form-title" initialFocusRef={firstFieldRef}>
                {(close) => (
                    <DialogShell
                        titleId="story-modal-form-title"
                        title="Create record"
                        onClose={close}
                        footer={(
                            <Inline gap="sm">
                                <Button variant="primary" onClick={close}>Create</Button>
                                <Button variant="secondary" onClick={close}>Cancel</Button>
                            </Inline>
                        )}
                    >
                        <Stack gap="md">
                            <FormField label="Title" required>
                                <Input ref={firstFieldRef} onChange={fn()} />
                            </FormField>
                            <FormField label="Region">
                                <Select onChange={fn()}>
                                    <option value="">Select a region</option>
                                    <option value="north">North</option>
                                    <option value="south">South</option>
                                </Select>
                            </FormField>
                            <FormField label="Notes" description="Optional context for whoever reviews this.">
                                <Textarea rows={3} onChange={fn()} />
                            </FormField>
                        </Stack>
                    </DialogShell>
                )}
            </ModalHarness>
        );
    },
};

/** `label` names a dialog that has no visible heading of its own. */
export const NamedByLabelProp = {
    render: () => (
        <ModalHarness label="Preview" closeOnBackdrop>
            {(close) => (
                <Stack gap="md">
                    <div style={{ padding: 'var(--ds-space-5)' }}>
                        <p style={{ margin: 0 }}>
                            This dialog has no visible heading, so it is named with the
                            {' '}<code>label</code> prop instead. Prefer a visible heading where one
                            makes sense.
                        </p>
                    </div>
                    <div style={{ borderTop: '1px solid var(--ds-color-border-subtle)', padding: 'var(--ds-space-4) var(--ds-space-5)' }}>
                        <Button variant="secondary" onClick={close}>Close</Button>
                    </div>
                </Stack>
            )}
        </ModalHarness>
    ),
};

/**
 * A non-dismissable dialog: Escape and backdrop clicks are disabled, so the
 * only way out is a real in-dialog choice. Use this sparingly.
 */
export const NonDismissable = {
    render: () => (
        <ModalHarness
            labelledBy="story-modal-forced-title"
            closeOnEscape={false}
            closeOnBackdrop={false}
            triggerLabel="Open non-dismissable dialog"
        >
            {(close) => (
                <DialogShell
                    titleId="story-modal-forced-title"
                    title="Choose how to continue"
                    footer={(
                        <Inline gap="sm">
                            <Button variant="primary" onClick={close}>Continue as reviewer</Button>
                            <Button variant="secondary" onClick={close}>Continue as viewer</Button>
                        </Inline>
                    )}
                >
                    <p style={{ margin: 0 }}>
                        Escape and backdrop clicks are disabled here, so there is no way to dismiss
                        this without making a choice. Only do this when the dialog offers a real way
                        forward — never to trap someone.
                    </p>
                </DialogShell>
            )}
        </ModalHarness>
    ),
};

/**
 * Long content. The body scrolls inside the panel so the footer actions stay
 * reachable — the single most common modal layout defect.
 */
export const LongScrollingContent = {
    render: () => (
        <ModalHarness labelledBy="story-modal-long-title" closeOnBackdrop>
            {(close) => (
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                    <div style={{ padding: 'var(--ds-space-5) var(--ds-space-5) var(--ds-space-3)' }}>
                        <h2 id="story-modal-long-title" style={{ margin: 0 }}>Terms of use</h2>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '0 var(--ds-space-5)' }}>
                        <Stack gap="md">
                            {Array.from({ length: 12 }, (_, index) => (
                                <p key={index} style={{ margin: 0 }}>
                                    Paragraph {index + 1}. The dialog body is its own scroll region, so
                                    the footer below stays pinned and reachable no matter how long this
                                    content becomes. Check this at the mobile viewport, where the
                                    available height is smallest.
                                </p>
                            ))}
                        </Stack>
                    </div>
                    <div
                        style={{
                            flexShrink: 0,
                            borderTop: '1px solid var(--ds-color-border-subtle)',
                            background: 'var(--ds-color-surface-subtle)',
                            padding: 'var(--ds-space-4) var(--ds-space-5)',
                        }}
                    >
                        <Inline gap="sm">
                            <Button variant="primary" onClick={close}>Accept</Button>
                            <Button variant="secondary" onClick={close}>Close</Button>
                        </Inline>
                    </div>
                </div>
            )}
        </ModalHarness>
    ),
};

/** Mobile width: the panel fills the screen and the footer stacks. */
export const NarrowViewport = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: () => (
        <ModalHarness labelledBy="story-modal-mobile-title" closeOnBackdrop>
            {(close) => (
                <DialogShell
                    titleId="story-modal-mobile-title"
                    title="Rename record"
                    onClose={close}
                    footer={(
                        <Stack gap="sm">
                            <Button variant="primary" fullWidth onClick={close}>Save</Button>
                            <Button variant="secondary" fullWidth onClick={close}>Cancel</Button>
                        </Stack>
                    )}
                >
                    <FormField label="Title" required>
                        <Input onChange={fn()} />
                    </FormField>
                </DialogShell>
            )}
        </ModalHarness>
    ),
};
