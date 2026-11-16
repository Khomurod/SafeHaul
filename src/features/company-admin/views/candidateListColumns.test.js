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
    const SCOPES = ['applications', 'company_leads', 'my_leads', 'unassigned_leads'];
    const columns = (scope) => buildCandidateColumns({ handlePhoneClick: () => {}, scope });
    const column = (scope, key) => columns(scope).find((c) => c.key === key);

    it('shows every list the same columns: initials, Driver (with the number), Status, Freight · State, the date, Last call, Assignee', () => {
        for (const scope of SCOPES) {
            expect(columns(scope).map((c) => c.key))
                .toEqual(['initials', 'identity', 'status', 'freightState', 'addedDate', 'lastCall', 'assignee']);
            expect(column(scope, 'freightState').header).toBe('Freight · State');
        }
        expect(column('applications', 'addedDate').header).toBe('Applied');
        for (const scope of ['company_leads', 'my_leads', 'unassigned_leads']) {
            expect(column(scope, 'addedDate').header).toBe('Added');
        }
    });

    it('gives every list the same widths, so moving between the lead tabs never moves a column', () => {
        const widths = (scope) => columns(scope).map((c) => c.width);
        for (const scope of SCOPES) {
            expect(widths(scope)).toEqual(['auto', 'xl', 'lg', 'sm', 'md', 'sm', 'md']);
        }
    });

    it("fits a lead list with its selection column in a 1366px window's 1,030px", () => {
        // `DataTable.css`'s widths, its selection column, and the initials
        // column (`roleCards.css`: the cell padding and a 32px avatar).
        const PX = { xs: 88, sm: 120, md: 144, lg: 176, xl: 220 };
        const SELECTION = 56;
        const INITIALS = 16 + 32;
        const width = (scope, selection) => columns(scope)
            .reduce((sum, c) => sum + (c.mobileRole === 'lead' ? INITIALS : PX[c.width]), selection ? SELECTION : 0);

        expect(width('applications', false)).toBe(972);
        expect(width('my_leads', false)).toBe(972);
        expect(width('company_leads', true)).toBe(1028);
        expect(width('unassigned_leads', true)).toBe(1028);
        // An admin's Assigned to me keeps the selection column's place (`reserveSelection`).
        expect(width('my_leads', true)).toBe(1028);
    });

    it('lays a phone card out by role: initials, the Driver as its title, the status corner, inline facts, the assignee line', () => {
        const roles = Object.fromEntries(columns('applications').map((c) => [c.key, c.mobileRole]));
        expect(roles).toEqual({
            initials: 'lead',
            identity: undefined,
            status: 'status',
            freightState: 'meta',
            addedDate: 'meta',
            lastCall: 'meta',
            assignee: 'line',
        });
        expect(column('applications', 'identity').rowHeader).toBe(true);
        expect(column('applications', 'addedDate').mobileLabel).toBe('Applied');
        expect(column('company_leads', 'addedDate').mobileLabel).toBe('Added');
        expect(column('my_leads', 'lastCall').mobileLabel).toBe('Last call:');
    });
});
