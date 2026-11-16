/**
 * A decision applies to the value the driver was shown.
 *
 * The company can propose a field again while the review page is open, which
 * replaces the pending value. The page sends, with each decision, the proposed
 * value it showed (`shown`); the server refuses the whole send when any of them
 * moved (`details.reason: 'changes-updated'`). That refusal is not a link that
 * stopped working: the page loads the review again, says what changed, and keeps
 * the driver's choices only on the changes that did not. Artificial data only.
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
// The company proposed First Name again after the page loaded.
const FIRST_NAME_AGAIN = { ...FIRST_NAME, proposedValue: 'Jon' };

const review = (changes) => ({ data: { applicantName: 'John Doe', status: 'open', companyName: 'Acme Freight', changes } });
const callableError = (code, message, details) => Object.assign(new Error(message), { code: `functions/${code}`, details });
const CHANGES_UPDATED = callableError(
    'failed-precondition',
    'Some of these changes were updated after you opened this page. Please review them again.',
    { reason: 'changes-updated' },
);

/** Each load gets the next of `loads` (the last repeats); each send the next of `answers`. */
function serve(loads, answers) {
    let loaded = 0;
    let sent = 0;
    mockCallable.mockImplementation((name) => {
        if (name === 'getChangeReview') return Promise.resolve(review(loads[Math.min(loaded++, loads.length - 1)]));
        const answer = answers[Math.min(sent++, answers.length - 1)];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    });
}

const OK = { data: { success: true, remaining: 0 } };
const loadsOf = () => mockCallable.mock.calls.filter(([name]) => name === 'getChangeReview');
const submitted = () => mockCallable.mock.calls.filter(([name]) => name === 'submitChangeResolution');
const group = (fieldName) => screen.getByRole('group', { name: new RegExp(`Decision for ${fieldName}`, 'i') });
const pressed = (fieldName) => within(group(fieldName)).queryByRole('button', { pressed: true });

function decide(fieldName, action) {
    fireEvent.click(within(group(fieldName)).getByRole('button', { name: new RegExp(`^${action}$`, 'i') }));
}

async function renderLoaded() {
    const view = render(
        <MemoryRouter initialEntries={['/review-change/tok-1']}>
            <Routes>
                <Route path="/review-change/:token" element={<ReviewChangePortal />} />
            </Routes>
        </MemoryRouter>,
    );
    await screen.findByRole('group', { name: /Decision for First Name/i });
    return view;
}

/** The notice, once the review has loaded again. */
const updatedNotice = async () => {
    const title = await screen.findByText('Some changes were updated');
    return title.closest('.ds-notice');
};

afterEach(cleanup);
beforeEach(() => {
    vi.resetAllMocks();
});

