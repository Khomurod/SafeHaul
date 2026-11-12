import React, { useState } from 'react';
import { Button, ChoiceGroup, FormField, Input, Radio } from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';
import { Modal } from '@design-system/patterns';

/**
 * The dialog chrome, separately from the dialog behaviour.
 *
 * `Modal.stories.jsx` is the behaviour catalog — naming, focus, dismissal, the
 * scrolling-body defect. This file is the geometry: what each `size` resolves
 * to, what `scroll`, `fill`, `placement`, `mobile` and `tone` change, and what a
 * caller may therefore stop hand-writing. Two files rather than one because
 * they answer different questions and neither should have to be read to review
 * the other.
 */

function Sheet({ title, children, onClose, actions }) {
    return (
        <Stack gap="md" style={{ padding: 'var(--ds-space-5)' }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {children}
            <Inline gap="sm">
                {actions}
                <Button variant="secondary" onClick={onClose}>Close</Button>
            </Inline>
        </Stack>
    );
}

function Harness({ triggerLabel = 'Open dialog', title, body, actions, ...chrome }) {
    const [open, setOpen] = useState(true);
    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>{triggerLabel}</Button>
            {open && (
                <Modal label={title} onClose={() => setOpen(false)} {...chrome}>
                    <Sheet title={title} onClose={() => setOpen(false)} actions={actions}>
                        {body}
                    </Sheet>
                </Modal>
            )}
        </>
    );
}

