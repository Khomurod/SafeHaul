/**
 * Looking at a document that is already on the application.
 *
 * An upload used to leave a signed read URL in the form data, and that signature
 * lives FIFTEEN MINUTES. It was persisted into the draft and handed to the driver
 * by the invite exchange, so a document a recruiter attached on Tuesday was a
 * broken image and a Storage error page by the time the driver opened their link
 * — and the same for the recruiter reopening their own draft an hour later. The
 * durable identifier was sitting beside it, unused. Found 2026-09-08.
 *
 * Nothing here asks anyone to upload a file again because a viewing link went
 * stale, and the three ways looking can fail are told apart, because only one of
 * them means the file is actually gone.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ httpsCallable: vi.fn(), call: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));

import UploadField from './UploadField';

/** What an upload leaves behind now: the durable path, and no signature. */
const ATTACHED = {
    name: 'cdl.jpg',
    storagePath: 'companies/co-1/applications/guest_uploads/cdl-1.jpg',
};

function renderField(props = {}) {
    render(
        <UploadField
            label="Upload CDL (Front)"
            name="cdl-front"
            value={ATTACHED}
            companyId="co-1"
            onUpload={vi.fn()}
            onChange={vi.fn()}
            {...props}
        />,
    );
}

function callableError(code) {
    return Object.assign(new Error('nope'), { code });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockReturnValue(mocks.call);
    mocks.call.mockResolvedValue({ data: { success: true, url: 'https://signed.example/fresh' } });
});

describe('a document attached earlier', () => {
    it('is signed again when it is looked at, from the path and not the stored URL', async () => {
        renderField();

        await waitFor(() => expect(mocks.call).toHaveBeenCalledWith({
            companyId: 'co-1', storagePath: ATTACHED.storagePath,
        }));
        const view = await screen.findByRole('link', { name: /View Upload CDL \(Front\) file/ });
        expect(view).toHaveAttribute('href', 'https://signed.example/fresh');
        expect(screen.getByAltText('Upload CDL (Front) preview')).toHaveAttribute('src', 'https://signed.example/fresh');
    });

    it('says it is opening it, rather than showing a broken thumbnail', async () => {
        let release;
        mocks.call.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ data: { url: 'https://signed.example/fresh' } });
        }));
        renderField();

        expect(await screen.findByText('Opening the file…')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /View/ })).not.toBeInTheDocument();

        release();
        await waitFor(() => expect(screen.queryByText('Opening the file…')).not.toBeInTheDocument());
    });

    it('asks for a re-upload only when the file is genuinely gone', async () => {
        mocks.call.mockRejectedValue(callableError('functions/not-found'));
        renderField();

        expect(await screen.findByText(/no longer stored/)).toBeInTheDocument();
        expect(screen.getByText(/upload it again/)).toBeInTheDocument();
    });

    it('does not ask for a re-upload when looking merely failed, and offers to retry', async () => {
        // A rate limit, an outage, a refusal. The bytes are fine, and telling
        // somebody to re-attach a file that is sitting in Storage is the wrong
        // instruction — it is also the one an expired signature used to produce.
        mocks.call.mockRejectedValueOnce(callableError('functions/resource-exhausted'));
        renderField();

        expect(await screen.findByText(/Could not open the preview/)).toBeInTheDocument();
        expect(screen.getByText(/still attached/)).toBeInTheDocument();
        expect(screen.queryByText(/no longer stored/)).not.toBeInTheDocument();

        mocks.call.mockResolvedValue({ data: { url: 'https://signed.example/second-try' } });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        const view = await screen.findByRole('link', { name: /View Upload CDL \(Front\) file/ });
        expect(view).toHaveAttribute('href', 'https://signed.example/second-try');
    });

    it('never blocks the application over a preview: the file still counts as attached', async () => {
        mocks.call.mockRejectedValue(callableError('functions/unavailable'));
        renderField();

        await screen.findByText(/Could not open the preview/);
        // The row is still the "uploaded" row, with its filename and its Remove
        // control — a preview is a courtesy and the upload gates key on presence.
        expect(screen.getByText('cdl.jpg')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Remove Upload CDL \(Front\) file/ })).toBeInTheDocument();
    });

    it('uses a legacy record\'s stored URL, because there is no path to sign from', async () => {
        renderField({ value: { name: 'old.pdf', url: 'https://legacy.example/old.pdf' } });

        const view = await screen.findByRole('link', { name: /View Upload CDL \(Front\) file/ });
        expect(view).toHaveAttribute('href', 'https://legacy.example/old.pdf');
        expect(mocks.call).not.toHaveBeenCalled();
    });
});
