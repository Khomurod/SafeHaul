/**
 * The candidate list's display helpers and which columns each list shows.
 *
 * The Added Date is the day a record was created: the day the date filter finds
 * it by. An application the driver sent again later keeps its creation day
 * there, not the day of its latest submission.
 *
 * All names below are artificial.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildCandidateColumns,
    formatAddedDate,
    freightOf,
    getCandidateName,
    lastCallOf,
    nameAsWritten,
    recruiterOf,
    stateOf,
} from './candidateListColumns';

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
});

afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });

describe('formatAddedDate', () => {
    it('shows the day the record was created, the day the date filter finds it by', () => {
        // Artificial: created on 5 October, submitted again on 12 October.
        expect(formatAddedDate({ createdAt: at('2026-10-05T15:00:00Z'), submittedAt: at('2026-10-12T15:00:00Z') }))
            .toBe('Oct 5, 2026');
    });

    it('shows the submission day of a record with no creation day', () => {
        expect(formatAddedDate({ submittedAt: at('2026-10-12T15:00:00Z') })).toBe('Oct 12, 2026');
    });

    it('shows nothing for a record with neither', () => {
        expect(formatAddedDate({})).toBeNull();
    });
});

describe('a name as the driver wrote it', () => {
    it.each([
        ['James McDonald', 'James McDonald'],
        ['Ana de la Cruz', 'Ana de la Cruz'],
        ['O’Brien-Smith', 'O’Brien-Smith'],
        ['james mcdonald', 'James Mcdonald'],
        ['JAMES MCDONALD', 'James Mcdonald'],
        ['  Ann   Baker ', 'Ann Baker'],
    ])('shows %j as %j', (written, shown) => {
        expect(nameAsWritten(written)).toBe(shown);
    });

    it('joins the first and last names, and falls back only when there is neither', () => {
        expect(getCandidateName({ firstName: 'James', lastName: 'McDonald' })).toBe('James McDonald');
        expect(getCandidateName({ fullName: 'Ana de la Cruz', firstName: 'x' })).toBe('Ana de la Cruz');
        expect(getCandidateName({ firstName: 'Cher' })).toBe('Cher');
        expect(getCandidateName({})).toBe('Unknown Driver');
    });
});

describe('one fact per cell', () => {
    it('lists the freight types on one line', () => {
        expect(freightOf({ driverType: ['Dry Van', '', 'Reefer'] })).toBe('Dry Van, Reefer');
        expect(freightOf({ driverType: ' Flatbed ' })).toBe('Flatbed');
        expect(freightOf({})).toBe('');
    });

    it('shows a US state by its postal code and any other region as stored', () => {
        expect(stateOf({ state: 'Texas' })).toBe('TX');
        expect(stateOf({ state: 'il' })).toBe('IL');
        expect(stateOf({ state: 'Ontario' })).toBe('Ontario');
        expect(stateOf({})).toBe('');
    });

    it('shows the last call without the "Connected / " every answered call starts with', () => {
        expect(lastCallOf({ lastCallOutcome: 'Connected / Not Interested' })).toBe('Not Interested');
        expect(lastCallOf({ lastCallOutcome: 'Left Voicemail' })).toBe('Left Voicemail');
        expect(lastCallOf({})).toBe('');
    });

    it("names the recruiter from the team, else by the stored name, and never an unassigned record's leftover", () => {
        const team = new Map([['u1', 'Rae Recruiter']]);
        expect(recruiterOf({ assignedTo: 'u1', assignedToName: 'Old Name' }, team)).toBe('Rae Recruiter');
        expect(recruiterOf({ assignedTo: 'u2', assignedToName: 'Dee Departed' }, team)).toBe('Dee Departed');
        expect(recruiterOf({ assignedTo: 'u2' }, team)).toBe('');
        expect(recruiterOf({ assignedTo: '', assignedToName: 'Unassigned' }, team)).toBe('');
    });
});

describe('the columns each list shows', () => {
    const keys = (scope) => buildCandidateColumns({ handlePhoneClick: () => {}, scope }).map((c) => c.key);
    const column = (scope, key) => buildCandidateColumns({ handlePhoneClick: () => {}, scope }).find((c) => c.key === key);

    it('shows Applications every fact, its date headed Applied', () => {
        expect(keys('applications'))
            .toEqual(['identity', 'phone', 'status', 'freight', 'state', 'addedDate', 'lastCall', 'assignee']);
        expect(column('applications', 'addedDate').header).toBe('Applied');
        expect(column('applications', 'identity').width).toBe('lg');
    });

    it('leaves State out of All leads, which also has its selection column, and Recruiter out of Assigned to me and Unassigned', () => {
        expect(keys('company_leads')).not.toContain('state');
        expect(keys('company_leads')).toContain('assignee');
        for (const scope of ['my_leads', 'unassigned_leads']) {
            expect(keys(scope)).toEqual(['identity', 'phone', 'status', 'freight', 'state', 'addedDate', 'lastCall']);
            expect(column(scope, 'addedDate').header).toBe('Added');
        }
    });

    it("widens a lead list's Driver column for the Stale mark beside the name", () => {
        expect(column('company_leads', 'identity').width).toBe('xl');
        expect(column('my_leads', 'identity').width).toBe('xl');
        expect(column('unassigned_leads', 'identity').width).toBe('xl');
    });

    it('fits each list in the 1,134px a 1440px window leaves it, a selection column included where there is one', () => {
        // `DataTable.css`'s widths, and its selection column.
        const PX = { xs: 88, sm: 120, md: 144, lg: 176, xl: 220 };
        const SELECTION = 56;
        const width = (scope, selection) => buildCandidateColumns({ handlePhoneClick: () => {}, scope })
            .reduce((sum, c) => sum + PX[c.width], selection ? SELECTION : 0);

        expect(width('applications', false)).toBe(1112);
        expect(width('company_leads', true)).toBe(1124);
        expect(width('my_leads', false)).toBe(1036);
        expect(width('unassigned_leads', true)).toBe(1092);
    });
});
