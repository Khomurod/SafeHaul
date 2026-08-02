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
    vi.clearAllMocks();
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

    it('defaults every field to Approve and keeps decisions mutually exclusive', async () => {
        renderPortal();
        await screen.findByText('First Name');
        const group = screen.getByRole('group', { name: /First Name/i });
        expect(within(group).getByRole('button', { name: /approve/i })).toHaveAttribute('aria-pressed', 'true');
        expect(within(group).getByRole('button', { name: /reject/i })).toHaveAttribute('aria-pressed', 'false');

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

    it('submits the exact approve-default payload in pending order', async () => {
        renderPortal();
        await screen.findByText('First Name');
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
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Could not submit your review. Please try again.');
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
