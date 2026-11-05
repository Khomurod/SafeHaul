/**
 * The DQ file's "what's in it and what's missing" list, from the record's DQ
 * entries and its employers' verifications. Pure: no reads, no clock but the
 * one it is given. Expiry is judged by the UTC day.
 *
 * All names, files and ids below are artificial.
 */
import { describe, expect, it } from 'vitest';
import { buildDqChecklist } from './dqChecklist';
import { DATED_FILE_TYPES, DQ_FILE_TYPES, dqKindOf, takesExpiration } from './dqFileTypes';
import { calendarDay, describeExpiry, expiryStatus, todayUtc } from './dqExpiry';

const NOW = new Date('2026-11-04T15:00:00Z');
const item = (checklist, id) => checklist.items.find((entry) => entry.id === id);
const build = (files, record = {}) => buildDqChecklist({ files, record, now: NOW });

describe('the DQ file types', () => {
    it('keeps the first type as the default, adds CDL, and takes a valid-until date on CDL, medical card and MVR', () => {
        expect(DQ_FILE_TYPES[0]).toBe('Application for Employment');
        expect(DQ_FILE_TYPES).toHaveLength(12);
        expect(DQ_FILE_TYPES).toContain('CDL');
        expect(DQ_FILE_TYPES.at(-1)).toBe('Other');
        expect([...DATED_FILE_TYPES].sort()).toEqual(['CDL', 'MVR (Annual)', 'Medical Card']);
    });

    it('names an entry by what the server filed it as, else by the type the team chose', () => {
        expect(dqKindOf({ fileType: 'Application for Employment', source: 'preserved_submission', requiresAuditedAccess: true })).toBe('application');
        expect(dqKindOf({ type: 'license_front', fileType: 'CDL Front' })).toBe('cdl');
        expect(dqKindOf({ type: 'license_back', fileType: 'CDL Back' })).toBe('cdl');
        expect(dqKindOf({ type: 'medical_card', fileType: 'Medical Card' })).toBe('medical_card');
        expect(dqKindOf({ type: 'mvr', fileType: 'MVR' })).toBe('mvr');
        expect(dqKindOf({ type: 'pev_result', fileType: 'PEV Result – Medical Card Haulers' })).toBe('pev_result');
        expect(dqKindOf({ type: 'mvr_consent', fileType: 'MVR Consent' })).toBe('mvr_consent');
        expect(dqKindOf({ type: 'psp_report', fileType: 'Recruiter PSP' })).toBe('psp');
        expect(dqKindOf({ fileType: 'MVR (Annual)' })).toBe('mvr');
        expect(dqKindOf({ fileType: 'CDL' })).toBe('cdl');
        expect(dqKindOf({ fileType: 'PSP Report' })).toBe('psp');
        expect(dqKindOf({ fileType: 'Previous Employer Inquiry (3yr)' })).toBe('pev_inquiry');
        expect(dqKindOf({ fileType: 'Other' })).toBeNull();
        expect(dqKindOf(null)).toBeNull();
    });

    it('lets a CDL, medical card, MVR or TWIC record carry a date, and nothing else', () => {
        expect(takesExpiration({ type: 'license_front' })).toBe(true);
        expect(takesExpiration({ fileType: 'Medical Card' })).toBe(true);
        expect(takesExpiration({ fileType: 'MVR (Annual)' })).toBe(true);
        expect(takesExpiration({ type: 'twic_card' })).toBe(true);
        expect(takesExpiration({ fileType: 'Road Test Certificate' })).toBe(false);
        expect(takesExpiration({ source: 'preserved_submission', requiresAuditedAccess: true })).toBe(false);
        expect(takesExpiration({ type: 'signed_document', fileType: 'Signed document – MVR release' })).toBe(false);
    });
});