describe('each decision carries the value the page showed', () => {
    it('sends the proposed value as displayed, for every decision', async () => {
        serve([[FIRST_NAME, CITY, EMPLOYERS]], [OK]);
        await renderLoaded();
        decide('First Name', 'Edit');
        fireEvent.change(screen.getByLabelText(/Corrected value for First Name/i), { target: { value: 'Johnny' } });
        decide('City', 'Reject');
        decide('Employment History', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        await screen.findByText('Thank you!');
        expect(submitted()[0][1].resolutions).toEqual([
            { fieldKey: 'firstName', action: 'edit', value: 'Johnny', shown: 'Jonathan' },
            { fieldKey: 'city', action: 'reject', shown: 'Sparks' },
            { fieldKey: 'employers', action: 'approve', shown: [] },
        ]);
    });
});

describe('a change that moved while the page was open', () => {
    it('loads the review again instead of ending on the link screen, and says so above the changes', async () => {
        serve([[FIRST_NAME, CITY], [FIRST_NAME_AGAIN, CITY]], [CHANGES_UPDATED, OK]);
        await renderLoaded();
        decide('First Name', 'Approve');
        decide('City', 'Reject');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        const notice = await updatedNotice();
        expect(notice).toHaveTextContent('First Name changed after you opened this page. Review it again, then submit your responses.');
        await waitFor(() => expect(notice).toHaveFocus());
        expect(loadsOf()).toHaveLength(2);
        expect(screen.queryByRole('heading', { level: 1, name: /link/i })).not.toBeInTheDocument();
        // Above the changes.
        expect(notice.compareDocumentPosition(group('First Name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        // The new value is on screen, with no decision; City's Reject stands.
        expect(screen.getByText('Jon')).toBeInTheDocument();
        expect(pressed('First Name')).toBeNull();
        expect(within(group('City')).getByRole('button', { name: /^reject$/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sends the new value once the driver decides on it', async () => {
        serve([[FIRST_NAME, CITY], [FIRST_NAME_AGAIN, CITY]], [CHANGES_UPDATED, OK]);
        await renderLoaded();
        decide('First Name', 'Approve');
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));
        await updatedNotice();

        decide('First Name', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));
        await screen.findByText('Thank you!');
        expect(submitted()[1][1].resolutions).toEqual([
            { fieldKey: 'firstName', action: 'approve', shown: 'Jon' },
            { fieldKey: 'city', action: 'approve', shown: 'Sparks' },
        ]);
    });

    it('keeps a corrected value typed on a change that did not move', async () => {
        serve([[FIRST_NAME, CITY], [FIRST_NAME, { ...CITY, proposedValue: 'Carson City' }]], [CHANGES_UPDATED]);
        await renderLoaded();
        decide('First Name', 'Edit');
        fireEvent.change(screen.getByLabelText(/Corrected value for First Name/i), { target: { value: 'Johnny' } });
        decide('City', 'Approve');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        expect(await updatedNotice()).toHaveTextContent('City changed after you opened this page.');
        expect(screen.getByLabelText(/Corrected value for First Name/i)).toHaveValue('Johnny');
        expect(pressed('City')).toBeNull();
    });

    it('clears Approve all on the change that moved, names a change that arrived, and offers Approve all again', async () => {
        serve([[FIRST_NAME, CITY], [FIRST_NAME_AGAIN, CITY, PHONE]], [CHANGES_UPDATED, OK]);
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 changes' }));

        expect(await updatedNotice()).toHaveTextContent(
            'First Name, Phone changed after you opened this page. Review them again, then submit your responses.',
        );
        expect(pressed('First Name')).toBeNull();
        expect(pressed('Phone')).toBeNull();
        expect(within(group('City')).getByRole('button', { name: /^approve$/i })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Approve all 3 changes' }));
        await screen.findByText('Thank you!');
        expect(submitted()[1][1].resolutions).toEqual([
            { fieldKey: 'firstName', action: 'approve', shown: 'Jon' },
            { fieldKey: 'city', action: 'approve', shown: 'Sparks' },
            { fieldKey: 'phone', action: 'approve', shown: '5559998888' },
        ]);
    });

    it('says so even when the change that moved is no longer waiting', async () => {
        // Settled elsewhere (another tab) after this page loaded: it is gone from the list.
        serve([[FIRST_NAME, CITY], [CITY]], [CHANGES_UPDATED]);
        await renderLoaded();
        decide('First Name', 'Approve');
        decide('City', 'Reject');
        fireEvent.click(screen.getByRole('button', { name: /Submit my responses/i }));

        const notice = await updatedNotice();
        expect(notice).toHaveTextContent('The list below is now up to date. Check your choices, then submit your responses.');
        expect(screen.queryByText('First Name')).not.toBeInTheDocument();
        expect(within(group('City')).getByRole('button', { name: /^reject$/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('drops the notice when the review is loaded again for another reason', async () => {
        let loads = 0;
        mockCallable.mockImplementation((name) => {
            if (name === 'getChangeReview') {
                loads += 1;
                if (loads === 1) return Promise.resolve(review([FIRST_NAME, CITY]));
                if (loads === 2) return Promise.resolve(review([FIRST_NAME_AGAIN, CITY]));
                return Promise.resolve(review([{ ...FIRST_NAME_AGAIN, status: 'approved' }, { ...CITY, status: 'approved' }, PHONE]));
            }
            return submitted().length === 1
                ? Promise.reject(CHANGES_UPDATED)
                : Promise.resolve({ data: { success: true, remaining: 1 } });
        });
        await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 changes' }));
        await updatedNotice();
        fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 changes' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Review them' }));

        await screen.findByRole('group', { name: /Decision for Phone/i });
        expect(screen.queryByText('Some changes were updated')).not.toBeInTheDocument();
    });

    it('has no accessibility violations with the notice on the page', async () => {
        serve([[FIRST_NAME, CITY], [FIRST_NAME_AGAIN, CITY]], [CHANGES_UPDATED]);
        const { container } = await renderLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 changes' }));
        await updatedNotice();
        expect((await axe(container)).violations).toEqual([]);
    });
});
