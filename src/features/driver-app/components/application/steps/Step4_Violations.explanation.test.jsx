/**
 * The disclosure explanation box has to survive being typed into.
 *
 * `ConditionalExplanation` used to be declared inside `Step4_Violations`, so it
 * was a new function — and therefore a new component *type* — on every render.
 * React does not update across a type change; it unmounts the old subtree and
 * mounts a new one. Typing calls `updateFormData`, the step re-renders, and the
 * textarea the driver was typing into was destroyed and rebuilt on every single
 * keystroke: the caret jumped out after each character, so writing the required
 * FMCSA explanation meant clicking back into the box between letters.
 *
 * These tests drive the box through a stateful parent — the real wiring, where
 * a change re-renders the step — because a `vi.fn()` for `updateFormData` never
 * re-renders anything and so cannot see this class of defect at all.
 */

import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Step4_Violations from './Step4_Violations';

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1' } }),
}));

vi.mock('@features/driver-app/hooks/useApplicationAgreements', () => ({
    useApplicationAgreements: () => ({
        agreements: [], agreementVersion: null, loading: false, error: null, retry: vi.fn(),
    }),
}));

vi.mock('@features/driver-app/hooks/useApplicationRules', () => ({
    useStepGate: () => ({
        rules: {}, blocking: [], attempted: false,
        issuesRef: { current: null }, refuseIfBlocked: () => false,
    }),
}));

/** The step wired to real state, so a keystroke re-renders it as it does in the wizard. */
function Harness({ initial }) {
    const [formData, setFormData] = useState(initial);
    const updateFormData = (name, value) => setFormData((prev) => ({ ...prev, [name]: value }));
    return (
        <form id="driver-form">
            <Step4_Violations
                formData={formData}
                updateFormData={updateFormData}
                onNavigate={vi.fn()}
                onPartialSubmit={vi.fn()}
            />
        </form>
    );
}

const DISCLOSURES = [
    ['revoked-licenses', 'revocation-explanation'],
    ['driving-convictions', 'conviction-explanation'],
    ['drug-alcohol-convictions', 'drug-conviction-explanation'],
];

describe('the disclosure explanation box', () => {
    it.each(DISCLOSURES)('keeps focus while the driver types after answering %s yes', async (question, boxId) => {
        const user = userEvent.setup();
        render(<Harness initial={{ [question]: 'yes' }} />);

        const box = document.getElementById(boxId);
        expect(box).not.toBeNull();

        await user.click(box);
        await user.keyboard('Suspended in 2019');

        // The whole sentence landed, and the caret never left the box. Before the
        // fix the element was replaced on each keystroke, so both of these failed.
        expect(document.getElementById(boxId).value).toBe('Suspended in 2019');
        expect(document.activeElement).toBe(document.getElementById(boxId));
    });

    it('keeps the very same textarea element across keystrokes, rather than replacing it', async () => {
        const user = userEvent.setup();
        render(<Harness initial={{ 'revoked-licenses': 'yes' }} />);

        const before = document.getElementById('revocation-explanation');
        await user.click(before);
        await user.keyboard('abc');

        // Identity, not just value: a remount would satisfy a value check on the
        // rebuilt node while still having thrown the caret out.
        expect(document.getElementById('revocation-explanation')).toBe(before);
    });

    it('shows no explanation box until the answer is yes', () => {
        render(<Harness initial={{ 'revoked-licenses': 'no' }} />);
        expect(document.getElementById('revocation-explanation')).toBeNull();
    });

    it('writes the typed explanation under its own field name', async () => {
        const user = userEvent.setup();
        render(<Harness initial={{ 'driving-convictions': 'yes' }} />);

        await user.click(document.getElementById('conviction-explanation'));
        await user.keyboard('Expired licence, dismissed');

        // The name the wizard persists, not the element id.
        expect(screen.getByDisplayValue('Expired licence, dismissed').getAttribute('name'))
            .toBe('convictionExplanation');
    });
});
