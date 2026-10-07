import { describe, it, expect } from 'vitest';

import { reconcileApplicationDraft } from './reconcileApplicationDraft';
import { COMPANY_NOTICE_KEY, COMPANY_REVISION_KEY } from './companyEditsSync';

/**
 * Reconciling on load when a Company Admin has edited the application.
 *
 * The answers the carrier edited after this copy's revision come from the server
 * copy whichever side wins, replaced rather than merged, and the driver is told.
 * Everything else follows the ordinary rules in `reconcileApplicationDraft.test.js`.
 */

/** A revision is the edit's time in milliseconds. */
const R = 1791300000000;
const OLD_ROW = ['Acme', '214-555-0100'];
const CORRECTED_ROW = ['Acme', '214-555-0199'];

const local = (data, { localSeq = 4, syncedSeq = 4 } = {}) => ({
    data,
    lastStep: 2,
    meta: { localSeq, syncedSeq, savedAt: '2026-08-19T10:00:00.000Z' },
});

/** As `restoreFromStoredToken` hands it over: the revision inside the answers. */
const edited = (formData, companyEdits, { clientSeq = 4 } = {}) => ({
    formData: { ...formData, [COMPANY_REVISION_KEY]: R },
    stepIndex: 2,
    clientSeq,
    companyEdits,
});

describe('a carrier\'s edits on load', () => {
    it('replace a corrected row instead of keeping both, when the server copy wins', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ firstName: 'Ada', employers: [OLD_ROW] }),
            server: edited({ firstName: 'Ada', employers: [CORRECTED_ROW] }, { employers: R }),
        });

        expect(resolved.source).toBe('server');
        expect(resolved.formData.employers).toEqual([CORRECTED_ROW]);
        expect(resolved.formData[COMPANY_REVISION_KEY]).toBe(R);
        expect(resolved.formData[COMPANY_NOTICE_KEY]).toEqual(['employers']);
    });

    it('win over unsynced local work for the answers they changed, and only those', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin', zip: '73301' }, { localSeq: 6, syncedSeq: 4 }),
            server: edited({ city: 'Dallas', zip: '75001' }, { city: R }),
        });

        expect(resolved.source).toBe('local');
        expect(resolved.formData.city).toBe('Dallas');
        expect(resolved.formData.zip).toBe('73301');
        expect(resolved.formData[COMPANY_NOTICE_KEY]).toEqual(['city']);
    });

    it('are not taken again by a copy that already has them', () => {
        // Taken earlier, then changed by the driver on this device and not yet sent.
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin', [COMPANY_REVISION_KEY]: R }, { localSeq: 6, syncedSeq: 4 }),
            server: edited({ city: 'Dallas' }, { city: R }),
        });

        expect(resolved.formData.city).toBe('Austin');
        expect(resolved.formData).not.toHaveProperty(COMPANY_NOTICE_KEY);
    });

    it('do not outrank what the driver typed while the page was loading', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin' }),
            server: edited({ city: 'Dallas' }, { city: R }),
            live: { city: 'Houston' },
        });

        expect(resolved.formData.city).toBe('Houston');
    });

    it('leave the server\'s revision on the copy, whatever revision the page held before', () => {
        // The revision is not something the driver typed, so the page's own copy of
        // it never outranks the one the restore just applied.
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin' }),
            server: edited({ city: 'Dallas' }, { city: R }),
            live: { city: 'Austin', [COMPANY_REVISION_KEY]: R - 5 },
        });

        expect(resolved.formData[COMPANY_REVISION_KEY]).toBe(R);
        expect(resolved.formData.city).toBe('Dallas');
    });

    it('are all named on a device that holds no copy of this application', () => {
        const resolved = reconcileApplicationDraft({
            local: null,
            server: edited({ city: 'Dallas', employers: [CORRECTED_ROW] }, { city: R, employers: R }),
        });

        expect(resolved.formData.city).toBe('Dallas');
        expect(resolved.formData[COMPANY_NOTICE_KEY]).toEqual(['city', 'employers']);
        expect(resolved.formData[COMPANY_REVISION_KEY]).toBe(R);
    });

    it('never reach what only the driver may change', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ phone: '5551234', dob: '1988-03-11' }, { localSeq: 6, syncedSeq: 4 }),
            server: edited({ phone: '5550000', dob: '1990-01-01' }, { phone: R, dob: R }),
        });

        expect(resolved.formData.phone).toBe('5551234');
        expect(resolved.formData.dob).toBe('1988-03-11');
        expect(resolved.formData).not.toHaveProperty(COMPANY_NOTICE_KEY);
    });

    it('keep a notice the driver has not dismissed yet, and add to it', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin', [COMPANY_NOTICE_KEY]: ['zip'] }),
            server: edited({ city: 'Dallas' }, { city: R }),
        });

        expect(resolved.formData[COMPANY_NOTICE_KEY]).toEqual(['city', 'zip']);
    });

    it('leave everything as it was on a draft nobody edited', () => {
        const resolved = reconcileApplicationDraft({
            local: local({ city: 'Austin' }, { localSeq: 6, syncedSeq: 4 }),
            server: { formData: { city: 'Dallas', [COMPANY_REVISION_KEY]: 0 }, stepIndex: 2, clientSeq: 4, companyEdits: {} },
        });

        expect(resolved.formData).toEqual({ city: 'Austin', [COMPANY_REVISION_KEY]: 0 });
    });
});
