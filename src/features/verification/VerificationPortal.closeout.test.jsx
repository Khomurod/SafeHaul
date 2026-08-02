/**
 * Closeout coverage for the public verification portal.
 *
 * `VerificationPortal.test.jsx` (2026-07-23) froze the token load, the
 * conditional reveals, the submit payload and the status screens, and it mocks
 * `SignaturePad` away. This file covers what that slice left open and what this
 * campaign changed:
 *
 *  - the validation summary's wording,
 *  - duplicate-submit prevention through *implicit* form submission,
 *  - the real `SignaturePad` wired into the real form, including error
 *    association and the resize invariant end-to-end,
 *  - the remaining conditional sections,
 *  - axe with the error state on screen.
 *
 * Artificial data only — no real tokens, drivers or employers.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({
    getVerificationRequest: vi.fn(),
    submitVerificationResponse: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: false,
    getE2EQueryParam: () => '',
}));

// The real SignaturePad is used here. happy-dom has no 2D canvas, so stub it.
const ctxStub = {
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), clearRect: vi.fn(),
};

import { VerificationPortal } from './VerificationPortal';

const VALID = {
    status: 'pending',
    applicantName: 'Artificial Applicant',
    companyName: 'Artificial Requesting Carrier',
    employmentStartDate: '2020-02-02',
    employmentEndDate: '2023-03-03',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

let canvasRect;

beforeEach(() => {
    callables.getVerificationRequest.mockReset();
    callables.submitVerificationResponse.mockReset();
    callables.getVerificationRequest.mockResolvedValue({ data: VALID });
    callables.submitVerificationResponse.mockResolvedValue({ data: { ok: true } });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    canvasRect = { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 };
    window.HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub);
    window.HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,DRAWN');
    window.HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => canvasRect);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function renderPortal(token = 'token-xyz') {
    return render(
        <MemoryRouter initialEntries={[`/verify/${token}`]}>
            <Routes>
                <Route path="/verify/:token" element={<VerificationPortal />} />
            </Routes>
        </MemoryRouter>,
    );
}

async function renderLoadedForm(token) {
    const utils = renderPortal(token);
    await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i });
    return utils;
}

const signOnCanvas = (container) => {
    const canvas = container.querySelector('canvas');
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 40, clientY: 40 });
    fireEvent.mouseUp(canvas);
    return canvas;
};

/** Fill the minimum valid "not employed" response. */
function fillMinimalValidResponse(container) {
    fireEvent.click(screen.getByRole('radio', { name: 'No / No Record Found' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Your Full Name/i }), {
        target: { value: 'Artificial Respondent' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Your Title \/ Position/i }), {
        target: { value: 'HR Manager' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Phone Number/i }), {
        target: { value: '555-000-1111' },
    });
    signOnCanvas(container);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validation summary', () => {
    it('names each failing field by its on-page label, not its state key', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        const text = summary.textContent;

        expect(text).toContain('Was this individual employed by your company?');
        expect(text).toContain('Your Full Name');
        expect(text).toContain('Your Title / Position');
        expect(text).toContain('Phone Number');
        expect(text).toContain('Electronic Signature');

        // The old camelCase-split rendering is gone.
        expect(text).not.toContain('was Employed');
        expect(text).not.toContain('signature Data');
        expect(text).not.toContain('respondent Name');
    });

    it('keeps the frozen validation messages verbatim', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Required');
        expect(summary.textContent).toContain('Please provide your electronic signature');
    });

    it('lists the employment sub-field failures once employment is confirmed', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Confirmed Start Date');
        expect(summary.textContent).toContain('Position / Title Held');
        expect(summary.textContent).toContain('Reason for Leaving');
        expect(summary.textContent).toContain('Federal Motor Carrier Safety Regulations');
    });

    it('drops an entry as soon as that field is corrected', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Your Full Name');

        fireEvent.change(screen.getByRole('textbox', { name: /Your Full Name/i }), {
            target: { value: 'Artificial Respondent' },
        });

        await waitFor(() => expect(
            screen.getByText('Please fix the following errors:').closest('[role="alert"]').textContent,
        ).not.toContain('Your Full Name'));
    });
});

describe('duplicate submission', () => {
    it('sends exactly one callable when the form is submitted twice in the same tick', async () => {
        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);

        const form = container.querySelector('form');
        // Implicit submission: pressing Enter in a text field fires this even
        // while the submit Button is disabled by its `loading` state.
        fireEvent.submit(form);
        fireEvent.submit(form);

        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalled());
        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);
    });

    it('sends exactly one callable when submission is retried while in flight', async () => {
        let release;
        callables.submitVerificationResponse.mockImplementation(
            () => new Promise((resolve) => { release = () => resolve({ data: { ok: true } }); }),
        );

        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);
        const form = container.querySelector('form');

        fireEvent.submit(form);
        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1));

        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);

        release();
        expect(await screen.findByText('Verification Submitted Successfully')).toBeInTheDocument();
        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);
    });

    it('disables the submit control while the response is in flight', async () => {
        let release;
        callables.submitVerificationResponse.mockImplementation(
            () => new Promise((resolve) => { release = () => resolve({ data: { ok: true } }); }),
        );

        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        await waitFor(() => expect(screen.getByRole('button', { name: /Submitting/i })).toBeDisabled());
        release();
        await screen.findByText('Verification Submitted Successfully');
    });
});

