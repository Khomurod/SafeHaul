/**
 * The send dialog's copies (CC) while the company's saved list is still being
 * read: an untouched field waits for it, a field the recruiter typed in keeps
 * what they typed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const fs = vi.hoisted(() => ({ getDoc: vi.fn(), doc: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { PEVRequestModal } from './PEVRequestModal';

/** A read that answers when the test says so. */
function pendingRead() {
    let answer;
    fs.getDoc.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    return (pevCcEmails) => answer({ exists: () => true, data: () => ({ pevCcEmails }) });
}

function renderDialog() {
    const onProceed = vi.fn();
    render(
        <PEVRequestModal
            employer={{ companyName: 'Swift', companyEmail: 'hr@swift.test', state: 'TX' }}
            applicant={{}}
            companyId="co-1"
            defaultCopies={['old@carrier.test']}
            onClose={vi.fn()}
            onProceed={onProceed}
        />,
    );
    return { onProceed, cc: screen.getByLabelText(/^CC \(your team, optional\)/) };
}

const continueButton = () => screen.getByRole('button', { name: /Continue to Preview/i });

beforeEach(() => {
    vi.resetAllMocks();
    fs.doc.mockImplementation(() => ({}));
    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
});

describe('PEVRequestModal copies while the saved list loads', () => {
    it('waits for the saved list, then sends it, not the session copy', async () => {
        const answer = pendingRead();
        const { onProceed, cc } = renderDialog();

        expect(continueButton()).toBeDisabled();
        fireEvent.click(continueButton());
        expect(onProceed).not.toHaveBeenCalled();

        answer(['new@carrier.test']);
        await waitFor(() => expect(cc).toHaveValue('new@carrier.test'));
        expect(continueButton()).toBeEnabled();
        fireEvent.click(continueButton());
        expect(onProceed).toHaveBeenCalledWith('email', expect.objectContaining({ ccEmails: ['new@carrier.test'] }));
    });

    it('keeps what the recruiter typed while the read was pending', async () => {
        const answer = pendingRead();
        const { onProceed, cc } = renderDialog();

        fireEvent.change(cc, { target: { value: 'typed@carrier.test' } });
        expect(continueButton()).toBeEnabled();

        // The read answers and the dialog settles; the typed list stands.
        await act(async () => answer(['new@carrier.test']));
        expect(cc).toHaveValue('typed@carrier.test');
        fireEvent.click(continueButton());
        expect(onProceed).toHaveBeenCalledWith('email', expect.objectContaining({ ccEmails: ['typed@carrier.test'] }));
    });

    it('does not hold a hand-delivered request for the list', () => {
        pendingRead();
        const { onProceed } = renderDialog();
        fireEvent.click(screen.getByLabelText(/Download \/ Print/));
        fireEvent.click(screen.getByRole('button', { name: /Preview & Print/i }));
        expect(onProceed).toHaveBeenCalledWith('manual', expect.not.objectContaining({ ccEmails: expect.anything() }));
    });
});
