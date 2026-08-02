import React, { useRef, useState } from 'react';
import { fn } from 'storybook/test';
import { X } from 'lucide-react';
import {
    Button,
    Checkbox,
    FieldMessage,
    FormField,
    IconButton,
    Input,
    Select,
    Textarea,
} from '@design-system/components';
import { Inline, Stack } from '@design-system/layouts';
import { Modal } from './Modal';

/**
 * Lives beside `Modal` rather than in `src/design-system/stories/patterns`
 * because the design system must not depend on `shared`, and this pattern is
 * built on the shared `Modal`. Its catalog `title` still files it under
 * Patterns. It moves with `Modal` when `Modal` moves.
 */

const TITLE_ID = 'pattern-modal-form-title';

function ModalForm({ error = null, saving = false, invalid = false, startOpen = true }) {
    const [open, setOpen] = useState(startOpen);
    const firstFieldRef = useRef(null);
    const close = () => setOpen(false);

    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>New record</Button>
            {open && (
                <Modal
                    labelledBy={TITLE_ID}
                    initialFocusRef={firstFieldRef}
                    // While a save is in flight, nothing may dismiss the dialog and
                    // silently discard what the user typed.
                    onClose={saving ? undefined : close}
                    closeOnEscape={!saving}
                    closeOnBackdrop={false}
                    className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
                >
                    <form
                        onSubmit={(event) => { event.preventDefault(); close(); }}
                        style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 'var(--ds-space-3)',
                                padding: 'var(--ds-space-5) var(--ds-space-5) var(--ds-space-3)',
                            }}
                        >
                            <h2 id={TITLE_ID} style={{ margin: 0, flex: 1 }}>New record</h2>
                            <IconButton
                                variant="ghost"
                                size="sm"
                                label="Close dialog"
                                onClick={close}
                                disabled={saving}
                            >
                                <X size={18} aria-hidden="true" />
                            </IconButton>
                        </div>

                        <div style={{ overflowY: 'auto', padding: '0 var(--ds-space-5) var(--ds-space-4)' }}>
                            <Stack gap="md">
                                {/* Always mounted, so a failure is announced into it. */}
                                <div role="alert">
                                    {error && <FieldMessage tone="error">{error}</FieldMessage>}
                                </div>

                                <FormField
                                    label="Title"
                                    required
                                    error={invalid ? 'Enter a title for this record.' : undefined}
                                >
                                    <Input ref={firstFieldRef} disabled={saving} onChange={fn()} />
                                </FormField>

                                <FormField label="Region">
                                    <Select disabled={saving} onChange={fn()}>
                                        <option value="">Select a region</option>
                                        <option value="north">North</option>
                                        <option value="south">South</option>
                                        <option value="east">East</option>
                                        <option value="west">West</option>
                                    </Select>
                                </FormField>

                                <FormField
                                    label="Notes"
                                    description="Optional context for whoever reviews this next."
                                >
                                    <Textarea rows={3} disabled={saving} onChange={fn()} />
                                </FormField>

                                <Checkbox
                                    label="Notify the record owner"
                                    description="Sent as soon as the record is created."
                                    disabled={saving}
                                    onChange={fn()}
                                />
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
                                <Button type="submit" variant="primary" loading={saving}>
                                    {saving ? 'Creating…' : 'Create record'}
                                </Button>
                                <Button type="button" variant="secondary" onClick={close} disabled={saving}>
                                    Cancel
                                </Button>
                            </Inline>
                        </div>
                    </form>
                </Modal>
            )}
        </>
    );
}

/**
 * A form inside a dialog — the composition that gets focus, submission and
 * failure handling wrong most often.
 */
const meta = {
    title: 'Patterns/Modal form',
    parameters: {
        layout: 'fullscreen',
        docs: {
            story: { inline: false, iframeHeight: 560 },
            description: {
                component: [
                    '**Status: Approved composition.** It is built from the shared accessible',
                    '`Modal` plus approved form primitives, and matches the migrated Login',
                    'password-reset overlay and the PEV request dialog.',
                    '',
                    '**Needs review:** this lives beside `Modal` in `src/shared/components/modals`',
                    'rather than in `design-system/patterns`, because the design system must not',
                    'depend on `shared`. It moves when `Modal` moves.',
                    '',
                    '### Anatomy',
                    '',
                    '1. A `<form>` **inside** the dialog panel, wrapping header, body and footer.',
                    '2. A heading that names the dialog through `labelledBy`, plus a close control.',
                    '3. A scrollable body holding `FormField`-wrapped controls.',
                    '4. An always-mounted `role="alert"` region for submission failures.',
                    '5. A pinned footer with a `type="submit"` primary and a `type="button"` cancel.',
                    '',
                    '### The three things this pattern gets right',
                    '',
                    '- **Focus starts in the first field**, via `initialFocusRef` — not on the close',
                    '  button, which is where the default first-focusable rule would put it.',
                    '- **Submit is a real form submission.** `Button` defaults to `type="button"`, so',
                    '  the submitting button must say `type="submit"` explicitly. That is what makes',
                    '  Enter-to-submit work from any field.',
                    '- **A save in flight cannot be abandoned.** While `saving`, Escape and the',
                    '  backdrop are disabled, the close and cancel controls are disabled, and every',
                    '  field is disabled — so the dialog cannot vanish and discard typed input.',
                    '',
                    '### Accessibility expectations',
                    '',
                    '- The dialog is named by its visible heading, and focus is trapped and restored',
                    '  by `Modal`.',
                    '- Field errors belong on the fields, through `FormField`, which wires',
                    '  `aria-invalid` and `aria-describedby`. A summary at the top does not replace',
                    '  them.',
                    '- The submission-failure region is always mounted, so the message is announced',
                    '  when it appears rather than needing the region to be created first.',
                    '- The body is its own scroll region, so the footer actions stay reachable on a',
                    '  short viewport.',
                    '- Cancel must be `type="button"`, or it submits the form.',
                    '',
                    '### Common mistakes',
                    '',
                    '- No `<form>` element, so Enter does nothing and the browser cannot help.',
                    '- Forgetting `type="submit"`, so the primary button silently does nothing on',
                    '  Enter.',
                    '- Closing the dialog optimistically on submit and reporting the failure as a',
                    '  toast on a page the user has already left.',
                    '- Leaving Escape enabled during a save, which throws away the user\'s input.',
                    '- A long form in a dialog. Past about six fields, this should be a page.',
                    '',
                    '### When feature-specific composition is acceptable',
                    '',
                    'Features own the fields, the validation, the payload and what submit does. They',
                    'must not reimplement the dialog, the focus handling or the error treatment.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** The default: an empty form, focus in the first field. */
export const Default = { render: () => <ModalForm /> };

/** Field-level validation. The error is attached to the field, not floated above it. */
export const FieldValidationError = { render: () => <ModalForm invalid /> };

/**
 * A submission failure. The dialog stays open, the message is announced, and
 * everything the user typed is still there.
 */
export const SubmissionError = {
    render: () => (
        <ModalForm error="The record could not be created because a record with this title already exists." />
    ),
};

/**
 * Saving. Every control is disabled, the primary button shows its busy state,
 * and neither Escape nor the backdrop can abandon the operation.
 */
export const Saving = { render: () => <ModalForm saving /> };

/** Mobile: the body scrolls and the footer stays pinned and reachable. */
export const MobileViewport = {
    globals: { viewport: { value: 'safehaulMobile' } },
    render: () => <ModalForm />,
};
