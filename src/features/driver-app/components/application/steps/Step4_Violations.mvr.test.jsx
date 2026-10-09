/**
 * The MVR authorization never leaves the driver without a way on.
 *
 * A Yes accepts the authorization's wording and is recorded with its version, so
 * it waits until that wording is on screen. Both answers used to wait: while the
 * wording loaded, or after it failed to, neither could be chosen, a required
 * question could not be answered, and an optional one was skipped unanswered
 * (the browser does not check a question whose every choice is switched off).
 */
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Step4_Violations from './Step4_Violations';

const wording = vi.hoisted(() => ({ current: null }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: { id: 'co-1' } }),
}));

vi.mock('@features/driver-app/hooks/useApplicationAgreements', () => ({
    useApplicationAgreements: () => wording.current,
}));

vi.mock('@features/driver-app/hooks/useApplicationRules', () => ({
    useStepGate: () => ({
        rules: {}, blocking: [], attempted: false,
        issuesRef: { current: null }, refuseIfBlocked: () => false,
    }),
}));

const MVR = { key: 'mvrAuthorization', presentedOn: 'drivingRecord', title: 'MVR Authorization', body: 'I authorize…', version: 'v2' };
const LOADING = { agreements: [], agreementVersion: null, loading: true, error: null, retry: vi.fn() };
const FAILED = {
    agreements: [], agreementVersion: null, loading: false, retry: vi.fn(),
    error: 'The required agreements could not be loaded. Check your internet connection, then press Try again.',
};
const LOADED = { agreements: [MVR], agreementVersion: 'v2', loading: false, error: null, retry: vi.fn() };

// The step's other questions, answered, so only the authorization is in play.
const ANSWERED = { 'revoked-licenses': 'no', 'driving-convictions': 'no', 'drug-alcohol-convictions': 'no', 'has-violations': 'no' };

function renderStep(initial = ANSWERED) {
    const onNavigate = vi.fn();
    const answers = { current: initial };
    function Harness() {
        const [formData, setFormData] = useState(initial);
        const updateFormData = (name, value) => setFormData((prev) => {
            answers.current = { ...prev, [name]: value };
            return answers.current;
        });
        return (
            <form id="driver-form">
                <Step4_Violations formData={formData} updateFormData={updateFormData} onNavigate={onNavigate} onPartialSubmit={vi.fn()} />
            </form>
        );
    }
    render(<Harness />);
    return { onNavigate, answers };
}

/** The authorization's own Yes or No, by its frozen id (the step asks other Yes/No questions too). */
const authorization = (answer) => document.getElementById(`consent-mvr-${answer.toLowerCase()}`);

beforeEach(() => {
    wording.current = LOADED;
});

describe('the MVR authorization', () => {
    it('while its wording loads, offers No but not yet Yes', async () => {
        wording.current = LOADING;
        const { answers } = renderStep();

        expect(authorization('Yes')).toBeDisabled();
        expect(authorization('No')).toBeEnabled();

        await userEvent.setup().click(authorization('No'));
        expect(answers.current['consent-mvr']).toBe('no');
        expect(answers.current.agreementAcceptances?.mvrAuthorization).toBeUndefined();
    });

    it('cannot be skipped unanswered while its wording loads', () => {
        wording.current = LOADING;
        renderStep();

        // A browser's form check now meets an open, required, unanswered choice.
        // Asked of the element: happy-dom's form-level check passes over a group
        // whose first choice is switched off, which a browser does not.
        expect(authorization('No').willValidate).toBe(true);
        expect(authorization('No').validity.valueMissing).toBe(true);
    });

    it('when its wording failed, sends Continue to Try again rather than past the question', async () => {
        wording.current = FAILED;
        const { onNavigate } = renderStep();

        await userEvent.setup().click(screen.getByRole('button', { name: /continue/i }));

        expect(onNavigate).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    });

    it('when its wording failed, still lets the driver decline and go on', async () => {
        wording.current = FAILED;
        const { onNavigate, answers } = renderStep();
        const user = userEvent.setup();

        await user.click(authorization('No'));
        await user.click(screen.getByRole('button', { name: /continue/i }));

        expect(answers.current['consent-mvr']).toBe('no');
        expect(onNavigate).toHaveBeenCalledWith('next');
    });

    it('once its wording is on screen, records a Yes with that wording\'s version', async () => {
        const { answers } = renderStep();

        await userEvent.setup().click(authorization('Yes'));

        expect(answers.current['consent-mvr']).toBe('yes');
        expect(answers.current.agreementAcceptances.mvrAuthorization).toMatchObject({ accepted: true, version: 'v2' });
    });
});
