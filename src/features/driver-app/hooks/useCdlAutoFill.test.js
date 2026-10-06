// The CDL photo taken for auto-fill is the application's CDL front, so the driver
// never photographs the licence twice, and what the AI reads only fills fields
// the driver left empty.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    httpsCallable: vi.fn(),
    reserveUpload: vi.fn(),
    parseCdl: vi.fn(),
    uploadBytes: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(() => ({})), uploadBytes: mocks.uploadBytes }));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }),
}));
vi.mock('../components/application/publicApplyHelpers', async (importOriginal) => ({
    ...(await importOriginal()),
    fileToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

import { useCdlAutoFill } from './useCdlAutoFill';

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
    mocks.uploadBytes.mockImplementation(async () => ({}));
    mocks.parseCdl.mockImplementation(async () => ({ data: { fields: FIELDS } }));
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

    it('returns to the choice screen when the upload itself fails, keeping nothing', async () => {
        mocks.reserveUpload.mockImplementation(async () => { throw new Error('offline'); });

        const { onAutoFilled, onReturnToChooser } = await pickPhoto();

        expect(onAutoFilled).not.toHaveBeenCalled();
        expect(onReturnToChooser).toHaveBeenCalledTimes(1);
        expect(mocks.parseCdl).not.toHaveBeenCalled();
    });

    describe('at a company that hides the CDL upload', () => {
        const hidden = { cdlUpload: { hidden: true, required: false } };

        it('reads the photo but never attaches it to the application', async () => {
            const { updater } = await pickPhoto(hidden);

            expect(mocks.reserveUpload).toHaveBeenCalledWith(expect.objectContaining({ folder: 'autofill' }));
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
