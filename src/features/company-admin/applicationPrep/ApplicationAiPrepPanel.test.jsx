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
import { applyExtractedFields } from './applyExtractedFields';

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

/**
 * The real `applyExtraction`, standing in for the hook's.
 *
 * It reads the answers as they are NOW rather than a snapshot the panel captured
 * when the button was pressed — which is the whole of the defect this suite grew
 * to cover — so the double holds mutable state the test can change mid-read, the
 * way a recruiter typing does.
 */
function makeApplyExtraction(initial = {}) {
    const box = { formData: { ...initial }, calls: [] };
    const applyExtraction = vi.fn((extracted) => {
        const applied = applyExtractedFields(box.formData, extracted);
        box.formData = applied.formData;
        box.calls.push(extracted);
        return applied;
    });
    return { box, applyExtraction };
}

function renderPanel(props = {}) {
    const { box, applyExtraction } = makeApplyExtraction(props.initialFormData);
    const onBusyChange = vi.fn();
    const { rerender } = render(
        <ApplicationAiPrepPanel
            companyId="co-1"
            files={{ 'psp-report-upload': UPLOADED }}
            blobs={{ 'psp-report-upload': FILE }}
            applicantKey="key-1"
            onApplyExtraction={applyExtraction}
            onBusyChange={onBusyChange}
            {...props}
        />,
    );
    const update = (next) => rerender(
        <ApplicationAiPrepPanel
            companyId="co-1"
            files={{ 'psp-report-upload': UPLOADED }}
            blobs={{ 'psp-report-upload': FILE }}
            applicantKey="key-1"
            onApplyExtraction={applyExtraction}
            onBusyChange={onBusyChange}
            {...props}
            {...next}
        />,
    );
    return { box, applyExtraction, onBusyChange, update };
}

beforeEach(() => {
    vi.resetAllMocks();
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
        const { box, applyExtraction } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(applyExtraction).toHaveBeenCalled());
        expect(box.formData).toMatchObject({ firstName: 'Dana', cdlNumber: 'TX1234567' });
        // Locking travels with the application now, inside the hook, so a caller
        // cannot do one and forget the other.
        expect(box.formData.employers).toHaveLength(1);
    });

    it('says what it filled and what it left alone', async () => {
        renderPanel({ initialFormData: { firstName: 'Dana Marie' } });

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

        const { box } = renderPanel({
            files: { 'medical-card-upload': UPLOADED },
            blobs: { 'medical-card-upload': FILE },
        });
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
        expect(mocks.call.mock.calls[1][0].documents.medical.pages).toHaveLength(1);
        // The second pass is what the recruiter sees the result of.
        await waitFor(() => expect(box.formData.medCardExpiration).toBe('2027-06-30'));
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
        const { applyExtraction } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        expect(await screen.findByRole('alert')).toHaveTextContent(/nope/);
        expect(applyExtraction).not.toHaveBeenCalled();
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

        const { box, applyExtraction } = renderPanel({
            files: { 'psp-report-upload': UPLOADED, 'medical-card-upload': UPLOADED },
            blobs: { 'psp-report-upload': FILE, 'medical-card-upload': FILE },
        });
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(applyExtraction).toHaveBeenCalled());
        expect(box.formData.medCardExpiration).toBe('2027-06-30');
        expect(box.formData.cdlNumber).toBe('TX1234567');
        expect(box.formData.employers).toHaveLength(1);
    });
});

/**
 * A read takes up to two minutes per pass, twice, and the recruiter keeps working
 * through it. Everything below is a thing that happens in that window.
 */
