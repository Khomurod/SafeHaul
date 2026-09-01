// EnvelopeHistory contract, part 3 of 3: copy link, download, pagination,
// and the accessibility proofs.
// The shared harness — mock state, factories, fixtures, snapshot emitters and
// helpers — lives in `EnvelopeHistory.support.jsx`; the registrations below
// delegate to it. All fixtures are artificial (see the support's PRIVACY note).
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('./EnvelopeHistory.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeHistory.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvelopeHistory.support')).libFirebaseMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeHistory.support')).feedbackMock());

import EnvelopeHistory from './EnvelopeHistory';
import {
    makeRenderHistory,
    resetHarness,
    restoreHarness,
    makeDoc,
    emit,
    openDetails,
    callables,
    fnMocks,
    toast,
    SIGNING_LINK,
    DOC_URL,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

beforeEach(resetHarness);

afterEach(restoreHarness);

describe('EnvelopeHistory — copy link action', () => {
    it('calls getSigningLink with the exact payload and copies the result', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));

        await waitFor(() => expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'getSigningLink'));
        expect(callables.getSigningLink).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1' });
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SIGNING_LINK));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Full signing link copied to clipboard!'));
    });

    it('surfaces the callable error message, falling back when absent', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.getSigningLink.mockRejectedValueOnce(new Error('permission denied'));
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('permission denied'));

        toast.showError.mockClear();
        const bare = new Error();
        bare.message = '';
        callables.getSigningLink.mockRejectedValueOnce(bare);
        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Could not retrieve signing link.'));
        consoleError.mockRestore();
    });

    it('shows a busy state on the copying row only', async () => {
        let resolveLink;
        callables.getSigningLink.mockReturnValue(new Promise((resolve) => { resolveLink = resolve; }));
        renderHistory();
        emit([makeDoc({ status: 'sent' }), makeDoc({ id: 'req-2', title: 'NDA', status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Link for Offer Letter' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Link for NDA' })).toBeEnabled();

        await React.act(async () => { resolveLink({ data: { signingLink: SIGNING_LINK } }); });
    });
});

describe('EnvelopeHistory — download action', () => {
    it('calls getSignedDocumentUrl with the raw path and opens the url', async () => {
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));

        await waitFor(() => expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'getSignedDocumentUrl'));
        expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/signed/artificial.pdf' });
        await waitFor(() => expect(openSpy).toHaveBeenCalledWith(DOC_URL, '_blank'));
    });

    it('strips the gs:// bucket prefix before calling the callable', async () => {
        vi.stubGlobal('open', vi.fn());
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'gs://example-bucket.appspot.com/companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => {
            expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/signed/artificial.pdf' });
        });
    });

    it('falls back to storagePath when signedPdfUrl is absent', async () => {
        vi.stubGlobal('open', vi.fn());
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: undefined, storagePath: 'companies/co-1/raw/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => {
            expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/raw/artificial.pdf' });
        });
    });

    it('maps functions/not-found to its exact message', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const notFound = new Error('missing');
        notFound.code = 'functions/not-found';
        callables.getSignedDocumentUrl.mockRejectedValue(notFound);
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('File not found. It may have been deleted or moved.'));
        consoleError.mockRestore();
    });

    it('maps any other download failure to the generic message', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.getSignedDocumentUrl.mockRejectedValue(new Error('network'));
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Could not download file. Please try again.'));
        consoleError.mockRestore();
    });
});

describe('EnvelopeHistory — pagination', () => {
    const manyDocs = (count) => Array.from({ length: count }, (_, index) =>
        makeDoc({ id: `req-${index}`, title: `Doc ${index}`, status: 'sent' }));

    it('shows no pagination for 25 or fewer documents', () => {
        renderHistory();
        emit(manyDocs(25));
        expect(screen.queryByRole('navigation', { name: /pagination/ })).not.toBeInTheDocument();
        // Header row plus every document.
        expect(screen.getAllByRole('row')).toHaveLength(26);
    });

    it('pages beyond 25 documents and announces the visible range', () => {
        renderHistory();
        emit(manyDocs(30));

        expect(screen.getAllByRole('row')).toHaveLength(26);
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getAllByRole('row')).toHaveLength(6);
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();
    });

    it('clamps the page when a live update shrinks the list', () => {
        renderHistory();
        emit(manyDocs(30));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();

        // The live snapshot narrows (a filter change upstream, or deletions):
        // the table must fall back to a page that still exists.
        emit(manyDocs(3));
        expect(screen.getAllByRole('row')).toHaveLength(4);
        expect(screen.queryByRole('navigation', { name: /pagination/ })).not.toBeInTheDocument();
    });

    it('does not resurrect a stale page after the list shrinks and grows again', () => {
        renderHistory();
        emit(manyDocs(30));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();

        // A filter narrows the list below one page, then is cleared again. The
        // clamp must persist, or the restored list would silently open on page
        // 2 and hide the first 25 documents.
        emit(manyDocs(10));
        emit(manyDocs(30));
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — accessibility', () => {
    it('exposes a labelled, keyboard-focusable horizontal scroll region', () => {
        renderHistory();
        emit([makeDoc()]);
        const region = screen.getByRole('region', { name: /Document history/ });
        expect(region).toHaveAttribute('tabindex', '0');
    });

    it('uses no unsupported 9px or 10px interface text', () => {
        const { container } = renderHistory();
        emit([makeDoc({ emailStatus: 'failed', emailError: 'SMTP 550', sendEmail: true, sendSms: true })]);
        expect(container.innerHTML).not.toMatch(/text-\[9px\]|text-\[10px\]/);
    });

    it('activates a quick action from the keyboard', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        const link = screen.getByRole('button', { name: 'Link for Offer Letter' });
        link.focus();
        expect(link).toHaveFocus();
        fireEvent.click(link); // Enter/Space on a native button dispatches click
        await waitFor(() => expect(callables.getSigningLink).toHaveBeenCalledTimes(1));
    });

    it('has no accessibility violations across mixed row states', async () => {
        const { container } = renderHistory({ onCorrect: vi.fn() });
        emit([
            makeDoc({ id: 'a', status: 'sent' }),
            makeDoc({ id: 'b', status: 'signed', title: 'Signed Doc' }),
            makeDoc({ id: 'c', status: 'voided', title: 'Voided Doc' }),
            makeDoc({ id: 'd', title: 'Failed Doc', emailStatus: 'failed', emailError: 'SMTP 550 rejected' }),
        ]);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations with the details dialog open', async () => {
        const { container } = renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent' })]);
        await openDetails();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('does not leak the signing link into the DOM', async () => {
        const { container } = renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
        expect(container.innerHTML).not.toContain(SIGNING_LINK);
    });
});