describe('expiry, by the UTC day', () => {
    it('reads today as the UTC calendar day', () => {
        expect(todayUtc(new Date('2026-11-04T23:30:00-06:00'))).toBe('2026-11-05');
    });

    it('is expired from the day after the date, expiring inside thirty days, valid after', () => {
        expect(expiryStatus('2026-11-03', '2026-11-04')).toEqual({ state: 'expired', day: '2026-11-03', daysLeft: -1 });
        expect(expiryStatus('2026-11-04', '2026-11-04')).toEqual({ state: 'expiring', day: '2026-11-04', daysLeft: 0 });
        expect(expiryStatus('2026-12-03', '2026-11-04')).toEqual({ state: 'expiring', day: '2026-12-03', daysLeft: 29 });
        expect(expiryStatus('2026-12-04', '2026-11-04')).toEqual({ state: 'valid', day: '2026-12-04', daysLeft: 30 });
    });

    it('says it in words, with the date as a calendar day', () => {
        expect(describeExpiry(expiryStatus('2026-10-01', '2026-11-04'))).toBe('Expired on Oct 1, 2026');
        expect(describeExpiry(expiryStatus('2026-11-04', '2026-11-04'))).toBe('Expires today, Nov 4, 2026');
        expect(describeExpiry(expiryStatus('2026-11-05', '2026-11-04'))).toBe('Expires on Nov 5, 2026, in 1 day');
        expect(describeExpiry(expiryStatus('2026-11-20', '2026-11-04'))).toBe('Expires on Nov 20, 2026, in 16 days');
        expect(describeExpiry(expiryStatus('2029-06-30', '2026-11-04'))).toBe('Valid until Jun 30, 2029');
        expect(describeExpiry(null)).toBe('');
    });

    it('has no status for a date it cannot read', () => {
        expect(expiryStatus('', '2026-11-04')).toBeNull();
        expect(expiryStatus('2026-02-30', '2026-11-04')).toBeNull();
        expect(calendarDay('03/01/2027')).toBeNull();
        expect(calendarDay('2027-03-01T00:00:00Z')).toBe('2027-03-01');
    });
});

describe('the checklist', () => {
    it('lists every item in order, the optional ones marked, the PSP report among them', () => {
        const checklist = build([]);
        expect(checklist.items.map(({ id, optional }) => [id, optional])).toEqual([
            ['application', false],
            ['cdl', false],
            ['medical_card', false],
            ['mvr', false],
            ['pev', false],
            ['road_test', false],
            ['clearinghouse_full', false],
            ['psp', true],
            ['clearinghouse_annual', true],
            ['violations_annual', true],
            ['annual_review', true],
        ]);
    });

    it('counts the missing items that are not optional', () => {
        const checklist = build([]);
        // No employers listed: nothing to verify, so not missing.
        expect(item(checklist, 'pev').state).toBe('none');
        expect(checklist.missing).toBe(6);
        expect(checklist.expired).toBe(0);
        expect(item(checklist, 'psp').state).toBe('missing');
    });

    it('finds the preserved original, the driver\'s uploads and the team\'s', () => {
        const checklist = build([
            { id: 'application-pdf-v1', fileType: 'Application for Employment', source: 'preserved_submission', requiresAuditedAccess: true },
            { id: 'license_front', type: 'license_front', fileType: 'CDL Front', isSynced: true, expirationDate: '2029-06-30' },
            { id: 'auto-1', fileType: 'Road Test Certificate' },
            { id: 'auto-2', fileType: 'PSP Report' },
        ]);
        expect(item(checklist, 'application')).toMatchObject({ state: 'present', count: 1 });
        expect(item(checklist, 'cdl')).toMatchObject({ state: 'present', expiry: { state: 'valid', day: '2029-06-30' } });
        expect(item(checklist, 'road_test').state).toBe('present');
        expect(item(checklist, 'psp').state).toBe('present');
        expect(checklist.missing).toBe(3);
    });

    it('leaves out an entry the team removed, and every entry that is no checklist item', () => {
        const checklist = build([
            { id: 'medical_card', type: 'medical_card', fileType: 'Medical Card', expirationDate: '2027-01-01', removedAt: 'then' },
            { id: 'mvr_consent', type: 'mvr_consent', fileType: 'MVR Consent' },
            { id: 'auto-1', fileType: 'Other' },
        ]);
        expect(item(checklist, 'medical_card').state).toBe('missing');
        expect(item(checklist, 'mvr').state).toBe('missing');
    });

    it('marks a dated item expired when its newest date has passed, and counts it', () => {
        const checklist = build([
            { id: 'medical_card', type: 'medical_card', fileType: 'Medical Card', expirationDate: '2026-10-01' },
            { id: 'auto-1', fileType: 'MVR (Annual)', expirationDate: '2026-11-20' },
        ]);
        expect(item(checklist, 'medical_card')).toMatchObject({ state: 'expired', expiry: { state: 'expired', day: '2026-10-01' } });
        expect(item(checklist, 'mvr')).toMatchObject({ state: 'present', expiry: { state: 'expiring', day: '2026-11-20', daysLeft: 16 } });
        expect(checklist.expired).toBe(1);
    });

    it('takes the newest card of a type, so a renewal outranks the card it replaced', () => {
        const checklist = build([
            { id: 'medical_card', type: 'medical_card', fileType: 'Medical Card', expirationDate: '2026-01-31' },
            { id: 'auto-1', fileType: 'Medical Card', expirationDate: '2028-01-31' },
        ]);
        expect(item(checklist, 'medical_card')).toMatchObject({ state: 'present', count: 2, expiry: { day: '2028-01-31' } });
    });

    it('says when a dated item has no date recorded', () => {
        const checklist = build([{ id: 'auto-1', fileType: 'CDL' }]);
        expect(item(checklist, 'cdl')).toMatchObject({ state: 'present', expiry: null, undated: true });
    });
});

