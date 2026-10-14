// The CDL photo taken for auto-fill is the application's CDL front, so the driver
// never photographs the licence twice, and what the AI reads only fills fields
// the driver left empty. The photo is sent and read side by side, and Cancel
// ends both.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    httpsCallable: vi.fn(),
    reserveUpload: vi.fn(),
    parseCdl: vi.fn(),
    transfer: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./guestUploadTransfer', async (importOriginal) => ({
    ...(await importOriginal()),
    transferGuestUpload: mocks.transfer,
}));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }),
}));
vi.mock('../components/application/publicApplyHelpers', async (importOriginal) => ({
    ...(await importOriginal()),
    fileToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

import { useCdlAutoFill } from './useCdlAutoFill';
import { GuestUploadError } from './guestUploadTransfer';

const STORAGE_PATH = 'companies/co-1/applications/guest_uploads/1_cdl.jpg';
const PHOTO = new File(['jpeg'], 'cdl.jpg', { type: 'image/jpeg' });
const FIELDS = {
    firstName: 'LUIS',
    lastName: 'ORTEGA',
    dateOfBirth: '03/14/1984',
    fullAddress: '2210 ELM ST, AUSTIN, TX 78701',
    cdlNumber: '41234567',
    expirationDate: '03/14/2030',
};

beforeEach(() => {
    vi.resetAllMocks();
    mocks.httpsCallable.mockImplementation((_functions, name) => (
        name === 'getSignedUploadUrl' ? mocks.reserveUpload : mocks.parseCdl
    ));
    mocks.reserveUpload.mockImplementation(async () => ({ data: { storagePath: STORAGE_PATH } }));
    mocks.transfer.mockImplementation(async () => {});
    mocks.parseCdl.mockImplementation(async () => ({ data: { fields: FIELDS } }));
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Runs one pick of `PHOTO` and returns the updater the hook handed back, if any. */
async function pickPhoto(applicationConfig = {}) {
    const onAutoFilled = vi.fn();
    const onReturnToChooser = vi.fn();
    const { result } = renderHook(() => useCdlAutoFill({
        companyId: 'co-1', applicationConfig, onAutoFilled, onReturnToChooser,
    }));
    await act(async () => {
        await result.current.handleCdlFileChange({ target: { files: [PHOTO], value: 'cdl.jpg' } });
    });
    return { onAutoFilled, onReturnToChooser, updater: onAutoFilled.mock.calls[0]?.[0] };
}

/** A promise the test settles itself. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Starts one pick of `PHOTO` without waiting for it, for a test that steps in while it runs. */
function startPick() {
    const onAutoFilled = vi.fn();
    const onReturnToChooser = vi.fn();
    const hook = renderHook(() => useCdlAutoFill({
        companyId: 'co-1', applicationConfig: {}, onAutoFilled, onReturnToChooser,
    }));
    let picked;
    act(() => {
        picked = hook.result.current.handleCdlFileChange({ target: { files: [PHOTO], value: 'cdl.jpg' } });
    });
    return { ...hook, picked, onAutoFilled, onReturnToChooser };
}

/** Lets the pick's awaits before the upload and the read (the photo's resize) run. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('useCdlAutoFill', () => {
    it("uploads the photo as the application's CDL front", async () => {
        const { updater, onReturnToChooser } = await pickPhoto();

        expect(mocks.reserveUpload).toHaveBeenCalledWith(expect.objectContaining({ folder: 'applications' }));
        expect(onReturnToChooser).not.toHaveBeenCalled();
        expect(updater({})).toEqual(expect.objectContaining({
            'cdl-front': { name: 'cdl.jpg', storagePath: STORAGE_PATH },
            firstName: 'LUIS',
            lastName: 'ORTEGA',
            dob: '1984-03-14',
            street: '2210 ELM ST',
            city: 'AUSTIN',
            state: 'Texas',
            zip: '78701',
            cdlNumber: '41234567',
            cdlExpiration: '2030-03-14',
            cdlState: 'Texas',
        }));
    });

    it('fills only the fields the driver left empty, and keeps a CDL front already attached', async () => {
        const { updater } = await pickPhoto();
        const earlier = { name: 'front.png', storagePath: 'companies/co-1/applications/guest_uploads/0_front.png' };

        const next = updater({ firstName: 'Luis Alberto', city: 'Round Rock', 'cdl-front': earlier });

        expect(next.firstName).toBe('Luis Alberto');
        expect(next.city).toBe('Round Rock');
        expect(next.lastName).toBe('ORTEGA');
        expect(next['cdl-front']).toBe(earlier);
    });

    it('keeps the photo and enters the form when the licence cannot be read', async () => {
        mocks.parseCdl.mockImplementation(async () => { throw new Error('unreadable'); });

        const { updater, onReturnToChooser } = await pickPhoto();

        expect(onReturnToChooser).not.toHaveBeenCalled();
        expect(mocks.showError).toHaveBeenCalledWith(expect.stringMatching(/photo is attached/));
        // The read can fail because the service is down, so the message must not
        // say the licence itself could not be read.
        expect(mocks.showError).not.toHaveBeenCalledWith(expect.stringMatching(/could not read your CDL/i));
        expect(updater({ firstName: '' })).toEqual({
            firstName: '',
            'cdl-front': { name: 'cdl.jpg', storagePath: STORAGE_PATH },
        });
    });

    it('fills the details when only the photo could not be sent, and asks for it on the licence step', async () => {
        mocks.transfer.mockImplementation(async () => { throw new GuestUploadError('stalled'); });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { updater, onReturnToChooser } = await pickPhoto();

        expect(onReturnToChooser).not.toHaveBeenCalled();
        const next = updater({});
        expect(next.firstName).toBe('LUIS');
        expect(next).not.toHaveProperty('cdl-front');
        expect(mocks.showError).toHaveBeenCalledWith(expect.stringMatching(/photo was not saved.*licence step/));
        expect(mocks.showSuccess).not.toHaveBeenCalled();
    });

    it('returns to the choice screen when the photo was not sent and the licence not read, keeping nothing', async () => {
        mocks.reserveUpload.mockImplementation(async () => { throw new Error('offline'); });
        mocks.parseCdl.mockImplementation(async () => { throw new Error('offline'); });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { onAutoFilled, onReturnToChooser } = await pickPhoto();

        expect(onAutoFilled).not.toHaveBeenCalled();
        expect(onReturnToChooser).toHaveBeenCalledTimes(1);
    });

    it('sends the photo and reads it side by side, so the read never waits for Storage', async () => {
        const upload = deferred();
        mocks.transfer.mockImplementation(() => upload.promise);
        const { picked, result, onAutoFilled } = startPick();
        await settle();

        expect(mocks.transfer).toHaveBeenCalledTimes(1);
        expect(mocks.parseCdl).toHaveBeenCalledWith({ companyId: 'co-1', imageDataUrl: 'data:image/jpeg;base64,AAAA' });
        expect(result.current.isParsingCdl).toBe(true);
        expect(onAutoFilled).not.toHaveBeenCalled();

        await act(async () => { upload.resolve(); await picked; });
        expect(result.current.isParsingCdl).toBe(false);
        expect(onAutoFilled.mock.calls[0][0]({})).toEqual(expect.objectContaining({
            firstName: 'LUIS',
            'cdl-front': { name: 'cdl.jpg', storagePath: STORAGE_PATH },
        }));
    });

    it('sends through the transfer that ends a stalled upload, with a signal Cancel can fire', async () => {
        await pickPhoto();

        expect(mocks.transfer).toHaveBeenCalledWith(
            STORAGE_PATH,
            expect.any(File),
            expect.objectContaining({ contentType: 'image/jpeg', signal: expect.any(AbortSignal) }),
        );
    });

    it('Cancel stops the upload, drops what comes back, and returns to the choice screen', async () => {
        const upload = deferred();
        const read = deferred();
        mocks.transfer.mockImplementation(() => upload.promise);
        mocks.parseCdl.mockImplementation(() => read.promise);
        const { picked, result, onAutoFilled, onReturnToChooser } = startPick();
        await settle();
        const { signal } = mocks.transfer.mock.calls[0][2];

        act(() => result.current.cancelCdlAutoFill());

        expect(signal.aborted).toBe(true);
        expect(result.current.isParsingCdl).toBe(false);
        expect(onReturnToChooser).toHaveBeenCalledTimes(1);
        await act(async () => {
            upload.reject(new GuestUploadError('cancelled'));
            read.resolve({ data: { fields: FIELDS } });
            await picked;
        });
        expect(onAutoFilled).not.toHaveBeenCalled();
        expect(mocks.showSuccess).not.toHaveBeenCalled();
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    it('stops the upload when the page goes, and reports nothing after', async () => {
        const upload = deferred();
        mocks.transfer.mockImplementation(() => upload.promise);
        const { picked, unmount, onAutoFilled } = startPick();
        await settle();
        const { signal } = mocks.transfer.mock.calls[0][2];

        unmount();

        expect(signal.aborted).toBe(true);
        await act(async () => { upload.reject(new GuestUploadError('cancelled')); await picked; });
        expect(onAutoFilled).not.toHaveBeenCalled();
        expect(mocks.showError).not.toHaveBeenCalled();
    });

    describe('at a company that hides the CDL upload', () => {
        const hidden = { cdlUpload: { hidden: true, required: false } };

        it('reads the photo but never stores or attaches it', async () => {
            // It used to be uploaded to an `autofill` folder no one ever opened: a
            // copy of a driver's licence kept for nothing.
            const { updater } = await pickPhoto(hidden);

            expect(mocks.reserveUpload).not.toHaveBeenCalled();
            expect(mocks.transfer).not.toHaveBeenCalled();
            expect(mocks.parseCdl).toHaveBeenCalledWith({ companyId: 'co-1', imageDataUrl: 'data:image/jpeg;base64,AAAA' });
            const next = updater({});
            expect(next.firstName).toBe('LUIS');
            expect(next).not.toHaveProperty('cdl-front');
        });

        it('returns to the choice screen when the licence cannot be read, as nothing was kept', async () => {
            mocks.parseCdl.mockImplementation(async () => { throw new Error('unreadable'); });

            const { onAutoFilled, onReturnToChooser } = await pickPhoto(hidden);

            expect(onAutoFilled).not.toHaveBeenCalled();
            expect(onReturnToChooser).toHaveBeenCalledTimes(1);
        });

        it("shows the server's sentence, which says what to do next", async () => {
            const message = 'AI auto-fill is temporarily unavailable. Please try again in a few minutes, or enter your licence details manually.';
            mocks.parseCdl.mockImplementation(async () => { throw Object.assign(new Error(message), { code: 'functions/unavailable' }); });

            await pickPhoto(hidden);

            expect(mocks.showError).toHaveBeenCalledWith(message);
        });

        it('replaces a bare code the server never sent, such as a browser timeout', async () => {
            mocks.parseCdl.mockImplementation(async () => {
                throw Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' });
            });

            await pickPhoto(hidden);

            expect(mocks.showError).not.toHaveBeenCalledWith('deadline-exceeded');
            expect(mocks.showError).toHaveBeenCalledWith(expect.stringMatching(/continue manually/i));
        });
    });
});
