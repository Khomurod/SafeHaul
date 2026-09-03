/**
 * "Read the documents", from the recruiter's side.
 *
 * The pipeline and the callable are both mocked: their own suites cover what they
 * do. What is pinned here is the orchestration a recruiter actually experiences —
 * that one attached document is enough, that a document the reader could not read
 * is sent again as pictures, and that a failure leaves them able to type.
 *
 * ## The fixture is part of what is being tested
 *
 * `files` is form data, and an upload leaves `{name, url, storagePath}` there —
 * no `type`, no `arrayBuffer`. `blobs` is what this tab still holds. Passing one
 * object for both was why every real upload came back as "None of the attached
 * files could be opened" while this suite read them perfectly. The two are kept
 * apart here for the same reason the component keeps them apart.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    extractDocuments: vi.fn(),
    httpsCallable: vi.fn(),
    call: vi.fn(),
}));

vi.mock('./extraction/documentExtractionPipeline', async (importOriginal) => ({
    ...(await importOriginal()),
    extractDocuments: mocks.extractDocuments,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { ApplicationAiPrepPanel } from './ApplicationAiPrepPanel';

/** What an upload leaves in the form data. Not readable, by itself. */
const UPLOADED = { name: 'psp.pdf', url: 'https://signed.example/psp.pdf', storagePath: 'companies/co-1/applications/psp.pdf' };
/** What the browser still holds for it, and what the reader needs. */
const FILE = new File(['%PDF-1.4'], 'psp.pdf', { type: 'application/pdf' });
const EXTRACTED = {
    driver: { firstName: 'Dana', lastName: 'Alvarez', dateOfBirth: '1988-03-11', fullAddress: '' },
    license: { cdlNumber: 'TX1234567' },
    carriers: [{ name: 'Acme Trucking', dotNumber: '123456' }],
    violations: [],
    unreadable: [],
};

function renderPanel(props = {}) {
    const onApply = vi.fn();
    const onLockCarriers = vi.fn();
    render(
        <ApplicationAiPrepPanel
            companyId="co-1"
            files={{ 'psp-report-upload': UPLOADED }}
            blobs={{ 'psp-report-upload': FILE }}
            formData={{}}
            onApply={onApply}
            onLockCarriers={onLockCarriers}
            {...props}
        />,
    );
    return { onApply, onLockCarriers };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockReturnValue(mocks.call);
    mocks.extractDocuments.mockResolvedValue({
        documents: { psp: { text: 'PSP body' } }, methods: { psp: 'text' }, failures: {},
    });
    mocks.call.mockResolvedValue({ data: { success: true, extracted: EXTRACTED, methods: { psp: 'text' } } });
});