describe('previous employers of the last three years', () => {
    const APPLIED = { lifecycle: { submittedAt: '2026-10-01T12:00:00.000Z' } };

    it('lists the employers of the three years before the application, by their own end dates', () => {
        const checklist = build([], {
            ...APPLIED,
            employers: [
                { companyName: 'Prairie Line Freight', startDate: '2024-02', endDate: '', verification: { status: 'Completed' } },
                { companyName: 'Old Mesa Carriers', startDate: '2018-01', endDate: '2021-06' },
                { name: 'Lakeshore Hauling', startDate: '2022-01', endDate: '2023-12', verification: { status: 'Sent' } },
            ],
        });
        const pev = item(checklist, 'pev');
        expect(pev.employers).toEqual([
            { key: '0', name: 'Prairie Line Freight', state: 'answered' },
            { key: '2', name: 'Lakeshore Hauling', state: 'waiting' },
        ]);
        expect(pev.state).toBe('missing');
    });

    it('is in the file when every one answered or was marked no response after the attempts', () => {
        const checklist = build([], {
            ...APPLIED,
            employers: [
                { companyName: 'Prairie Line Freight', endDate: '2026-09', verification: { status: 'Completed' } },
                { companyName: 'Lakeshore Hauling', endDate: '2025-01', verification: { status: 'No Response (Good Faith Documented)' } },
            ],
        });
        const pev = item(checklist, 'pev');
        expect(pev.state).toBe('present');
        expect(pev.employers.map((row) => row.state)).toEqual(['answered', 'no_response']);
    });

    it('names an employer nobody asked yet, and counts the inquiries filed by hand without matching them', () => {
        const checklist = build([
            { id: 'auto-1', fileType: 'Previous Employer Inquiry (3yr)' },
            { id: 'pev_result_ab', type: 'pev_result', fileType: 'PEV Result – Prairie Line Freight' },
        ], {
            ...APPLIED,
            employers: [{ companyName: 'Prairie Line Freight', endDate: '2026-09' }, { endDate: '2026-01', verification: { status: 'Not Started' } }],
        });
        const pev = item(checklist, 'pev');
        expect(pev.employers).toEqual([
            { key: '0', name: 'Prairie Line Freight', state: 'not_requested' },
            { key: '1', name: 'Employer 2', state: 'not_requested' },
        ]);
        expect(pev).toMatchObject({ state: 'missing', handInquiries: 1, results: 1 });
    });

    it('counts from today for a record that was never submitted', () => {
        const checklist = build([], { employers: [{ companyName: 'Prairie Line Freight', endDate: '2023-11' }] });
        expect(item(checklist, 'pev').employers).toHaveLength(1);
        const older = build([], { employers: [{ companyName: 'Prairie Line Freight', endDate: '2023-10' }] });
        expect(item(older, 'pev').state).toBe('none');
    });

    it('reads a Firestore timestamp as the application date when there is no submission time', () => {
        const createdAt = { toDate: () => new Date('2024-01-15T00:00:00Z') };
        const checklist = build([], { createdAt, employers: [{ companyName: 'Prairie Line Freight', endDate: '2021-02' }] });
        expect(item(checklist, 'pev').employers).toHaveLength(1);
    });
});
