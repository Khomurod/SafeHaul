/**
 * What the Applications and Leads lists say when they show nothing (У5.6):
 * "nothing yet", with how the first record arrives, unless something narrows
 * the list; then "nothing matches", with a way to clear it.
 */
import { describe, expect, it, vi } from 'vitest';
import { CLEARED_NARROWING, candidateListEmpty, isListNarrowed } from './candidateListEmpty';

describe('isListNarrowed', () => {
    it('is false for a list as it opens', () => {
        expect(isListNarrowed({ scope: 'applications', searchQuery: '', filters: { ...CLEARED_NARROWING }, segment: 'all' })).toBe(false);
        expect(isListNarrowed({ scope: 'company_leads' })).toBe(false);
    });

    it.each([
        ['a search', { searchQuery: 'dana' }],
        ['a segment', { segment: 'hired' }],
        ['a freight type', { filters: { driverType: 'Reefer' } }],
        ['a state', { filters: { state: 'Texas' } }],
        ['a date', { filters: { dateFilter: '2026-10-01' } }],
        ['an Assigned to pick', { filters: { assignee: 'recruiter-1' } }],
        ['Assigned to me', { filters: { myAssignmentsOnly: true } }],
        ['a period', { filters: { period: { kind: 'added', month: '2026-10' } } }],
    ])('is true on Applications with %s', (_what, narrowing) => {
        expect(isListNarrowed({ scope: 'applications', ...narrowing })).toBe(true);
    });

    it('does not count blank space as a search', () => {
        expect(isListNarrowed({ scope: 'applications', searchQuery: '   ' })).toBe(false);
    });

    it('counts only what the list applies', () => {
        // Assigned to me and Unassigned name their assignee and offer no Assigned to filter.
        expect(isListNarrowed({ scope: 'my_leads', filters: { assignee: 'recruiter-1' } })).toBe(false);
        expect(isListNarrowed({ scope: 'unassigned_leads', filters: { assignee: 'recruiter-1' } })).toBe(false);
        expect(isListNarrowed({ scope: 'company_leads', filters: { assignee: 'recruiter-1' } })).toBe(true);
        // Assigned to me and a period are the Applications list's.
        expect(isListNarrowed({ scope: 'company_leads', filters: { myAssignmentsOnly: true, period: { kind: 'added' } } })).toBe(false);
    });
});

describe('candidateListEmpty', () => {
    it('says nothing matches, and offers to clear, while something narrows the list', () => {
        const onClear = vi.fn();
        const empty = candidateListEmpty({ scope: 'applications', narrowed: true, onClear });

        expect(empty.title).toBe('No applications match your search or filters');
        expect(empty.description).toBe('Clear them to see the whole list.');
        expect(empty.action.label).toBe('Clear search and filters');
        empty.action.onClick();
        expect(onClear).toHaveBeenCalledTimes(1);

        expect(candidateListEmpty({ scope: 'my_leads', narrowed: true, onClear }).title)
            .toBe('No leads match your search or filters');
    });

    it('says no application has come yet, and where the personal link is', () => {
        const empty = candidateListEmpty({ scope: 'applications', narrowed: false, onClear: vi.fn() });

        expect(empty.title).toBe('No applications yet');
        expect(empty.description).toMatch(/personal link \(Settings → My profile\)/);
        expect(empty.action).toBeUndefined();
    });

    it('points a new company at Add lead, and Import leads where it is offered', () => {
        expect(candidateListEmpty({ scope: 'company_leads', narrowed: false, canImportLeads: true }))
            .toMatchObject({ title: 'No leads yet', description: 'Use Add lead or Import leads above to bring in your first leads.' });
        expect(candidateListEmpty({ scope: 'company_leads', narrowed: false, canImportLeads: false }))
            .toMatchObject({ title: 'No leads yet', description: 'Use Add lead above to add your first lead.' });
    });

    it('names what each leads tab holds when it is empty', () => {
        expect(candidateListEmpty({ scope: 'my_leads', narrowed: false }).title).toBe('No leads assigned to you yet');
        expect(candidateListEmpty({ scope: 'unassigned_leads', narrowed: false }).title).toBe('No unassigned leads');
    });
});
