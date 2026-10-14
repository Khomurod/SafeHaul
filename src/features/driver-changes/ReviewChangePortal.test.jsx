import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

// Artificial data only — no real tokens or applicant information.
const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (_f, name) => (...a) => mockCallable(name, ...a) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));

import { ReviewChangePortal } from './ReviewChangePortal';

const REVIEW = {
    data: {
        applicantName: 'John Doe',
        status: 'open',
        changes: [
            { fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' },
            { fieldKey: 'city', fieldLabel: 'City', originalValue: 'Reno', proposedValue: 'Sparks', status: 'pending' },
        ],
    },
};

function reviewWith(changes, extra = {}) {
    return { data: { applicantName: 'John Doe', status: 'open', changes, ...extra } };
}

function loadResolves(response) {
    mockCallable.mockImplementation((name) => {
        if (name === 'getChangeReview') return Promise.resolve(response);
        return Promise.resolve({ data: { success: true, completed: true } });
    });
}

/** A callable failure as the web SDK delivers it: the code, and the server's sentence or the bare code. */
const callableError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

/** Press one decision for a change, by the change's label. */
function decide(fieldName, action) {
    const group = screen.getByRole('group', { name: new RegExp(`Decision for ${fieldName}`, 'i') });
    fireEvent.click(within(group).getByRole('button', { name: new RegExp(`^${action}$`, 'i') }));
}

function renderPortal(token = 'tok-1') {
    return render(
        <MemoryRouter initialEntries={[`/review-change/${token}`]}>
            <Routes>
                <Route path="/review-change/:token" element={<ReviewChangePortal />} />
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    loadResolves(REVIEW);
});

describe('ReviewChangePortal', () => {
    it('reads the token from the route and requests getChangeReview, showing loading first', async () => {
        renderPortal('tok-1');
        expect(screen.getByRole('status')).toHaveTextContent('Loading…');
        await waitFor(() => expect(screen.getByText('First Name')).toBeInTheDocument());
        expect(mockCallable).toHaveBeenCalledWith('getChangeReview', { token: 'tok-1' });
    });

    it('renders exactly one h1 across the header', async () => {
        renderPortal();
        await screen.findByText('First Name');
        const h1s = screen.getAllByRole('heading', { level: 1 });
        expect(h1s).toHaveLength(1);
        expect(h1s[0]).toHaveTextContent('Review changes to your application');
    });

    it('does not render the applicant name on the public link', async () => {
        renderPortal();
        await screen.findByText('First Name');
        expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    });

    it('shows only pending changes with before → after values', async () => {
        loadResolves(reviewWith([
            { fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' },
            { fieldKey: 'lastName', fieldLabel: 'Last Name', originalValue: 'Doe', proposedValue: 'Doer', status: 'approved' },
        ]));
        renderPortal();
        await screen.findByText('First Name');
        expect(screen.getByText('Jonathan')).toBeInTheDocument();
        expect(screen.queryByText('Last Name')).not.toBeInTheDocument();
    });

    it('previews empty, array, and object proposed values without exposing contents', async () => {
        loadResolves(reviewWith([
            { fieldKey: 'suffix', fieldLabel: 'Suffix', originalValue: 'Jr', proposedValue: '', status: 'pending' },
            { fieldKey: 'endorsements', fieldLabel: 'Endorsements', originalValue: 'CDL-A', proposedValue: ['A', 'B', 'C'], status: 'pending' },
            { fieldKey: 'address', fieldLabel: 'Address', originalValue: '123 Main', proposedValue: { a: 1, b: 2 }, status: 'pending' },
        ]));
        renderPortal();
        await screen.findByText('Suffix');
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.getByText('3 item(s)')).toBeInTheDocument();
        expect(screen.getByText('(updated)')).toBeInTheDocument();
        // Edit is unavailable for non-scalar changes.
        const arrayGroup = screen.getByRole('group', { name: /Endorsements/i });
        expect(within(arrayGroup).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    });

    it('shows the no-changes state for a completed review with no pending changes', async () => {
        loadResolves(reviewWith(
            [{ fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'approved' }],
            { status: 'completed' },
        ));
        renderPortal();
        await waitFor(() => expect(screen.getByText('There are no changes left to review.')).toBeInTheDocument());
    });

    it('starts with no decision on any change, and keeps decisions mutually exclusive', async () => {
        renderPortal();
        await screen.findByText('First Name');
        const group = screen.getByRole('group', { name: /First Name/i });
        for (const name of [/approve/i, /reject/i, /edit/i]) {
            expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
        }

        fireEvent.click(within(group).getByRole('button', { name: /approve/i }));
        expect(within(group).getByRole('button', { name: /approve/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(within(group).getByRole('button', { name: /reject/i }));
        expect(within(group).getByRole('button', { name: /reject/i })).toHaveAttribute('aria-pressed', 'true');
        expect(within(group).getByRole('button', { name: /approve/i })).toHaveAttribute('aria-pressed', 'false');
    });

    it('reveals a labelled corrected-value input only when Edit is chosen', async () => {
        renderPortal();
        await screen.findByText('First Name');
        expect(screen.queryByLabelText(/Corrected value for First Name/i)).not.toBeInTheDocument();

        const group = screen.getByRole('group', { name: /First Name/i });
        fireEvent.click(within(group).getByRole('button', { name: /edit/i }));
        const input = screen.getByLabelText(/Corrected value for First Name/i);
        expect(input).toHaveAttribute('placeholder', 'Enter the correct value');
    });

    it('submits the decisions made, in pending order', async () => {
        renderPortal();
        await screen.findByText('First Name');
        decide('City', 'Approve');
        decide('First Name', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        await waitFor(() => expect(mockCallable).toHaveBeenCalledWith('submitChangeResolution', {
            token: 'tok-1',
            resolutions: [
                { fieldKey: 'firstName', action: 'approve' },
                { fieldKey: 'city', action: 'approve' },
            ],
        }));
        await waitFor(() => expect(screen.getByText(/Thank you/i)).toBeInTheDocument());
    });

    it('submits per-field resolutions (edit-final and reject) in order', async () => {
        renderPortal();
        await screen.findByText('First Name');

        const firstNameGroup = screen.getByRole('group', { name: /First Name/i });
        fireEvent.click(within(firstNameGroup).getByRole('button', { name: /edit/i }));
        fireEvent.change(screen.getByLabelText(/Corrected value for First Name/i), { target: { value: 'Johnny' } });

        const cityGroup = screen.getByRole('group', { name: /City/i });
        fireEvent.click(within(cityGroup).getByRole('button', { name: /reject/i }));

        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        await waitFor(() => expect(mockCallable).toHaveBeenCalledWith('submitChangeResolution', {
            token: 'tok-1',
            resolutions: [
                { fieldKey: 'firstName', action: 'edit', value: 'Johnny' },
                { fieldKey: 'city', action: 'reject' },
            ],
        }));
        await waitFor(() => expect(screen.getByText(/Thank you/i)).toBeInTheDocument());
    });

    it('disables the submit control and announces while submitting', async () => {
        let resolveSubmit;
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(REVIEW);
            return new Promise((resolve) => { resolveSubmit = resolve; });
        });
        renderPortal();
        await screen.findByText('First Name');
        decide('First Name', 'Approve');
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        await waitFor(() => expect(screen.getByRole('button', { name: /Submit my responses/i })).toBeDisabled());
        expect(screen.getAllByRole('status').some((n) => n.textContent.includes('Submitting your responses'))).toBe(true);

        resolveSubmit({ data: { success: true } });
        await waitFor(() => expect(screen.getByText(/Thank you/i)).toBeInTheDocument());
    });

    it('shows the backend error message on an invalid/expired link', async () => {
        mockCallable.mockImplementationOnce(() => Promise.reject(new Error('This review link has expired.')));
        renderPortal();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This review link has expired.');
    });

    it('falls back to the generic load error when no message is present', async () => {
        mockCallable.mockImplementationOnce(() => Promise.reject({ code: 'x' }));
        renderPortal();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This review link is invalid or has expired.');
    });

    it('falls back to the generic submission error when submit fails with no message', async () => {
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(REVIEW);
            return Promise.reject({ code: 'x' });
        });
        renderPortal();
        await screen.findByText('First Name');
        decide('First Name', 'Approve');
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Your responses were not sent. Your choices are still on this page: check your connection and try again.',
        );
    });

    it('does not update state after unmount (cancellation guard)', async () => {
        let resolveLoad;
        mockCallable.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { unmount } = renderPortal();
        unmount();
        resolveLoad(REVIEW);
        await Promise.resolve();
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('has no accessibility violations in the loaded review', async () => {
        const { container } = renderPortal();
        await screen.findByText('First Name');
        expect((await axe(container)).violations).toEqual([]);
    });
});

/**
 * The employment history, as the driver is asked to approve it.
 *
 * Before 2026-09-09 employers could not be edited at all, so this change never
 * appeared here. It does now, and the generic array preview renders "N item(s)" —
 * which asked a driver to approve **"2 item(s) → 1 item(s)"** with no way to tell
 * which employer had gone.
 */
describe('an employers change', () => {
    const ABC = { employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking', startDate: '2020-01', endDate: '2022-06' };
    const XYZ = { employerId: 'bbbbbbbbbbbb', companyName: 'XYZ Transport', startDate: '2022-07' };

    const employersChange = (proposedValue) => reviewWith([{
        fieldKey: 'employers',
        fieldLabel: 'Employment History',
        originalValue: [ABC, XYZ],
        proposedValue,
        status: 'pending',
    }]);

    it('names the employer being removed instead of counting items', async () => {
        loadResolves(employersChange([XYZ]));
        renderPortal();

        expect(await screen.findByText('Removed')).toBeInTheDocument();
        expect(screen.getByText('ABC Trucking')).toBeInTheDocument();
        expect(screen.queryByText(/item\(s\)/)).not.toBeInTheDocument();
    });

    it('shows which fields moved on an employer that was corrected', async () => {
        loadResolves(employersChange([{ ...ABC, endDate: '2022-08' }, XYZ]));
        renderPortal();

        expect(await screen.findByText(/To:/)).toBeInTheDocument();
        expect(screen.getByText('2022-06')).toBeInTheDocument();
        expect(screen.getByText('2022-08')).toBeInTheDocument();
    });

    it('offers approve and reject but not Edit, because a list is not a text box', async () => {
        loadResolves(employersChange([XYZ]));
        renderPortal();

        await screen.findByText('Removed');
        const decision = screen.getByRole('group', { name: /Decision for Employment History/i });
        expect(decision).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    });

    it('sends a plain approve, with no value of its own', async () => {
        loadResolves(employersChange([XYZ]));
        renderPortal();
        await screen.findByText('Removed');

        decide('Employment History', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        await waitFor(() => expect(mockCallable).toHaveBeenCalledWith('submitChangeResolution', {
            token: 'tok-1',
            resolutions: [{ fieldKey: 'employers', action: 'approve' }],
        }));
    });
});

/**
 * Nothing is approved by itself, and nothing chosen is lost.
 *
 * Every change used to start on Approve, so Submit approved whatever the driver
 * had not looked at, and a reload put every Reject and Edit back to Approve. A
 * failed submission replaced the choices with its error, and a reload was the
 * only way back to them.
 */
describe('decisions are the driver\'s own', () => {
    it('sends nothing while a change has no decision, and names the ones left', async () => {
        renderPortal();
        await screen.findByText('First Name');
        decide('City', 'Reject');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('Choose a decision for each change');
        expect(notice).toHaveTextContent('Still to decide: First Name.');
        await waitFor(() => expect(notice).toHaveFocus());
        expect(mockCallable).not.toHaveBeenCalledWith('submitChangeResolution', expect.anything());

        decide('First Name', 'Approve');
        expect(screen.queryByText('Choose a decision for each change')).not.toBeInTheDocument();
    });

    it('starts every change undecided again after a reload', async () => {
        const first = renderPortal();
        await screen.findByText('First Name');
        decide('City', 'Reject');
        first.unmount();

        renderPortal();
        await screen.findByText('First Name');
        for (const fieldName of ['First Name', 'City']) {
            const group = screen.getByRole('group', { name: new RegExp(`Decision for ${fieldName}`, 'i') });
            expect(within(group).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
        }
    });

    it('keeps every choice when the responses are not sent, and Try again sends the same ones', async () => {
        let attempts = 0;
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(REVIEW);
            attempts += 1;
            return attempts === 1
                ? Promise.reject(callableError('internal', 'internal'))
                : Promise.resolve({ data: { success: true, completed: true } });
        });
        renderPortal();
        await screen.findByText('First Name');
        decide('First Name', 'Edit');
        fireEvent.change(screen.getByLabelText(/Corrected value for First Name/i), { target: { value: 'Johnny' } });
        decide('City', 'Reject');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Your responses were not sent.');
        expect(screen.getByLabelText(/Corrected value for First Name/i)).toHaveValue('Johnny');
        const city = screen.getByRole('group', { name: /Decision for City/i });
        expect(within(city).getByRole('button', { name: /reject/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByText(/Thank you/i)).toBeInTheDocument());
        const sent = mockCallable.mock.calls.filter(([name]) => name === 'submitChangeResolution');
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect(sent[0][1].resolutions).toEqual([
            { fieldKey: 'firstName', action: 'edit', value: 'Johnny' },
            { fieldKey: 'city', action: 'reject' },
        ]);
    });

    it("says the server's own reason, such as too many submissions, and keeps the choices", async () => {
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(REVIEW);
            return Promise.reject(callableError('resource-exhausted', 'Too many submissions. Please wait.'));
        });
        renderPortal();
        await screen.findByText('First Name');
        decide('First Name', 'Approve');
        decide('City', 'Reject');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('Too many submissions. Please wait.');
        expect(notice).toHaveTextContent('Your choices are still on this page');
        expect(screen.getByRole('button', { name: /Submit my responses/i })).toBeInTheDocument();
    });

    it('ends on the server\'s words when the link can no longer take answers', async () => {
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(REVIEW);
            return Promise.reject(callableError('failed-precondition', 'This review is already complete.'));
        });
        renderPortal();
        await screen.findByText('First Name');
        decide('First Name', 'Approve');
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('This review is already complete.');
        expect(screen.queryByRole('button', { name: /Submit my responses/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});
