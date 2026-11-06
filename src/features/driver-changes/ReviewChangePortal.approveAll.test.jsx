/**
 * Approve all, and what the review page says when its link does not work.
 *
 * Approve all is a decision the driver makes, never a default: it presses
 * Approve on every change, as the per-change Approve does, and sends through the
 * same submission as "Submit my responses" (one call; the server checks each
 * change and records them together or not at all). It is never offered over a
 * Reject or an Edit the driver chose. Artificial data only — no real tokens or
 * applicant information.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (_f, name) => (...a) => mockCallable(name, ...a) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));

import { ReviewChangePortal } from './ReviewChangePortal';

const FIRST_NAME = { fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' };
const CITY = { fieldKey: 'city', fieldLabel: 'City', originalValue: 'Reno', proposedValue: 'Sparks', status: 'pending' };
const PHONE = { fieldKey: 'phone', fieldLabel: 'Phone', originalValue: '5551112222', proposedValue: '5559998888', status: 'pending' };
const EMPLOYERS = {
    fieldKey: 'employers',
    fieldLabel: 'Employment History',
    originalValue: [{ employerId: 'aaaaaaaaaaaa', companyName: 'ABC Trucking' }],
    proposedValue: [],
    status: 'pending',
};

const review = (changes) => ({ data: { applicantName: 'John Doe', status: 'open', changes } });
const callableError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

/** The review loads `changes`; each submission gets the next of `answers` (the last repeats). */
function serve(changes, ...answers) {
    let submits = 0;
    mockCallable.mockImplementation((name) => {
        if (name === 'getChangeReview') return Promise.resolve(review(changes));
        const answer = answers.length ? answers[Math.min(submits, answers.length - 1)] : { data: { success: true, remaining: 0 } };
        submits += 1;
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
}

const submitted = () => mockCallable.mock.calls.filter(([name]) => name === 'submitChangeResolution');
const approveAll = () => screen.queryByRole('button', { name: /^Approve all/ });
const group = (fieldName) => screen.getByRole('group', { name: new RegExp(`Decision for ${fieldName}`, 'i') });

function decide(fieldName, action) {
    fireEvent.click(within(group(fieldName)).getByRole('button', { name: new RegExp(`^${action}$`, 'i') }));
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

/** Rendered, with the decision controls on screen (not just the masthead). */
async function renderLoaded(token) {
    const view = renderPortal(token);
    await screen.findByRole('group', { name: /Decision for First Name/i });
    return view;
}

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
    serve([FIRST_NAME, CITY]);
});

describe('the review names who proposed the changes', () => {
    it('says the company proposed them, not "your recruiter"', async () => {
        await renderLoaded();
        expect(screen.getByText(/The company you applied to proposed these changes\./)).toBeInTheDocument();
        expect(screen.queryByText(/recruiter/i)).not.toBeInTheDocument();
    });
});

describe('Approve all', () => {
    it('sends exactly what pressing Approve on each change and Submit sends', async () => {
        const oneByOne = await renderLoaded();
        decide('First Name', 'Approve');
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));
        await screen.findByText('Thank you!');
        oneByOne.unmount();

        await renderLoaded();
        fireEvent.click(approveAll());
        await screen.findByText('Thank you!');

        const [byEach, byAll] = submitted();
        expect(byAll).toEqual(byEach);
        expect(byAll[1]).toEqual({
            token: 'tok-1',
            resolutions: [
                { fieldKey: 'firstName', action: 'approve' },
                { fieldKey: 'city', action: 'approve' },
            ],
        });
    });

    it('names how many changes it approves and approves an employers change as it stands', async () => {
        serve([FIRST_NAME, EMPLOYERS, PHONE]);
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Approve all 3 changes' }));

        await screen.findByText('Thank you!');
        expect(submitted()[0][1].resolutions).toEqual([
            { fieldKey: 'firstName', action: 'approve' },
            { fieldKey: 'employers', action: 'approve' },
            { fieldKey: 'phone', action: 'approve' },
        ]);
        expect(submitted()).toHaveLength(1);
    });

    it('shows its progress and takes no second press while sending', async () => {
        let finish;
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') return Promise.resolve(review([FIRST_NAME, CITY]));
            return new Promise((resolve) => { finish = resolve; });
        });
        await renderLoaded();
        fireEvent.click(approveAll());

        await waitFor(() => expect(approveAll()).toHaveAttribute('aria-busy', 'true'));
        expect(approveAll()).toBeDisabled();
        expect(screen.getByRole('button', { name: /Submit my responses/i })).toBeDisabled();
        expect(screen.getAllByRole('status').some((n) => n.textContent === 'Approving all 2 changes…')).toBe(true);
        for (const fieldName of ['First Name', 'City']) {
            expect(within(group(fieldName)).getByRole('button', { name: /^approve$/i })).toHaveAttribute('aria-pressed', 'true');
        }
        fireEvent.click(approveAll());
        expect(submitted()).toHaveLength(1);

        finish({ data: { success: true, remaining: 0 } });
        expect(await screen.findByText('Thank you!')).toBeInTheDocument();
    });

    it('is not offered over a Reject or an Edit the driver chose, and returns once they are Approve again', async () => {
        await renderLoaded();
        expect(approveAll()).toHaveTextContent('Approve all 2 changes');

        decide('City', 'Reject');
        expect(approveAll()).not.toBeInTheDocument();
        decide('City', 'Edit');
        expect(approveAll()).not.toBeInTheDocument();
        decide('City', 'Approve');
        expect(approveAll()).toBeInTheDocument();
        // Approve on some changes already: Approve all still means every change.
        fireEvent.click(approveAll());
        await screen.findByText('Thank you!');
        expect(submitted()[0][1].resolutions.map((r) => r.action)).toEqual(['approve', 'approve']);
    });

    it('is not offered for a single change, which has its own Approve', async () => {
        serve([FIRST_NAME]);
        await renderLoaded();
        expect(approveAll()).not.toBeInTheDocument();
    });

    it('keeps every change approved when the send fails, and Try again sends the same approvals', async () => {
        serve([FIRST_NAME, CITY], callableError('internal', 'internal'), { data: { success: true, remaining: 0 } });
        await renderLoaded();
        fireEvent.click(approveAll());

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('Your responses were not sent. Your choices are still on this page');
        for (const fieldName of ['First Name', 'City']) {
            expect(within(group(fieldName)).getByRole('button', { name: /^approve$/i })).toHaveAttribute('aria-pressed', 'true');
        }

        fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText('Thank you!')).toBeInTheDocument();
        const [first, second] = submitted();
        expect(second).toEqual(first);
    });

    it('says plainly which changes are still waiting when more arrived while the page was open', async () => {
        let loads = 0;
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') {
                loads += 1;
                // The company proposed Phone after this page loaded.
                return Promise.resolve(loads === 1
                    ? review([FIRST_NAME, CITY])
                    : review([{ ...FIRST_NAME, status: 'approved' }, { ...CITY, status: 'approved' }, PHONE]));
            }
            return Promise.resolve({ data: { success: true, remaining: 1, completed: false } });
        });
        await renderLoaded();
        fireEvent.click(approveAll());

        const thanks = await screen.findByText('Thank you!');
        expect(thanks.closest('[role="status"]')).toHaveTextContent(
            '1 more change was proposed after you opened this page and still needs your decision.',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Review it' }));

        const phone = await screen.findByRole('group', { name: /Decision for Phone/i });
        expect(within(phone).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
        expect(screen.queryByText('First Name')).not.toBeInTheDocument();
        expect(screen.queryByText('Thank you!')).not.toBeInTheDocument();
    });

    it('ends on the shared link screen when the link was replaced while the page was open', async () => {
        serve([FIRST_NAME, CITY], callableError(
            'failed-precondition',
            'This review link was replaced by a newer one. Please use the latest link your recruiter sent.',
        ));
        await renderLoaded();
        fireEvent.click(approveAll());

        expect(await screen.findByRole('heading', { level: 1, name: 'This link was replaced by a newer one' }))
            .toHaveFocus();
        expect(screen.queryByRole('button', { name: /^Approve all/ })).not.toBeInTheDocument();
    });

    it('has no accessibility violations with Approve all on the page', async () => {
        const { container } = await renderLoaded();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('a review link that does not open', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['expired', callableError('failed-precondition', 'This review link has expired.'), 'This link has expired'],
        [
            'replaced',
            callableError('failed-precondition', 'This review link was replaced by a newer one. Please use the latest link your recruiter sent.'),
            'This link was replaced by a newer one',
        ],
        ['wrong', callableError('not-found', 'This review link is invalid.'), 'This link is not valid'],
    ])('shows the shared screen for a link that is %s, with no retry', async (_label, refusal, title) => {
        mockCallable.mockImplementation(() => Promise.reject(refusal));
        renderPortal();

        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        expect(screen.getByText(/the sender/)).toBeInTheDocument();
    });

    it('opens the review on Try again when the link could not be checked', async () => {
        let loads = 0;
        mockCallable.mockImplementation(() => {
            loads += 1;
            return loads === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(review([FIRST_NAME, CITY]));
        });
        renderPortal();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This review link could not be opened. Check your internet connection and try again.');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('group', { name: /Decision for First Name/i })).toBeInTheDocument();
        expect(loads).toBe(2);
    });

    it('has no accessibility violations on the link screen', async () => {
        mockCallable.mockImplementation(() => Promise.reject(callableError('failed-precondition', 'This review link has expired.')));
        const { container } = renderPortal();
        await screen.findByRole('heading', { level: 1, name: 'This link has expired' });
        expect((await axe(container)).violations).toEqual([]);
    });
});