describe('reading what is attached', () => {
    it('names how many documents it will read, and reads only those', async () => {
        renderPanel();
        expect(screen.getByTestId('read-documents')).toHaveTextContent('Read 1 document');

        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(mocks.call).toHaveBeenCalled());
        expect(mocks.call).toHaveBeenCalledWith({ companyId: 'co-1', documents: { psp: { text: 'PSP body' } } });
    });

    it('applies what it found and locks the carriers the report named', async () => {
        const { onApply, onLockCarriers } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(onApply).toHaveBeenCalled());
        expect(onApply.mock.calls[0][0]).toMatchObject({ firstName: 'Dana', cdlNumber: 'TX1234567' });
        expect(onLockCarriers).toHaveBeenCalledWith([{ name: 'Acme Trucking', dotNumber: '123456' }]);
    });

    it('says what it filled and what it left alone', async () => {
        renderPanel({ formData: { firstName: 'Dana Marie' } });

        fireEvent.click(screen.getByTestId('read-documents'));

        const summary = await screen.findByTestId('read-summary');
        expect(summary).toHaveTextContent(/Filled \d+ fields/);
        expect(summary).toHaveTextContent(/Kept what you had already typed in: firstName/);
        expect(summary).toHaveTextContent(/locked/);
    });

    it('sends a document the reader could not read back as pictures', async () => {
        mocks.extractDocuments
            .mockResolvedValueOnce({ documents: { medical: { text: 'garbled' } }, methods: { medical: 'ocr' }, failures: {} })
            .mockResolvedValueOnce({ documents: { medical: { pages: ['data:image/jpeg;base64,p1'] } }, methods: { medical: 'pages' }, failures: {} });
        mocks.call
            .mockResolvedValueOnce({ data: { success: true, extracted: EXTRACTED, methods: { medical: 'unreadable' } } })
            .mockResolvedValueOnce({ data: { success: true, extracted: { ...EXTRACTED, license: { medCardExpiration: '2027-06-30' } }, methods: { medical: 'vision' } } });

        const { onApply, onLockCarriers } = renderPanel({
            files: { 'medical-card-upload': UPLOADED },
            blobs: { 'medical-card-upload': FILE },
        });
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
        expect(mocks.call.mock.calls[1][0].documents.medical.pages).toHaveLength(1);
        // The second pass is what the recruiter sees the result of.
        expect(onApply.mock.calls[0][0].medCardExpiration).toBe('2027-06-30');
        expect(await screen.findByText(/worth checking/)).toBeInTheDocument();
    });

    it('does not make a second pass when everything read the first time', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
    });

    it('leaves the recruiter able to type when the reader fails', async () => {
        const failure = new Error('nope');
        failure.code = 'functions/failed-precondition';
        mocks.call.mockRejectedValue(failure);
        const { onApply } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        expect(await screen.findByRole('alert')).toHaveTextContent(/nope/);
        expect(onApply).not.toHaveBeenCalled();
    });

    it('says so when none of the files could even be opened', async () => {
        mocks.extractDocuments.mockResolvedValue({ documents: {}, methods: {}, failures: { psp: 'broken' } });
        renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        expect(await screen.findByRole('alert')).toHaveTextContent(/None of the attached files could be opened/);
        expect(mocks.call).not.toHaveBeenCalled();
    });

    it('cannot be pressed with nothing attached', () => {
        renderPanel({ files: {}, blobs: {} });
        expect(screen.getByTestId('read-documents')).toBeDisabled();
    });

    it('does not lose the first pass when the second pass answers for one document', async () => {
        // The realistic second-pass shape: complete, and empty except for the one
        // field it read. Spread over the first pass it erased the carriers, the
        // violations and the licence — with a success summary on screen.
        mocks.extractDocuments
            .mockResolvedValueOnce({ documents: { psp: { text: 'PSP body' }, medical: { text: 'garbled' } }, methods: { psp: 'text', medical: 'ocr' }, failures: {} })
            .mockResolvedValueOnce({ documents: { medical: { pages: ['data:image/jpeg;base64,p1'] } }, methods: { medical: 'pages' }, failures: {} });
        mocks.call
            .mockResolvedValueOnce({ data: { success: true, extracted: EXTRACTED, methods: { psp: 'text', medical: 'unreadable' } } })
            .mockResolvedValueOnce({
                data: {
                    success: true,
                    extracted: { driver: {}, license: { medCardExpiration: '2027-06-30' }, carriers: [], violations: [], unreadable: [] },
                    methods: { medical: 'vision' },
                },
            });

        const { onApply, onLockCarriers } = renderPanel({
            files: { 'psp-report-upload': UPLOADED, 'medical-card-upload': UPLOADED },
            blobs: { 'psp-report-upload': FILE, 'medical-card-upload': FILE },
        });
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(onApply).toHaveBeenCalled());
        const applied = onApply.mock.calls[0][0];
        expect(applied.medCardExpiration).toBe('2027-06-30');
        expect(applied.cdlNumber).toBe('TX1234567');
        expect(applied.employers).toHaveLength(1);
        expect(onLockCarriers).toHaveBeenCalledWith([{ name: 'Acme Trucking', dotNumber: '123456' }]);
    });
});

describe('a document this browser no longer holds', () => {
    it('cannot be read, and says which one and what to do', () => {
        renderPanel({ files: { 'psp-report-upload': UPLOADED }, blobs: {} });

        expect(screen.getByTestId('read-documents')).toBeDisabled();
        expect(screen.getByTestId('reattach-to-read')).toHaveTextContent('PSP report');
        expect(screen.getByTestId('reattach-to-read')).toHaveTextContent(/attach one again above/i);
    });

    it('reads the ones it does hold, and counts only those', async () => {
        renderPanel({
            files: { 'psp-report-upload': UPLOADED, 'mvr-upload': UPLOADED },
            blobs: { 'psp-report-upload': FILE },
        });

        expect(screen.getByTestId('read-documents')).toHaveTextContent('Read 1 document');
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(mocks.extractDocuments).toHaveBeenCalled());
        expect(mocks.extractDocuments.mock.calls[0][0].map((entry) => entry.kind)).toEqual(['psp']);
    });

    it('says nothing when every attached document is here', () => {
        renderPanel();
        expect(screen.queryByTestId('reattach-to-read')).toBeNull();
    });
});
