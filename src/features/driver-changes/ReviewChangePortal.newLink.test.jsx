/**
 * A review link that no longer works offers "Ask … for a new link", which asks
 * the server to tell the company about this review, by its token. Artificial
 * data only — no real tokens or applicant information.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (_f, name) => (...a) => mockCallable(name, ...a) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));

import { ReviewChangePortal } from './ReviewChangePortal';

const callableError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

function renderPortal(token = 'tok-1') {
    return render(
        <MemoryRouter initialEntries={[`/review-change/${token}`]}>
            <Routes>
                <Route path="/review-change/:token" element={<ReviewChangePortal />} />
            </Routes>
        </MemoryRouter>,
    );
}

/** The review link has expired; asking for a new one gets `answer`. */
function serve(answer) {
    mockCallable.mockImplementation(async (name) => {
        if (name === 'getChangeReview') throw callableError('failed-precondition', 'This review link has expired.');
        return answer();
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});
beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a review link that no longer works', () => {
    it('asks the company for a new link to this review, by its token', async () => {
        serve(async () => ({ data: { ok: true } }));
        renderPortal('tok-1');

        fireEvent.click(await screen.findByRole('button', { name: /for a new link$/ }));
        expect(await screen.findByText(/has been asked to send you a new link\.$/)).toBeInTheDocument();
        expect(mockCallable).toHaveBeenCalledWith('requestNewLink', { kind: 'review', token: 'tok-1' });
    });

    it('says when the request could not be sent, and keeps the button', async () => {
        serve(async () => { throw callableError('internal', 'internal'); });
        renderPortal('tok-1');

        fireEvent.click(await screen.findByRole('button', { name: /for a new link$/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/^That request could not be sent\. Please contact /);
        expect(screen.getByRole('button', { name: /for a new link$/ })).toBeEnabled();
    });
});
