// A file that lands is kept with the page at once, so a reload before Continue
// does not cost the driver the document they had just sent, and so is what the
// CDL auto-fill sets. Answers replaced wholesale (a restore, Start Over, the reset
// after submitting) are neither, and write nothing.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ saves: [] }));

vi.mock('./applicationDraftStorage', () => ({
    readApplicationDraft: vi.fn(),
    saveApplicationDraft: vi.fn((slug, formData, options) => {
        storage.saves.push({ slug, formData, options });
        return { localSeq: storage.saves.length, draftId: 'draft-1' };
    }),
    clearApplicationDraft: vi.fn(),
    writeDiscardMark: vi.fn(),
}));
vi.mock('../../services/applicationDraftService', () => ({ closeDraftAfterSubmission: vi.fn() }));

import { storedFilePaths, useDraftLifecycle } from './useDraftLifecycle';

const CDL_FRONT = { name: 'cdl-front.jpg', storagePath: 'companies/c1/applications/guest_uploads/u1_cdl-front.jpg' };
const RESUME = { name: 'resume.pdf', storagePath: 'companies/c1/applications/guest_uploads/u2_resume.pdf' };
const STORED = { 'cdl-front': CDL_FRONT, q5: RESUME };

function renderLifecycle({ formData = {}, sandbox = false, discarded = false } = {}) {
    const sendFile = vi.fn(async (fieldName) => STORED[fieldName]);
    const props = (data) => ({
        slug: 'acme',
        sandbox,
        formData: data,
        currentStep: 2,
        draftIdRef: { current: null },
        restoredFromDraftRef: { current: false },
        discardMarkRef: { current: 'mark-1' },
        discardedElsewhere: () => discarded,
        handleDiscardedElsewhere: vi.fn(),
        continueExisting: vi.fn(),
        startOver: vi.fn(),
        forgetDraftOwnership: vi.fn(),
        saveDraftToServer: vi.fn(),
        setFormData: vi.fn(),
        setCurrentStep: vi.fn(),
        setIntakeMode: vi.fn(),
        showSuccess: vi.fn(),
        showError: vi.fn(),
        showInfo: vi.fn(),
        sendFile,
    });
    const hook = renderHook(({ data }) => useDraftLifecycle(props(data)), { initialProps: { data: formData } });
    return {
        sendFile,
        send: async (fieldName, options) => {
            let stored;
            await act(async () => { stored = await hook.result.current.handleFileUpload(fieldName, new File(['x'], 'x.jpg'), options); });
            return stored;
        },
        answer: (data) => hook.rerender({ data }),
        keepNext: () => act(() => hook.result.current.keepNextAnswers()),
    };
}

beforeEach(() => {
    storage.saves.length = 0;
});

describe('a file that lands', () => {
    it('is kept with the page once it is among the answers, on the step it was sent from', async () => {
        const page = renderLifecycle({ formData: { firstName: 'Dana' } });
        await page.send('cdl-front');
        expect(storage.saves).toHaveLength(0);

        page.answer({ firstName: 'Dana', 'cdl-front': CDL_FRONT });
        page.answer({ firstName: 'Dan', 'cdl-front': CDL_FRONT });

        expect(storage.saves).toHaveLength(1);
        expect(storage.saves[0].formData['cdl-front']).toEqual(CDL_FRONT);
        expect(storage.saves[0].options.lastStep).toBe(2);
    });

    it('is kept for a custom question too', async () => {
        const page = renderLifecycle();
        await page.send('q5');
        page.answer({ customAnswers: { q5: RESUME } });
        expect(storage.saves.map((save) => save.formData.customAnswers.q5)).toEqual([RESUME]);
    });

    it('reaches the step exactly as sent, and comes back as stored', async () => {
        const page = renderLifecycle();
        const signal = new AbortController().signal;
        expect(await page.send('cdl-front', { signal })).toEqual(CDL_FRONT);
        expect(page.sendFile).toHaveBeenCalledWith('cdl-front', expect.any(File), { signal });
    });

    it('is not kept when its upload failed, and the failure reaches the step', async () => {
        const page = renderLifecycle();
        page.sendFile.mockImplementation(async () => { throw new Error('Upload failed. Please try again.'); });
        await expect(page.send('cdl-front')).rejects.toThrow('Upload failed. Please try again.');
        page.answer({ 'cdl-front': CDL_FRONT });
        expect(storage.saves).toHaveLength(0);
    });

    it('does not bring back an application discarded elsewhere', async () => {
        const page = renderLifecycle({ discarded: true });
        await page.send('cdl-front');
        page.answer({ 'cdl-front': CDL_FRONT });
        expect(storage.saves).toHaveLength(0);
    });

    it('keeps nothing for the sandbox, which keeps no draft', async () => {
        const page = renderLifecycle({ sandbox: true });
        await page.send('cdl-front');
        page.answer({ 'cdl-front': CDL_FRONT });
        expect(storage.saves).toHaveLength(0);
    });
});

describe('what the CDL auto-fill sets', () => {
    it('is kept at once, the photo with what was read from it, and once only', () => {
        const page = renderLifecycle();
        page.keepNext();
        page.answer({ firstName: 'LUIS', city: 'AUSTIN', 'cdl-front': CDL_FRONT });
        page.answer({ firstName: 'Luis', city: 'AUSTIN', 'cdl-front': CDL_FRONT });

        expect(storage.saves).toHaveLength(1);
        expect(storage.saves[0].formData).toEqual({ firstName: 'LUIS', city: 'AUSTIN', 'cdl-front': CDL_FRONT });
        expect(storage.saves[0].options.lastStep).toBe(2);
    });

    it('is kept when nothing could be read and only the photo came back', () => {
        const page = renderLifecycle();
        page.keepNext();
        page.answer({ 'cdl-front': CDL_FRONT });
        expect(storage.saves.map((save) => save.formData)).toEqual([{ 'cdl-front': CDL_FRONT }]);
    });

    it('does not bring back an application discarded elsewhere', () => {
        const page = renderLifecycle({ discarded: true });
        page.keepNext();
        page.answer({ firstName: 'LUIS' });
        expect(storage.saves).toHaveLength(0);
    });
});

describe('answers replaced wholesale', () => {
    it('write nothing: a restore with files, then Start Over or the reset after submitting', () => {
        const page = renderLifecycle();
        page.answer({ 'cdl-front': CDL_FRONT, customAnswers: { q5: RESUME } });
        page.answer({});
        expect(storage.saves).toHaveLength(0);
    });

    it('write nothing after an upload the page never kept (a cancelled one)', async () => {
        const page = renderLifecycle({ formData: { firstName: 'Dana' } });
        await page.send('cdl-front');
        page.answer({});
        page.answer({ firstName: 'Dana' });
        expect(storage.saves).toHaveLength(0);
    });
});

describe('storedFilePaths', () => {
    it('names every stored file, wherever it is answered', () => {
        expect(storedFilePaths({
            customAnswers: { q5: RESUME, q1: 'text' },
            'cdl-front': CDL_FRONT,
            firstName: 'Dana',
            'cdl-back': { name: 'legacy.pdf', url: 'https://example.test/legacy.pdf' },
        })).toEqual(new Set([CDL_FRONT.storagePath, RESUME.storagePath]));
        expect(storedFilePaths({}).size).toBe(0);
        expect(storedFilePaths(undefined).size).toBe(0);
    });
});