describe('signature integration', () => {
    it('submits the PNG produced by drawing on the real pad', async () => {
        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalled());
        expect(callables.submitVerificationResponse.mock.calls[0][0].response.signatureData)
            .toBe('data:image/png;base64,DRAWN');
    });

    it('associates the signature validation error with the drawing surface', async () => {
        const { container } = await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
        await screen.findByText('Please fix the following errors:');

        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('aria-invalid', 'true');

        const described = (canvas.getAttribute('aria-describedby') || '')
            .split(' ')
            .map((id) => container.querySelector(`#${id}`)?.textContent)
            .join(' ');
        expect(described).toContain('Please provide your electronic signature');
        // The drawing instructions stay associated alongside the error.
        expect(described).toContain('By signing, you certify that the information provided is true and accurate.');
    });

    it('clears the signature requirement again when the pad is cleared', async () => {
        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);

        fireEvent.click(screen.getByRole('button', { name: /clear signature/i }));
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Please provide your electronic signature');
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
    });

    it('does not submit a signature the respondent can no longer see after a resize', async () => {
        const { container } = await renderLoadedForm();
        fillMinimalValidResponse(container);

        // Rotate the device. This environment cannot carry the bitmap over, so
        // the pad must clear itself and withdraw the stored PNG.
        canvasRect = { ...canvasRect, width: 700, right: 700 };
        fireEvent(window, new Event('orientationchange'));

        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Please provide your electronic signature');
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
        expect(screen.getByText('Draw your signature here')).toBeInTheDocument();
    });
});

describe('conditional sections', () => {
    it('reveals violation details and return-to-duty only after a reported violation', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));

        const dotGroup = screen.getByRole('group', { name: /DOT drug & alcohol testing/i });
        fireEvent.click(within(dotGroup).getByRole('radio', { name: 'Yes' }));

        expect(screen.queryByRole('textbox', { name: /Violation Details/i })).not.toBeInTheDocument();

        const violationGroup = screen.getByRole('group', { name: /DOT drug or alcohol violations/i });
        fireEvent.click(within(violationGroup).getByRole('radio', { name: 'Yes' }));

        expect(screen.getByRole('textbox', { name: /Violation Details/i })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: /return-to-duty process/i })).toBeInTheDocument();
    });

    it('offers the three return-to-duty options with their frozen values', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
        fireEvent.click(within(screen.getByRole('group', { name: /DOT drug & alcohol testing/i }))
            .getByRole('radio', { name: 'Yes' }));
        fireEvent.click(within(screen.getByRole('group', { name: /DOT drug or alcohol violations/i }))
            .getByRole('radio', { name: 'Yes' }));

        const rtd = screen.getByRole('group', { name: /return-to-duty process/i });
        ['Yes', 'No', 'In Progress'].forEach((name) => {
            expect(within(rtd).getByRole('radio', { name })).toBeInTheDocument();
        });
    });

    it('reveals accident details only after a reported accident', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));

        expect(screen.queryByRole('textbox', { name: /Accident Details/i })).not.toBeInTheDocument();

        const accidents = screen.getByRole('group', { name: /DOT-recordable accidents/i });
        fireEvent.click(within(accidents).getByRole('radio', { name: 'Yes' }));

        expect(screen.getByRole('textbox', { name: /Accident Details/i })).toBeInTheDocument();
    });

    it('hides the whole safety section again when employment is withdrawn', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
        expect(screen.getByRole('group', { name: /Federal Motor Carrier Safety Regulations/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'No / No Record Found' }));
        expect(screen.queryByRole('group', { name: /Federal Motor Carrier Safety Regulations/i })).not.toBeInTheDocument();
    });
});

describe('portal presentation', () => {
    it('carries no raw palette classes in the page chrome', async () => {
        const { container } = await renderLoadedForm();
        const offenders = [...container.querySelectorAll('header, header *, form, form > *')]
            .map((el) => el.getAttribute('class') || '')
            .filter((c) => /(^|\s)(bg|text|border)-(gray|slate|blue|red|green|zinc|neutral)-\d{2,3}(\s|$)/.test(c));
        expect(offenders).toEqual([]);
    });

    it('keeps the regulatory notice and certification wording verbatim', async () => {
        await renderLoadedForm();
        expect(screen.getByText(/prospective employers of commercial motor vehicle/i)).toBeInTheDocument();
        expect(screen.getByText(/Previous employers must respond within/i)).toBeInTheDocument();
        expect(screen.getByText(/I certify that I am authorized to provide this/i)).toBeInTheDocument();
        expect(screen.getByText('FMCSA 49 CFR Part 391.23 Compliance')).toBeInTheDocument();
    });

    it('shows the verification token in the footer', async () => {
        await renderLoadedForm('token-abc');
        expect(screen.getByText(/Secure verification ID:\s*token-abc/)).toBeInTheDocument();
    });

    it('has no axe violations while the validation summary is displayed', async () => {
        const { container } = await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
        await screen.findByText('Please fix the following errors:');

        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no axe violations with every conditional section expanded', async () => {
        const { container } = await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
        fireEvent.click(within(screen.getByRole('group', { name: /DOT drug & alcohol testing/i }))
            .getByRole('radio', { name: 'Yes' }));
        fireEvent.click(within(screen.getByRole('group', { name: /DOT drug or alcohol violations/i }))
            .getByRole('radio', { name: 'Yes' }));
        fireEvent.click(within(screen.getByRole('group', { name: /DOT-recordable accidents/i }))
            .getByRole('radio', { name: 'Yes' }));

        expect((await axe(container)).violations).toEqual([]);
    });
});
