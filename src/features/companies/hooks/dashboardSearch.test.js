import { describe, it, expect } from 'vitest';
import {
    classifySearchTerm,
    buildSearchPlans,
    recordMatchesSearch,
    applyClientSideFilters,
    mergeSearchResults,
    leadStatusMatchesSegment,
    PREFIX_END,
} from './dashboardSearch';

describe('classifySearchTerm', () => {
    it('returns null for empty/whitespace input', () => {
        expect(classifySearchTerm('')).toBeNull();
        expect(classifySearchTerm('   ')).toBeNull();
        expect(classifySearchTerm(null)).toBeNull();
    });

    it('classifies emails', () => {
        expect(classifySearchTerm(' Driver@Example.COM ')).toEqual({
            type: 'email', value: 'driver@example.com', raw: 'Driver@Example.COM',
        });
    });

    it('classifies phones regardless of punctuation', () => {
        expect(classifySearchTerm('(555) 123-4567').type).toBe('phone');
        expect(classifySearchTerm('555.123.4567').value).toBe('5551234567');
        expect(classifySearchTerm('+1 555 123 4567').value).toBe('5551234567');
    });

    it('classifies confirmation numbers case-insensitively', () => {
        expect(classifySearchTerm('saf-2026-a7b2c')).toEqual({
            type: 'confirmation', value: 'SAF-2026-A7B2C', raw: 'saf-2026-a7b2c',
        });
    });

    it('classifies 20-char application ids and anon ids', () => {
        expect(classifySearchTerm('3a7f2b9c8d1e4f5a6b7c').type).toBe('applicationId');
        expect(classifySearchTerm('3a7f2b9c8d1e4f5a6b7c_2').type).toBe('applicationId');
        expect(classifySearchTerm('anon_lm3k_9dj2').type).toBe('applicationId');
    });

    it('falls back to name for everything else', () => {
        expect(classifySearchTerm('McDonald')).toEqual({
            type: 'name', value: 'mcdonald', raw: 'McDonald',
        });
        expect(classifySearchTerm('  John   Smith ')).toEqual({
            type: 'name', value: 'john smith', raw: 'John   Smith',
        });
        // Too few digits for a phone
        expect(classifySearchTerm('123-45').type).toBe('name');
    });
});

describe('buildSearchPlans', () => {
    it('name terms produce normalized prefix plans plus legacy title-case fallbacks', () => {
        const plans = buildSearchPlans(classifySearchTerm('mcdonald'));
        expect(plans).toEqual([
            { kind: 'prefix', field: 'firstNameNormalized', value: 'mcdonald' },
            { kind: 'prefix', field: 'lastNameNormalized', value: 'mcdonald' },
            { kind: 'prefix', field: 'fullNameNormalized', value: 'mcdonald' },
            { kind: 'prefix', field: 'lastName', value: 'Mcdonald' },
            { kind: 'prefix', field: 'firstName', value: 'Mcdonald' },
        ]);
    });

    it('phone terms query phoneNormalized plus the raw legacy string', () => {
        const plans = buildSearchPlans(classifySearchTerm('(555) 123-4567'));
        expect(plans).toEqual([
            { kind: 'eq', field: 'phoneNormalized', value: '5551234567' },
            { kind: 'eq', field: 'phone', value: '(555) 123-4567' },
        ]);
    });

    it('application ids include a direct docId lookup', () => {
        const plans = buildSearchPlans(classifySearchTerm('3a7f2b9c8d1e4f5a6b7c'));
        expect(plans[0]).toEqual({ kind: 'docId', value: '3a7f2b9c8d1e4f5a6b7c' });
    });

    it('every plan is single-field (no composite-index requirements)', () => {
        for (const term of ['john', 'a@b.co', '5551234567', 'SAF-2026-AAAAA', '3a7f2b9c8d1e4f5a6b7c']) {
            for (const plan of buildSearchPlans(classifySearchTerm(term))) {
                expect(['eq', 'prefix', 'docId']).toContain(plan.kind);
            }
        }
    });

    it('PREFIX_END is the Firestore high-codepoint sentinel', () => {
        expect(PREFIX_END).toBe('');
    });
});