const meta = {
    title: 'Patterns/Modal chrome',
    component: Modal,
    parameters: {
        layout: 'fullscreen',
        docs: {
            story: { inline: false, iframeHeight: 460 },
            description: {
                component: [
                    '**Status: Approved.** The chrome contract, added 2026-09-05.',
                    '',
                    'Before it existed, `Modal` took a `className` and an `overlayClassName` that',
                    'REPLACE the panel and backdrop wholesale, and 38 of the 41 call sites used',
                    'them — writing **30 different spellings** of the same handful of intentions.',
                    'Every one of those spellings is a second dialog contract: a hairline border',
                    'here and none there, `max-h-[85vh]` beside `max-h-[92vh]`, `backdrop-blur-md`',
                    'beside `backdrop-blur-sm`. None of it was visible to any guard, because the',
                    'classes themselves are perfectly on-contract.',
                    '',
                    '### What a caller chooses',
                    '',
                    '| Prop | Values | For |',
                    '|---|---|---|',
                    '| `size` | `sm` `md` `lg` `xl` `2xl` `4xl` `5xl` `7xl` | panel width; default `lg` |',
                    '| `scroll` | `panel` `body` | `body` pins a header and footer inside the panel |',
                    '| `fill` | boolean | fixes the height, for a viewer that must not resize |',
                    '| `mobile` | `inset` `fullscreen` `sheet` | below 640px; `sheet` is a bottom sheet there |',
                    '| `placement` | `center` `bottom` | `bottom` is a sheet |',
                    '| `tone` | `neutral` `danger` | borders a destructive dialog |',
                    '',
                    '### What a caller does not choose',
                    '',
                    'Surface, border, radius, shadow, overlay colour, blur and stacking layer.',
                    'Those are what makes a dialog look like this product\'s dialog, so they are',
                    'fixed chrome with no prop at all.',
                    '',
                    '**An unsupported value throws.** A silent fallback to the default is exactly',
                    'how thirty spellings accumulated without anyone noticing.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/**
 * The eight widths, as specimens rather than as eight stacked dialogs.
 *
 * Deliberately markup carrying the chrome classes: eight real `<Modal>`s would
 * each be a `position: fixed` overlay covering the last, so nothing could be
 * seen or measured. What this shows and what `check:visual-contract` reads is
 * the CSS contract itself — the widths, the radius, the hairline border, the
 * surface and the shadow that every dialog in the product now shares.
 */
export const Sizes = {
    parameters: { docs: { story: { inline: true } } },
    render: () => (
        <div style={{ display: 'grid', gap: 'var(--ds-space-3)', padding: 'var(--ds-space-5)' }}>
            {['sm', 'md', 'lg', 'xl', '2xl', '4xl', '5xl', '7xl'].map((size) => (
                <div key={size} className="ds-modal__panel" data-size={size} data-scroll="panel">
                    <div style={{ padding: 'var(--ds-space-4)' }}>
                        <code>size=&quot;{size}&quot;</code>
                    </div>
                </div>
            ))}
        </div>
    ),
};

/**
 * `scroll="body"` makes the panel a column, so a header and a footer inside it
 * stay pinned while the middle scrolls. Without it the footer actions scroll
 * out of reach on a short viewport — the single commonest dialog defect, and
 * the reason this is a prop rather than a caller's `flex-col`.
 */
export const ScrollBody = {
    render: function ScrollBodyStory() {
        const [open, setOpen] = useState(true);
        return (
            <>
                <Button variant="primary" onClick={() => setOpen(true)}>Open scrolling dialog</Button>
                {open && (
                    <Modal label="Terms of use" scroll="body" onClose={() => setOpen(false)}>
                        <div style={{ flexShrink: 0, padding: 'var(--ds-space-5) var(--ds-space-5) var(--ds-space-3)' }}>
                            <h2 style={{ margin: 0 }}>Terms of use</h2>
                        </div>
                        <div style={{ overflowY: 'auto', padding: '0 var(--ds-space-5)' }}>
                            <Stack gap="md">
                                {Array.from({ length: 14 }, (_, index) => (
                                    <p key={index} style={{ margin: 0 }}>
                                        Paragraph {index + 1}. The panel does not scroll; this region
                                        does, so the footer below stays pinned however long this gets.
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
                                <Button variant="primary" onClick={() => setOpen(false)}>Accept</Button>
                                <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
                            </Inline>
                        </div>
                    </Modal>
                )}
            </>
        );
    },
};

/** `fill` fixes the height, so a viewer does not resize as its content changes. */
export const Fill = {
    render: () => (
        <Harness
            title="Document preview"
            size="4xl"
            scroll="body"
            fill
            body={<p style={{ margin: 0 }}>The panel is 90vh whatever this contains.</p>}
        />
    ),
};

/** A destructive dialog is bordered, not coloured — the tone belongs on the action. */
export const DangerTone = {
    render: () => (
        <Harness
            title="Deactivate feature"
            size="md"
            tone="danger"
            triggerLabel="Open destructive dialog"
            actions={<Button variant="danger">Deactivate</Button>}
            body={<p style={{ margin: 0 }}>Everyone using this loses access immediately.</p>}
        />
    ),
};

/** A bottom sheet rises from the edge the thumb is nearest, leaving the page visible. */
export const BottomSheet = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: () => (
        <Harness
            title="Edit field"
            placement="bottom"
            scroll="body"
            triggerLabel="Open sheet"
            body={<p style={{ margin: 0 }}>Quick edits belong here rather than in a centred dialog.</p>}
        />
    ),
};

/**
 * `mobile="fullscreen"` below 640px, for the dialogs that are really a screen —
 * a document editor, a media viewer, a full record. `100dvh` rather than `100vh`,
 * because a mobile browser's chrome eats the difference and a footer 60px below
 * the fold is a footer nobody can press.
 */
export const FullscreenMobile = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: () => (
        <Harness
            title="Full-screen editor"
            size="xl"
            scroll="body"
            mobile="fullscreen"
            triggerLabel="Open fullscreen dialog"
            body={<p style={{ margin: 0 }}>No inset, no radius, no border — it is the screen.</p>}
        />
    ),
};

function SheetForm() {
    const [open, setOpen] = useState(true);
    const [access, setAccess] = useState('standard');
    const close = () => setOpen(false);
    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>Open the add-member form</Button>
            {open && (
                <Modal labelledBy="sheet-story-title" describedBy="sheet-story-description" mobile="sheet" scroll="body" size="2xl" onClose={close}>
                    <div style={{ flexShrink: 0, padding: 'var(--ds-space-5) var(--ds-space-5) 0' }}>
                        <h2 id="sheet-story-title" style={{ margin: 0 }}>Add a member</h2>
                        <p id="sheet-story-description" style={{ margin: 'var(--ds-space-1) 0 0' }}>
                            They sign in with this email and password.
                        </p>
                    </div>
                    <div style={{ overflowY: 'auto', padding: 'var(--ds-space-5)' }}>
                        <Stack gap="md">
                            <FormField label="Full name" required>
                                <Input autoComplete="off" />
                            </FormField>
                            <FormField label="Email address" required>
                                <Input type="email" autoComplete="off" />
                            </FormField>
                            <ChoiceGroup legend="Access" required appearance="card" orientation="horizontal">
                                <Radio
                                    id="sheet-access-standard"
                                    name="sheet-access"
                                    value="standard"
                                    label="Standard"
                                    description="Sees their own records."
                                    required
                                    requiredMark={false}
                                    checked={access === 'standard'}
                                    onChange={() => setAccess('standard')}
                                />
                                <Radio
                                    id="sheet-access-full"
                                    name="sheet-access"
                                    value="full"
                                    label="Full access"
                                    description="Sees everything and changes settings."
                                    required
                                    requiredMark={false}
                                    checked={access === 'full'}
                                    onChange={() => setAccess('full')}
                                />
                            </ChoiceGroup>
                        </Stack>
                    </div>
                    <div
                        style={{
                            flexShrink: 0,
                            borderTop: '1px solid var(--ds-color-border-subtle)',
                            background: 'var(--ds-color-surface-subtle)',
                            // A sheet's last row pads the home-indicator inset itself (README).
                            padding: 'var(--ds-space-4) var(--ds-space-5) calc(var(--ds-space-4) + env(safe-area-inset-bottom, 0px))',
                        }}
                    >
                        <Inline gap="sm">
                            <Button variant="secondary" onClick={close}>Cancel</Button>
                            <Button variant="primary" onClick={close}>Add member</Button>
                        </Inline>
                    </div>
                </Modal>
            )}
        </>
    );
}

/**
 * `mobile="sheet"` at a phone width: the centred dialog becomes a bottom sheet —
 * full width, flush with the bottom edge, rounded at the top, capped at 80vh.
 * Wider than 640px it is the ordinary centred dialog. Its footer, the last
 * row, adds `env(safe-area-inset-bottom)` to its own bottom padding, so on an
 * iPhone the grey band reaches the edge under the home indicator.
 */
export const SheetOnPhones = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: () => <SheetForm />,
};

/** The same dialog at a desk: `mobile="sheet"` changes nothing above 640px. */
export const SheetOnPhonesWide = {
    render: () => <SheetForm />,
};
