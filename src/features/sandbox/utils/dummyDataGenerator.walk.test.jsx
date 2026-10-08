// Magic Fill, page by page, the way the owner's pre-release walk uses it.
//
// `docs/RELEASE_CHECKLIST.md` walks the sandbox application by pressing 🧪 Magic
// Fill Step on every page. The patches had fallen behind the pages: the licence
// page was given keys it does not read (`cdl-class`, `licenseNumber`) and dates
// in a shape no date field takes, nothing answered the SSN or the licence
// disclosures, and the employer's dates were objects, so the walk stopped on the
// first page. These render each real page with the sandbox company's own
// settings, fill it the way the button does, and press Continue.

import React, { useEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Step1_Contact from '@features/driver-app/components/application/steps/Step1_Contact';
import Step2_Qualifications from '@features/driver-app/components/application/steps/Step2_Qualifications';
import Step3_License from '@features/driver-app/components/application/steps/Step3_License';
import Step4_Violations from '@features/driver-app/components/application/steps/Step4_Violations';
import Step5_Accidents from '@features/driver-app/components/application/steps/Step5_Accidents';
import Step6_Employment from '@features/driver-app/components/application/steps/Step6_Employment';
import Step7_General from '@features/driver-app/components/application/steps/Step7_General';
import Step8_Review from '@features/driver-app/components/application/steps/Step8_Review';
import { buildDefaultSandboxPublicProfile } from '../sandboxConstants';
import { getMagicFillPatchForStep } from './dummyDataGenerator';

const sandbox = vi.hoisted(() => ({ profile: null, toasts: [] }));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: sandbox.profile }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showError: (message) => sandbox.toasts.push(message) }),
}));
// The agreement set the live registry serves, MVR authorization included, so the
// Motor Vehicle Record page asks its question as it does on the sandbox.
vi.mock('@features/driver-app/hooks/useApplicationAgreements', async () => {
    const { E2E_AGREEMENTS, E2E_AGREEMENT_VERSION } = await import('@features/driver-app/hooks/e2eAgreementFixtures');
    return {
        useApplicationAgreements: () => ({
            agreements: E2E_AGREEMENTS, agreementVersion: E2E_AGREEMENT_VERSION, loading: false, error: null, retry: () => {},
        }),
    };
});
// Nothing here may reach a server: a stored file's preview, say, fails at once.
vi.mock('firebase/functions', async (importOriginal) => ({
    ...(await importOriginal()),
    httpsCallable: () => async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); },
}));

const PAGES = [
    ['contact', Step1_Contact],
    ['qualifications', Step2_Qualifications],
    ['license', Step3_License],
    ['violations', Step4_Violations],
    ['accidents', Step5_Accidents],
    ['employment', Step6_Employment],
    ['general', Step7_General],
    ['review', Step8_Review],
];

/** One page of the wizard, its answers in state, and the sandbox's Magic Fill button. */
function Page({ Component, index, initial, onAnswers, onNavigate }) {
    const [formData, setFormData] = useState(initial);
    const updateFormData = (name, value) => setFormData((prev) => ({
        ...prev,
        [name]: typeof value === 'function' ? value(prev[name]) : value,
    }));
    useEffect(() => { onAnswers(formData); }, [formData, onAnswers]);
    const magicFill = () => setFormData((prev) => ({
        ...prev, ...getMagicFillPatchForStep(index),
    }));
    return (
        <form id="driver-form">
            <button type="button" onClick={magicFill}>Magic Fill Step</button>
            <Component
                formData={formData}
                updateFormData={updateFormData}
                onNavigate={onNavigate}
                onPartialSubmit={() => {}}
                handleFileUpload={async () => null}
                isUploading={false}
            />
        </form>
    );
}

/** The required controls a browser would refuse, by the browser's own rules. */
function unanswered(form) {
    const controls = [...form.querySelectorAll('input, select, textarea')];
    const missing = controls.filter((control) => {
        if (!control.required || control.disabled) return false;
        if (control.type === 'radio') {
            return !controls.some((other) => other.type === 'radio' && other.name === control.name && other.checked);
        }
        if (control.type === 'checkbox') return !control.checked;
        return String(control.value ?? '').trim() === '';
    }).map((control) => (control.type === 'radio' ? control.name : control.id || control.name));
    const malformed = controls
        .filter((control) => control.type === 'email' && control.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(control.value))
        .map((control) => control.id || control.name);
    return [...new Set([...missing, ...malformed])];
}

/** Walks pages 1–8: Magic Fill, the applicant's own answers, Continue. */
function walk() {
    let answers = {};
    const pages = [];
    PAGES.forEach(([semanticStep, Component], index) => {
        const onNavigate = vi.fn();
        sandbox.toasts = [];
        const view = render(
            <Page
                Component={Component}
                index={index}
                initial={answers}
                onAnswers={(next) => { answers = next; }}
                onNavigate={onNavigate}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Magic Fill Step' }));
        // The applicant's own act, which Magic Fill leaves to them: a Yes to the MVR
        // authorization is an acceptance of the wording on screen.
        if (semanticStep === 'violations') fireEvent.click(document.getElementById('consent-mvr-yes'));
        const missing = unanswered(document.getElementById('driver-form'));
        fireEvent.click(screen.getByRole('button', { name: semanticStep === 'review' ? /Confirm & Proceed/ : 'Continue' }));
        const alerts = screen.queryAllByRole('alert').map((node) => node.textContent.trim()).filter(Boolean);
        pages.push({
            semanticStep,
            missing,
            refusals: [...sandbox.toasts, ...alerts],
            continued: onNavigate.mock.calls.some(([direction]) => direction === 'next'),
        });
        view.unmount();
    });
    return { pages, answers };
}

const passed = (semanticStep) => ({ semanticStep, missing: [], refusals: [], continued: true });

describe('Magic Fill on the sandbox application', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        Element.prototype.scrollIntoView = vi.fn();
        sandbox.profile = buildDefaultSandboxPublicProfile();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['today', '2026-10-08T15:00:00Z'],
        ['in January, years on', '2031-01-02T15:00:00Z'],
    ])('fills every page up to the agreements so Continue goes on (%s)', (_label, now) => {
        vi.setSystemTime(new Date(now));
        const { pages } = walk();
        expect(pages).toEqual(PAGES.map(([semanticStep]) => passed(semanticStep)));
    });

    it('answers under the names the pages read, and a Yes the applicant gives keeps its evidence', () => {
        vi.setSystemTime(new Date('2026-10-08T15:00:00Z'));
        const { answers } = walk();
        expect(answers).toMatchObject({
            ssn: '123-45-6789',
            cdlClass: 'Class A',
            cdlNumber: 'TX12345678',
            cdlExpiration: '2028-12-31',
            'has-other-licenses': 'no',
            'has-twic': 'no',
            'revoked-licenses': 'no',
            'driving-convictions': 'no',
            'drug-alcohol-convictions': 'no',
            'consent-mvr': 'yes',
            agreementAcceptances: { mvrAuthorization: { accepted: true, version: 'e2e-fixture' } },
        });
        // The employer covers the past three years, so the page has nothing to ask.
        expect(answers.employers[0]).toMatchObject({ startDate: '2021-01', endDate: '2026-10' });
        for (const stale of ['cdl-class', 'licenseNumber', 'cdlIssue', 'employment-gap', 'customQuestionResponses']) {
            expect(answers).not.toHaveProperty(stale);
        }
    });
});