describe('recordMatchesSearch', () => {
    const record = {
        id: '3a7f2b9c8d1e4f5a6b7c',
        applicationId: '3a7f2b9c8d1e4f5a6b7c',
        firstName: 'James',
        lastName: 'McDonald',
        email: 'James.McDonald@Example.com',
        phone: '(312) 555-0188',
        confirmationNumber: 'SAF-2026-JAME5',
    };

    it('matches by first name, last name, and full name, case-insensitively', () => {
        expect(recordMatchesSearch(record, classifySearchTerm('james'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('MCDON'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('james mcdonald'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('james mc'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('zeta'))).toBe(false);
    });

    it('matches phone in any format', () => {
        expect(recordMatchesSearch(record, classifySearchTerm('3125550188'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('(312) 555-0188'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('+1 312 555 0188'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('312555'))).toBe(false); // partial phone: no match
    });

    it('matches email case-insensitively', () => {
        expect(recordMatchesSearch(record, classifySearchTerm('james.mcdonald@example.com'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('other@example.com'))).toBe(false);
    });

    it('matches confirmation number case-insensitively', () => {
        expect(recordMatchesSearch(record, classifySearchTerm('saf-2026-jame5'))).toBe(true);
        expect(recordMatchesSearch(record, classifySearchTerm('SAF-2026-XXXXX'))).toBe(false);
    });

    it('matches application id by doc id or field', () => {
        expect(recordMatchesSearch(record, classifySearchTerm('3A7F2B9C8D1E4F5A6B7C'))).toBe(true);
    });

    it('everything matches a null classification (no search term)', () => {
        expect(recordMatchesSearch(record, null)).toBe(true);
    });
});

describe('applyClientSideFilters', () => {
    const apps = [
        { id: '1', status: 'New Application', state: 'TX', driverType: ['Dry Van'], assignedTo: 'u1' },
        { id: '2', status: 'New', state: 'IL', driverType: ['Reefer'], assignedTo: '' },
        { id: '3', status: 'Hired', state: 'TX', driverType: ['Flatbed'], assignedTo: 'u1' },
        { id: '4', status: 'Rejected', state: 'NV', driverType: ['Reefer'], assignedTo: 'u2' },
        { id: '5', status: 'In Process', state: 'NY', driverType: 'Dry Van', assignedTo: '' },
    ];

    it('the new segment includes both New and New Application', () => {
        const out = applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'new' });
        expect(out.map((r) => r.id)).toEqual(['1', '2']);
    });

    it('declined includes Rejected; hired matches Hired', () => {
        expect(applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'declined' }).map((r) => r.id)).toEqual(['4']);
        expect(applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'hired' }).map((r) => r.id)).toEqual(['3']);
    });

    it('combines segment with state, driverType (string or array), and myAssignments', () => {
        expect(applyClientSideFilters(apps, {
            activeTab: 'applications', pipelineSegment: 'new', filters: { state: 'tx' },
        }).map((r) => r.id)).toEqual(['1']);

        expect(applyClientSideFilters(apps, {
            activeTab: 'applications', pipelineSegment: 'all', filters: { driverType: 'Dry Van' },
        }).map((r) => r.id)).toEqual(['1', '5']);

        expect(applyClientSideFilters(apps, {
            activeTab: 'applications', pipelineSegment: 'all',
            filters: { myAssignmentsOnly: true }, currentUid: 'u1',
        }).map((r) => r.id)).toEqual(['1', '3']);
    });

    it('assignee filter supports the unassigned sentinel', () => {
        expect(applyClientSideFilters(apps, {
            activeTab: 'applications', pipelineSegment: 'all', filters: { assignee: '__unassigned__' },
        }).map((r) => r.id)).toEqual(['2', '5']);
    });

    it('lead segments keep their own vocabulary', () => {
        expect(leadStatusMatchesSegment('Contact Attempt 2', 'attempting')).toBe(true);
        expect(leadStatusMatchesSegment('New Lead', 'attempting')).toBe(false);
        expect(leadStatusMatchesSegment('In Process', 'in_process')).toBe(true);
    });
});

describe('mergeSearchResults', () => {
    it('dedupes by id and sorts newest first', () => {
        const a = { id: 'a', submittedAt: { seconds: 100 } };
        const b = { id: 'b', submittedAt: { seconds: 300 } };
        const aDup = { id: 'a', submittedAt: { seconds: 100 } };
        expect(mergeSearchResults([[a], [b, aDup]]).map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('caps the merged result set', () => {
        const many = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, createdAt: { seconds: i } }));
        expect(mergeSearchResults([many]).length).toBe(50);
    });
});
