import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
    classifySearchTerm,
    buildSearchPlans,
    recordMatchesSearch,
    applyClientSideFilters,
    mergeSearchResults,
    leadStatusMatchesSegment,
    stateFilterValues,
    dateFilterRange,
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

    it('the State filter matches a picked state however the record spells it, as the query does', () => {
        // Artificial records: the picker's name, a postal code, a hand-typed name.
        const spelled = [
            { id: 'picked', state: 'Texas' },
            { id: 'code', state: 'TX' },
            { id: 'typed', state: 'texas' },
            { id: 'typed-code', state: 'Tx' },
            { id: 'other', state: 'Illinois' },
            { id: 'none' },
        ];

        expect(applyClientSideFilters(spelled, {
            activeTab: 'applications', pipelineSegment: 'all', filters: { state: 'Texas' },
        }).map((r) => r.id)).toEqual(['picked', 'code', 'typed', 'typed-code']);
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

describe('stateFilterValues', () => {
    it('lists the name as written, in capitals and in lower case, and the postal code in every casing', () => {
        const texas = ['Texas', 'TEXAS', 'texas', 'TX', 'tx', 'Tx', 'tX'];

        expect(stateFilterValues('Texas')).toEqual(texas);
        expect(stateFilterValues('tx')).toEqual(texas);
        expect(stateFilterValues(' TEXAS ')).toEqual(texas);
        expect(stateFilterValues('District of Columbia')).toEqual([
            'District of Columbia', 'DISTRICT OF COLUMBIA', 'district of columbia', 'DC', 'dc', 'Dc', 'dC',
        ]);
    });

    it('does the same for a Canadian province or a Mexican state', () => {
        expect(stateFilterValues('Ontario')).toEqual(['Ontario', 'ONTARIO', 'ontario', 'ON', 'on', 'On', 'oN']);
        expect(stateFilterValues('jalisco')).toEqual(['Jalisco', 'JALISCO', 'jalisco', 'JA', 'ja', 'Ja', 'jA']);
    });

    it('leaves out a code two regions share, which would find the other one too', () => {
        expect(stateFilterValues('Nuevo León')).toEqual(['Nuevo León', 'NUEVO LEÓN', 'nuevo león']);
        expect(stateFilterValues('Newfoundland and Labrador')).toEqual([
            'Newfoundland and Labrador', 'NEWFOUNDLAND AND LABRADOR', 'newfoundland and labrador',
        ]);
    });

    it('keeps a value that names no region as it is, and gives nothing for an empty one', () => {
        expect(stateFilterValues('Atlantis')).toEqual(['Atlantis']);
        expect(stateFilterValues('   ')).toEqual([]);
        expect(stateFilterValues(undefined)).toEqual([]);
    });
});

describe('the date filter, on a clock in Chicago', () => {
    let zone;

    beforeEach(() => {
        zone = process.env.TZ;
        process.env.TZ = 'America/Chicago';
    });

    afterEach(() => {
        if (zone === undefined) delete process.env.TZ;
        else process.env.TZ = zone;
    });

    it('covers the picked day from local midnight to the next', () => {
        expect(dateFilterRange('2026-10-12')).toEqual({
            start: new Date('2026-10-12T05:00:00Z'),
            end: new Date('2026-10-13T05:00:00Z'),
        });
    });

    it('is 25 hours long on the day the clocks go back', () => {
        expect(dateFilterRange('2026-11-01')).toEqual({
            start: new Date('2026-11-01T05:00:00Z'),
            end: new Date('2026-11-02T06:00:00Z'),
        });
    });

    it('is no range for anything but a real day', () => {
        for (const value of ['', '2026-02-30', '10/12/2026', undefined]) {
            expect(dateFilterRange(value)).toBeNull();
        }
    });

    it('matches records by the day they were created, as the query does', () => {
        // Artificial records. The last was submitted on the day but created before
        // it; the server, which asks for createdAt, does not return it either.
        const records = [
            { id: 'evening-before', createdAt: { seconds: Date.parse('2026-10-12T04:59:00Z') / 1000 } },
            { id: 'midnight', createdAt: { seconds: Date.parse('2026-10-12T05:00:00Z') / 1000 } },
            { id: 'late', createdAt: { seconds: Date.parse('2026-10-13T04:59:00Z') / 1000 } },
            { id: 'next-day', createdAt: { seconds: Date.parse('2026-10-13T05:00:00Z') / 1000 } },
            {
                id: 'resubmitted',
                createdAt: { seconds: Date.parse('2026-10-05T15:00:00Z') / 1000 },
                submittedAt: { seconds: Date.parse('2026-10-12T15:00:00Z') / 1000 },
            },
        ];

        expect(applyClientSideFilters(records, {
            activeTab: 'applications', pipelineSegment: 'all', filters: { dateFilter: '2026-10-12' },
        }).map((r) => r.id)).toEqual(['midnight', 'late']);
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
