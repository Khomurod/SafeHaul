import { describe, expect, it } from 'vitest';

import {
    COMPANY_NOTICE_KEY,
    COMPANY_REVISION_KEY,
    companyEditSections,
    companyEditsToTake,
    companyFieldsAfter,
    companyRevisionIn,
    restoredWithRevision,
    saveOnTheWire,
    takeCompanyAnswers,
    takeCompanyEdits,
    withCompanyNotice,
    withoutCompanyKeys,
} from './companyEditsSync';

/** A revision is the edit's time in milliseconds. */
const R = 1791300000000;

describe('the revision a copy carries beside its answers', () => {
    it('is read only when it is one', () => {
        expect(companyRevisionIn({ [COMPANY_REVISION_KEY]: R })).toBe(R);
        expect(companyRevisionIn({ [COMPANY_REVISION_KEY]: 0 })).toBe(0);
        expect(companyRevisionIn({})).toBeNull();
        expect(companyRevisionIn({ [COMPANY_REVISION_KEY]: '5' })).toBeNull();
        expect(companyRevisionIn(null)).toBeNull();
    });

    it('never leaves the browser as an answer, and neither does the notice', () => {
        expect(withoutCompanyKeys({
            city: 'Dallas', [COMPANY_REVISION_KEY]: R, [COMPANY_NOTICE_KEY]: ['city'],
        })).toEqual({ city: 'Dallas' });
        expect(withoutCompanyKeys(undefined)).toEqual({});
    });
});

describe('a save on the wire', () => {
    it('says the revision beside the answers, from a browser holding its token', () => {
        const wire = saveOnTheWire({
            resumeToken: 't', formData: { city: 'Dallas', [COMPANY_REVISION_KEY]: R, [COMPANY_NOTICE_KEY]: ['city'] },
        });
        expect(wire.seenRevision).toBe(R);
        expect(wire.formData).toEqual({ city: 'Dallas' });
    });

    it('says 0 for a copy that never took an edit, so a later one still holds it back', () => {
        expect(saveOnTheWire({ resumeToken: 't', formData: { city: 'Austin' } }).seenRevision).toBe(0);
    });

    it('says nothing without a token: a refusal it could not act on would only stop its saves', () => {
        expect(saveOnTheWire({ resumeToken: null, formData: { [COMPANY_REVISION_KEY]: R } }).seenRevision).toBeNull();
    });
});

describe('a restored draft', () => {
    it('carries its revision inside its answers from here on', () => {
        const data = restoredWithRevision({ restored: true, draft: { companyRevision: R, formData: { city: 'Dallas' } } });
        expect(data.draft.formData).toEqual({ city: 'Dallas', [COMPANY_REVISION_KEY]: R });
    });

    it('reads as never edited when the server says nothing, and passes a miss through', () => {
        expect(restoredWithRevision({ draft: { formData: {} } }).draft.formData).toEqual({ [COMPANY_REVISION_KEY]: 0 });
        expect(restoredWithRevision({ restored: false })).toEqual({ restored: false });
    });
});

describe('which answers the carrier edited since a revision', () => {
    const edits = { city: R, employers: R + 10, zip: R - 10, phone: R, dob: R, 'sms-consent': R, ssn: R };

    it('are the ones edited after it, in a stable order', () => {
        expect(companyFieldsAfter(edits, R - 1)).toEqual(['city', 'employers']);
        expect(companyFieldsAfter(edits, R)).toEqual(['employers']);
        expect(companyFieldsAfter(edits, null)).toEqual(['city', 'employers', 'zip']);
    });

    it('never include what only the driver may change', () => {
        expect(companyFieldsAfter({ email: R, phone: R, lastName: R, dob: R, ssn: R, signature: R }, 0)).toEqual([]);
        expect(companyFieldsAfter({ 'consent-mvr': R, driverInitials: R, [COMPANY_REVISION_KEY]: R }, 0)).toEqual([]);
    });

    it('ignore what is not a revision', () => {
        expect(companyFieldsAfter({ city: 'x', zip: R }, 0)).toEqual(['zip']);
        expect(companyFieldsAfter(['city'], 0)).toEqual([]);
    });
});

describe('taking the carrier\'s answers', () => {
    const before = { firstName: 'Ada', employers: [['Acme', '214-555-0100']], customAnswers: { q1: 'yes', q2: 'mine' } };
    const server = { employers: [['Acme', '214-555-0199']], customAnswers: { q1: 'no' } };

    it('replaces a repeating answer whole, so a corrected row does not come back twice', () => {
        expect(takeCompanyAnswers(before, server, ['employers']).employers).toEqual([['Acme', '214-555-0199']]);
    });

    it('takes a custom question the carrier answered and keeps one only this copy has', () => {
        expect(takeCompanyAnswers(before, server, ['customAnswers']).customAnswers).toEqual({ q1: 'no', q2: 'mine' });
    });

    it('leaves an answer the server copy does not have', () => {
        expect(takeCompanyAnswers(before, server, ['firstName']).firstName).toBe('Ada');
    });
});

describe('the edits a refused save or submission brings in', () => {
    const onScreen = { city: 'Austin', zip: '75001', signature: 'data:image/png;base64,AAAA', [COMPANY_REVISION_KEY]: R - 60000 };
    const draft = {
        companyRevision: R,
        companyEdits: { city: R, zip: R },
        formData: { city: 'Dallas', zip: '75001' },
    };

    it('say which answers change', () => {
        expect(companyEditsToTake(onScreen, draft)).toEqual({ fields: ['city', 'zip'], changed: ['city'] });
    });

    it('take the carrier\'s answers, name the changed ones, drop the signature, and record the revision', () => {
        expect(takeCompanyEdits(onScreen, draft)).toEqual({
            city: 'Dallas',
            zip: '75001',
            [COMPANY_REVISION_KEY]: R,
            [COMPANY_NOTICE_KEY]: ['city'],
        });
    });

    it('keep the signature and say nothing when no answer changes', () => {
        const unchanged = takeCompanyEdits({ ...onScreen, city: 'Dallas' }, draft);
        expect(unchanged.signature).toBe('data:image/png;base64,AAAA');
        expect(unchanged).not.toHaveProperty(COMPANY_NOTICE_KEY);
        expect(unchanged[COMPANY_REVISION_KEY]).toBe(R);
    });

    it('take nothing a copy at the current revision already has', () => {
        const current = { city: 'Austin', [COMPANY_REVISION_KEY]: R };
        expect(takeCompanyEdits(current, draft)).toEqual(current);
    });
});

describe('the notice', () => {
    it('adds answers to what it already names, each once', () => {
        expect(withCompanyNotice({ [COMPANY_NOTICE_KEY]: ['zip'] }, ['city', 'zip'])[COMPANY_NOTICE_KEY]).toEqual(['city', 'zip']);
        const untouched = { city: 'Dallas' };
        expect(withCompanyNotice(untouched, [])).toBe(untouched);
    });

    it('names the sections, in the application\'s order', () => {
        expect(companyEditSections(['employers', 'city', 'zip', 'customAnswers'])).toEqual([
            'Address History', 'Employment History', 'Additional Questions',
        ]);
        expect(companyEditSections(['not-a-field'])).toEqual([]);
        expect(companyEditSections(null)).toEqual([]);
    });
});
