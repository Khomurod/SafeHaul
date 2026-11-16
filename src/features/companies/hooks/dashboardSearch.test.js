import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
    classifySearchTerm,
    buildSearchPlans,
    recordMatchesSearch,
    applyClientSideFilters,
    mergeSearchResults,
    leadStatusMatchesSegment,
    leadStatusesForSegment,
    listAssignees,
    LEAD_TABS,
    isLeadsTab,
    stateFilterValues,
    stateValuesForSegment,
    addedWindow,
    dateFilterRange,
    sortByAddedDate,
    searchableTerm,
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

describe('searchableTerm', () => {
    it('sends no search for an empty box or a one-character name', () => {
        expect(searchableTerm('')).toBe('');
        expect(searchableTerm('a')).toBe('');
        expect(searchableTerm(' a ')).toBe('');
        expect(searchableTerm('1')).toBe('');
    });

    it('keeps a name of two characters or more, in any alphabet', () => {
        expect(searchableTerm('ab')).toBe('ab');
        expect(searchableTerm('Ли')).toBe('Ли');
    });

    it('never cuts an email, phone, confirmation number or application id', () => {
        expect(searchableTerm('a@x')).toBe('a@x');
        expect(searchableTerm('(312) 555-0188')).toBe('(312) 555-0188');
        expect(searchableTerm('saf-2026-mar1a')).toBe('saf-2026-mar1a');
        expect(searchableTerm('3a7f2b9c8d1e4f5a6b7c')).toBe('3a7f2b9c8d1e4f5a6b7c');
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

    it("lead New and Declined hold what the dossier calls New and Declined", () => {
        expect(leadStatusesForSegment('new')).toEqual(['New', 'New Application', 'New Lead']);
        expect(leadStatusesForSegment('declined')).toEqual(['Declined', 'Rejected']);
        expect(leadStatusMatchesSegment('New Lead', 'new')).toBe(true);
        expect(leadStatusMatchesSegment('Rejected', 'declined')).toBe(true);
        expect(leadStatusMatchesSegment('Contact Attempt 1', 'new')).toBe(false);
        expect(leadStatusesForSegment('all')).toBeNull();
    });

    describe('on the leads tabs', () => {
        // Artificial leads.
        const leads = [
            { id: 'mine', status: 'New Lead', assignedTo: 'u1' },
            { id: 'theirs', status: 'New', assignedTo: 'u2' },
            { id: 'free', status: 'Declined', assignedTo: '' },
            { id: 'old-import', status: 'Rejected', assignedTo: null },
        ];
        const ids = (activeTab, extra = {}) => applyClientSideFilters(leads, {
            activeTab, pipelineSegment: 'all', currentUid: 'u1', ...extra,
        }).map((r) => r.id);

        it('lists everyone on All, Assigned to me the reader and Unassigned nobody, as the queries do', () => {
            expect(ids('company_leads')).toEqual(['mine', 'theirs', 'free', 'old-import']);
            expect(ids('my_leads')).toEqual(['mine']);
            // Search finds an older lead stored with `null`, as the Unassigned filter's mirror always has.
            expect(ids('unassigned_leads')).toEqual(['free', 'old-import']);
        });

        it('leaves out an Assigned to pick or Only mine on the tabs that name their assignee', () => {
            const carried = { filters: { assignee: 'u2', myAssignmentsOnly: true } };
            expect(ids('my_leads', carried)).toEqual(['mine']);
            expect(ids('unassigned_leads', carried)).toEqual(['free', 'old-import']);
            expect(ids('company_leads', carried)).toEqual(['theirs']);
        });

        it('narrows each tab by the new segments', () => {
            expect(ids('unassigned_leads', { pipelineSegment: 'declined' })).toEqual(['free', 'old-import']);
            expect(ids('company_leads', { pipelineSegment: 'new' })).toEqual(['mine', 'theirs']);
        });
    });
});

describe('listAssignees', () => {
    it('names the tab its leads lists are, and no other', () => {
        expect(LEAD_TABS).toEqual(['company_leads', 'my_leads', 'unassigned_leads']);
        expect(LEAD_TABS.every(isLeadsTab)).toBe(true);
        expect(isLeadsTab('applications')).toBe(false);
    });

    it('gives a tab that names its assignee only that one', () => {
        const filters = { assignee: 'u2', myAssignmentsOnly: true };
        expect(listAssignees({ activeTab: 'my_leads', filters, currentUid: 'u1' })).toEqual(['u1']);
        expect(listAssignees({ activeTab: 'unassigned_leads', filters, currentUid: 'u1' })).toEqual(['__unassigned__']);
    });

    it('gives the other lists the Assigned to pick, and Applications Only mine too, once each', () => {
        expect(listAssignees({ activeTab: 'company_leads', filters: { assignee: 'u2', myAssignmentsOnly: true }, currentUid: 'u1' }))
            .toEqual(['u2']);
        expect(listAssignees({ activeTab: 'applications', filters: { assignee: 'u2', myAssignmentsOnly: true }, currentUid: 'u1' }))
            .toEqual(['u1', 'u2']);
        expect(listAssignees({ activeTab: 'applications', filters: { assignee: 'u1', myAssignmentsOnly: true }, currentUid: 'u1' }))
            .toEqual(['u1']);
        expect(listAssignees({ activeTab: 'applications', filters: {}, currentUid: 'u1' })).toEqual([]);
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

describe('the State spellings beside a segment', () => {
    it('keeps the name and the postal code first when it must keep fewer', () => {
        expect(stateFilterValues('Texas', 2)).toEqual(['Texas', 'TX']);
        expect(stateFilterValues('Texas', 3)).toEqual(['Texas', 'TX', 'TEXAS']);
        expect(stateFilterValues('Nuevo León', 2)).toEqual(['Nuevo León', 'NUEVO LEÓN']);
    });

    it('keeps all seven beside every segment but In process, where twelve statuses leave room for two', () => {
        const texas = stateFilterValues('Texas');
        for (const pipelineSegment of ['all', 'new', 'hired', 'terminated', 'declined']) {
            expect(stateValuesForSegment('Texas', { activeTab: 'applications', pipelineSegment })).toEqual(texas);
        }
        for (const activeTab of ['company_leads', 'my_leads', 'unassigned_leads']) {
            for (const pipelineSegment of ['all', 'new', 'attempting', 'in_process', 'interested', 'declined']) {
                expect(stateValuesForSegment('Texas', { activeTab, pipelineSegment })).toEqual(texas);
            }
        }
        expect(stateValuesForSegment('Texas', { activeTab: 'applications', pipelineSegment: 'in_process' })).toEqual(['Texas', 'TX']);
    });

    it('mirrors the In process query on the client: its stages, and the two State spellings', () => {
        const records = [
            { id: 'attempt', status: 'Contact Attempt 2', state: 'Texas' },
            { id: 'legacy', status: 'Background Check', state: 'TX' },
            { id: 'lower', status: 'In Process', state: 'texas' },
            { id: 'new', status: 'New Application', state: 'Texas' },
            { id: 'hired', status: 'Hired', state: 'Texas' },
            { id: 'closed', status: 'Stale', state: 'Texas' },
        ];
        const ids = (filters) => applyClientSideFilters(records, { activeTab: 'applications', pipelineSegment: 'in_process', filters })
            .map((record) => record.id);

        expect(ids({})).toEqual(['attempt', 'legacy', 'lower']);
        expect(ids({ state: 'Texas' })).toEqual(['attempt', 'legacy']);
    });
});

describe('a month the list was opened on, mirrored on the client', () => {
    const ts = (iso) => ({ toDate: () => new Date(iso) });
    // Artificial records; dates in UTC, months on the test's own clock.
    const local = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
    const records = [
        { id: 'added-november', status: 'New Application', createdAt: ts(local(2026, 11, 3)) },
        { id: 'added-october', status: 'Hired', createdAt: ts(local(2026, 10, 3)), hiredAt: ts(local(2026, 11, 9)) },
        { id: 'hired-before-recording', status: 'Hired', createdAt: ts(local(2026, 9, 3)) },
        { id: 'hired-then-left', status: 'Terminated', hiredAt: ts(local(2026, 11, 20)) },
        { id: 'hired-early-november', status: 'Hired', createdAt: ts(local(2026, 11, 2)), hiredAt: ts(local(2026, 11, 2)) },
    ];
    const ids = (pipelineSegment, filters) => applyClientSideFilters(records, { activeTab: 'applications', pipelineSegment, filters })
        .map((record) => record.id);

    it('keeps the applications added in the month', () => {
        expect(ids('all', { period: { field: 'createdAt', month: '2026-11' } })).toEqual(['added-november', 'hired-early-november']);
    });

    it('keeps the month\'s hires since recording began, whatever their status now, dated or not', () => {
        expect(ids('all', { period: { field: 'hiredAt', month: '2026-11' } })).toEqual(['added-october', 'hired-then-left']);
        expect(ids('hired', { period: { field: 'hiredAt', month: '2026-11' } })).toEqual(['added-october']);
    });

    it('shares the days of a picked day and the month, or none', () => {
        const period = { field: 'createdAt', month: '2026-11' };
        const day = (dateFilter) => addedWindow({ period, dateFilter });

        expect(day('2026-11-03')).toEqual(dateFilterRange('2026-11-03'));
        expect(day('2026-10-03').start >= day('2026-10-03').end).toBe(true);
        expect(ids('all', { period, dateFilter: '2026-10-03' })).toEqual([]);
        expect(addedWindow({ period: { field: 'hiredAt', month: '2026-11' } })).toBeNull();
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

describe('sortByAddedDate', () => {
    // Artificial records: created on days 1-3, one only submitted (day 2.5),
    // and one with no date at all.
    const day = (n) => ({ seconds: n * 86400 });
    const records = [
        { id: 'second', createdAt: day(2) },
        { id: 'undated' },
        { id: 'first', createdAt: day(1), submittedAt: day(9) },
        { id: 'submitted-only', submittedAt: day(2.5) },
        { id: 'third', createdAt: day(3) },
    ];

    it('puts the newest Added Date first, the creation day before a later submission', () => {
        expect(sortByAddedDate(records).map((r) => r.id))
            .toEqual(['third', 'submitted-only', 'second', 'first', 'undated']);
    });

    it('puts the earliest first for the Earliest first arrow, with the undated record still last', () => {
        expect(sortByAddedDate(records, 'asc').map((r) => r.id))
            .toEqual(['first', 'second', 'submitted-only', 'third', 'undated']);
    });

    it('leaves its input as it was', () => {
        const before = records.map((r) => r.id);
        sortByAddedDate(records, 'asc');
        expect(records.map((r) => r.id)).toEqual(before);
    });
});

describe('mergeSearchResults', () => {
    it('sorts by the day a record was created, before a later submission', () => {
        const created = { id: 'created-late', createdAt: { seconds: 500 }, submittedAt: { seconds: 500 } };
        const resubmitted = { id: 'resubmitted', createdAt: { seconds: 100 }, submittedAt: { seconds: 900 } };
        expect(mergeSearchResults([[resubmitted], [created]]).map((r) => r.id)).toEqual(['created-late', 'resubmitted']);
    });

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
