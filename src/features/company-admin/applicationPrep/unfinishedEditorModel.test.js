import { describe, it, expect } from 'vitest';
import DRIVER_ONLY_FIELDS from '../../../../functions/shared/driverOnlyFields.json';
import {
    CUSTOM_ANSWERS, EDITABLE_FIELDS, changedSectionTitles, editRequest, heldLocks, isDocumentOffered, isOffered,
} from './unfinishedEditorModel';

const offered = (fieldId, { applicationConfig, answers = {}, loaded = {} } = {}) => (
    isOffered(fieldId, { applicationConfig, answers, loaded })
);

describe('what a Company Admin may change', () => {
    it('is every answer but the ones only the driver gives', () => {
        expect(EDITABLE_FIELDS).toEqual(expect.arrayContaining(['firstName', 'city', 'employers', 'cdl-front', CUSTOM_ANSWERS]));
        for (const field of DRIVER_ONLY_FIELDS) expect(EDITABLE_FIELDS).not.toContain(field);
        // The hours-of-service statement is the driver's own, about their own week.
        expect(EDITABLE_FIELDS).not.toContain('hosDailyHours');
    });
});

describe('what the editor offers', () => {
    it('never an answer only the driver gives', () => {
        for (const field of ['email', 'phone', 'lastName', 'dob', 'ssn', 'sms-consent', 'consent-mvr', 'hosLastRelievedDate']) {
            expect(offered(field, { answers: { [field]: 'x' }, loaded: { [field]: 'x' } })).toBe(false);
        }
    });

    it('never a question the company hid', () => {
        expect(offered('referralSource')).toBe(true);
        expect(offered('referralSource', { applicationConfig: { referralSource: { hidden: true } } })).toBe(false);
    });

    it('a question that depends on another answer once that answer allows it, as it stands now', () => {
        expect(offered('otherName', { answers: { 'known-by-other-name': 'no' } })).toBe(false);
        expect(offered('otherName', { answers: { 'known-by-other-name': 'yes' } })).toBe(true);
        expect(offered('felonyExplanation', { answers: { 'has-felony': 'yes' } })).toBe(true);
    });

    it('a question asked only in some cases once it has an answer, loaded or typed', () => {
        expect(offered('positionApplyingTo')).toBe(false);
        expect(offered('positionApplyingTo', { loaded: { positionApplyingTo: 'Company driver' } })).toBe(true);
        // Cleared in the editor, it stays on screen until the editor is left.
        expect(offered('positionApplyingTo', { loaded: { positionApplyingTo: 'Company driver' }, answers: { positionApplyingTo: '' } })).toBe(true);
    });

    it('the documents the carrier holds, whether or not the driver attached one', () => {
        expect(isDocumentOffered('psp-report-upload', {})).toBe(true);
        expect(isDocumentOffered('medical-card-upload', {})).toBe(true);
        expect(isDocumentOffered('medical-card-upload', { medCardUpload: { hidden: true } })).toBe(false);
        // The driver's own consent forms stay theirs.
        expect(isDocumentOffered('mvr-consent-upload', {})).toBe(false);
        expect(isDocumentOffered('city', {})).toBe(false);
    });
});

describe('the employer locks an edit keeps', () => {
    const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
    const blue = { companyName: 'Blue Line', dotNumber: '654321' };
    const LOCKS = [{ signature: 'dot:123456', ...acme }, { signature: 'dot:654321', ...blue }];

    it('are the ones the loaded employers hold', () => {
        expect(heldLocks(LOCKS, { employers: [blue, acme] })).toEqual(LOCKS);
    });

    it('never one the driver\'s own rows already fail, removed or renamed', () => {
        expect(heldLocks(LOCKS, { employers: [{ ...acme, companyName: 'Acme Logistics' }] })).toEqual([]);
        expect(heldLocks(LOCKS, {})).toEqual([]);
        expect(heldLocks(undefined, { employers: [acme] })).toEqual([]);
    });
});

describe('what a save sends', () => {
    it('only the answers that changed, each beside the value loaded', () => {
        const loaded = { city: 'Austin', zip: '73301', employers: [{ companyName: 'Acme' }] };
        const answers = { ...loaded, city: 'Dallas', cdlNumber: 'D1' };

        expect(editRequest(answers, loaded)).toEqual({
            changes: { city: 'Dallas', cdlNumber: 'D1' },
            base: { city: 'Austin', cdlNumber: null },
        });
    });

    it('nothing when only the order of a row\'s fields differs', () => {
        expect(editRequest(
            { employers: [{ startDate: '2019-04', companyName: 'Acme' }] },
            { employers: [{ companyName: 'Acme', startDate: '2019-04' }] },
        )).toEqual({ changes: {}, base: {} });
    });

    it('a cleared answer as null, and never an answer the server would refuse', () => {
        expect(editRequest({ city: undefined, email: 'new@example.test' }, { city: 'Austin', email: 'old@example.test' }))
            .toEqual({ changes: { city: null }, base: { city: 'Austin' } });
    });

    it('names the sections it changed, in the application\'s order', () => {
        expect(changedSectionTitles(['employers', 'city', CUSTOM_ANSWERS])).toEqual([
            'Address History', 'Employment History', 'Additional Questions',
        ]);
        expect(changedSectionTitles([])).toEqual([]);
    });
});
