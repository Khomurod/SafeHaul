import React, { useState } from 'react';
import { Button, FormField, Input } from '@design-system/components';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Typed confirmation: a destructive dialog that will not proceed until the
 * operator types the exact name of the thing being destroyed.
 *
 * Built entirely from `ConfirmDialog` plus an approved `FormField` + `Input` in
 * its body — there is no new dialog primitive here, and there must not be.
 */
function TypedConfirmationHarness({
    entryName = 'SERVICE_TOKEN',
    consumers = ['runtime worker', 'scheduled job'],
    startOpen = true,
    ...props
}) {
    const [open, setOpen] = useState(startOpen);
    const [typed, setTyped] = useState('');
    const matches = typed === entryName;

    return (
        <>
            <Button variant="danger" onClick={() => setOpen(true)}>Delete entry</Button>
            <ConfirmDialog
                {...props}
                isOpen={open}
                title={`Delete ${entryName}?`}
                description={`This removes the stored value. Nothing else on the record changes.`}
                tone="danger"
                confirmLabel={matches ? `Delete ${entryName}` : 'Type the name to continue'}
                onCancel={() => { setOpen(false); setTyped(''); }}
                onConfirm={matches ? () => { setOpen(false); setTyped(''); } : () => {}}
            >
                <div style={{ marginTop: 'var(--ds-space-4)', textAlign: 'start' }}>
                    <h3 style={{ fontSize: 'var(--ds-font-size-sm)', fontWeight: 600 }}>Known consumers</h3>
                    <ul
                        style={{
                            marginTop: 'var(--ds-space-1)',
                            paddingInlineStart: 'var(--ds-space-4)',
                            listStyle: 'disc',
                            color: 'var(--ds-color-content-secondary)',
                            fontSize: 'var(--ds-font-size-sm)',
                        }}
                    >
                        {consumers.map((consumer) => <li key={consumer}>{consumer}</li>)}
                    </ul>

                    <div style={{ marginTop: 'var(--ds-space-3)' }}>
                        <FormField
                            label={`Type ${entryName} to confirm`}
                            description="The exact name, including capitalisation."
                            required
                        >
                            <Input
                                value={typed}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => setTyped(event.target.value)}
                            />
                        </FormField>
                    </div>
                </div>
            </ConfirmDialog>
        </>
    );
}

const meta = {
    title: 'Patterns/Typed confirmation',
    parameters: {
        layout: 'fullscreen',
        docs: {
            story: { inline: false, iframeHeight: 560 },
            description: {
                component: [
                    '**Status: Approved composition.** No new primitive: this is `ConfirmDialog`',
                    'with an approved `FormField` + `Input` in its body slot.',
                    '',
                    '### When a typed confirmation is warranted',
                    '',
                    'Only when the action is **irreversible and targeted** — deleting one named',
                    'thing out of many similar ones, where the cost of hitting the wrong row is',
                    'high and the mistake is invisible until something else breaks. Everything',
                    'else should use a plain `ConfirmDialog`; asking someone to type a name for a',
                    'routine action is friction that trains them to type it without reading.',
                    '',
                    '### What it must show before it asks',
                    '',
                    'The **consumers** — what else depends on this. "What breaks if this goes" is',
                    'the only question the operator actually needs answered, and it must be on the',
                    'dialog rather than one screen back.',
                    '',
                    '### Contract',
                    '',
                    '- The confirm label states what will happen once the name matches, and states',
                    '  the requirement before it does. It is never a bare "Confirm".',
                    '- Matching is exact, including case. A near-miss is a wrong answer.',
                    '- The client-side check is a guard, not the guarantee: the server should',
                    '  re-check the typed name against the record it is about to delete, so a',
                    '  stale dialog cannot remove the wrong thing.',
                    '- Initial focus stays on Cancel (inherited from `ConfirmDialog`), so the safe',
                    '  action is the one under the operator\'s finger.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** The dialog as it opens: confirm is inert until the name matches. */
export const Default = { render: () => <TypedConfirmationHarness /> };

/** A failed attempt left announced, with the dialog still open to retry. */
export const WithError = {
    render: () => <TypedConfirmationHarness error="The value could not be deleted. Try again." />,
};

/** The confirmed action in flight — dismissal is refused while it runs. */
export const InFlight = { render: () => <TypedConfirmationHarness loading /> };