describe('what can change while the reader is running', () => {
    /** A callable whose answer the test decides when to deliver. */
    function deferredCall(data) {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        mocks.call.mockImplementation(() => gate.then(() => ({ data })));
        return () => release();
    }

    it('keeps what the recruiter typed while it was reading', async () => {
        const release = deferredCall({ success: true, extracted: EXTRACTED, methods: { psp: 'text' } });
        const { box, applyExtraction } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));
        await waitFor(() => expect(mocks.call).toHaveBeenCalled());

        // Typed after the button was pressed and before the answer came back. The
        // panel used to merge into the `formData` PROP it captured at click time
        // and hand the whole object to the raw setter, so this was silently
        // reverted — and "fill only what is blank" was judged against the snapshot
        // too, so a field blank at click time was overwritten rather than kept.
        box.formData = { ...box.formData, firstName: 'Dana Marie', cdlNumber: 'CORRECTED-1' };
        release();

        await waitFor(() => expect(applyExtraction).toHaveBeenCalled());
        // The structural property, not just the outcome: the panel hands over the
        // RAW extraction and does not merge anything itself, so there is no
        // snapshot of the answers for it to merge into. That is what stops this
        // defect coming back by a different route.
        expect(box.calls[0]).toEqual(EXTRACTED);
        expect(box.formData.firstName).toBe('Dana Marie');
        expect(box.formData.cdlNumber).toBe('CORRECTED-1');
        // And the recruiter is told, rather than left to notice.
        expect(await screen.findByText(/Kept what you had already typed in/)).toBeInTheDocument();
    });

    it('does not apply one driver\'s answers to another', async () => {
        const release = deferredCall({ success: true, extracted: EXTRACTED, methods: { psp: 'text' } });
        const { applyExtraction, update } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));
        await waitFor(() => expect(mocks.call).toHaveBeenCalled());

        // The recruiter went back to the list and opened somebody else. `onApply`
        // belongs to the page, which outlives this panel, so without a correlation
        // check the first driver's answers — and their PSP carrier LOCKS — landed
        // under the second driver's key.
        update({ applicantKey: 'key-2' });
        release();

        await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
        expect(applyExtraction).not.toHaveBeenCalled();
    });

    it('does not apply an answer about documents that have since been replaced', async () => {
        const release = deferredCall({ success: true, extracted: EXTRACTED, methods: { psp: 'text' } });
        const { applyExtraction, update } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));
        await waitFor(() => expect(mocks.call).toHaveBeenCalled());

        update({ blobs: { 'psp-report-upload': new File(['%PDF-1.4 v2'], 'psp.pdf', { type: 'application/pdf' }) } });
        release();

        await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
        expect(applyExtraction).not.toHaveBeenCalled();
    });

    it('keeps the first pass when the second one fails', async () => {
        // Both calls used to sit in one `try`, so one failed vision retry on a
        // medical card threw away a licence and a PSP report that had read
        // perfectly — the failure `mergeExtractionResults` was written to prevent,
        // one layer up.
        mocks.extractDocuments
            .mockResolvedValueOnce({ documents: { psp: { text: 'PSP body' }, medical: { text: 'garbled' } }, methods: { psp: 'text', medical: 'ocr' }, failures: {} })
            .mockResolvedValueOnce({ documents: { medical: { pages: ['data:image/jpeg;base64,p1'] } }, methods: { medical: 'pages' }, failures: {} });
        mocks.call
            .mockResolvedValueOnce({ data: { success: true, extracted: EXTRACTED, methods: { psp: 'text', medical: 'unreadable' } } })
            .mockRejectedValueOnce(Object.assign(new Error('vision down'), { code: 'functions/unavailable' }));

        const { box, applyExtraction } = renderPanel({
            files: { 'psp-report-upload': UPLOADED, 'medical-card-upload': UPLOADED },
            blobs: { 'psp-report-upload': FILE, 'medical-card-upload': FILE },
        });
        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(applyExtraction).toHaveBeenCalled());
        expect(box.formData.cdlNumber).toBe('TX1234567');
        expect(box.formData.employers).toHaveLength(1);
        // Reported as read, not as an error: the recruiter got most of it.
        expect(await screen.findByTestId('read-summary')).toBeInTheDocument();
    });

    it('reports that it is busy, so a second read cannot start on another step', async () => {
        const release = deferredCall({ success: true, extracted: EXTRACTED, methods: { psp: 'text' } });
        const { onBusyChange } = renderPanel();

        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
        release();
        await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(false));
    });

    it('is refused while another step is already reading', () => {
        renderPanel({ busy: true });

        expect(screen.getByTestId('read-documents')).toBeDisabled();
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
