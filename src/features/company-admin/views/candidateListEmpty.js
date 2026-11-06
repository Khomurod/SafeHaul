import { Inbox, Search } from '@design-system/icons';

/**
 * What the Applications and Leads lists say when they show no record. Empty is
 * not one state (`patterns/page-state/README.md`):
 *
 * - **Nothing narrows the list**: nothing is in it yet. It says so, and how the
 *   first record arrives: applications through the recruiter's personal link,
 *   leads through the header's Add lead and, where offered, Import leads. A
 *   recruiter's Add lead assigns the lead to them; an admin's stays unassigned
 *   (Д13), so Assigned to me tells each where theirs come from.
 * - **A search, a filter, a segment, Assigned to me or a period narrows it**:
 *   nothing matches. It says so and offers to clear them all
 *   (`CLEARED_NARROWING`).
 */

/** The filter row's fields every list applies. */
const FILTER_FIELDS = ['driverType', 'state', 'dob', 'dateFilter'];

/** What "Clear search and filters" sets, besides the empty search and the 'all' segment. */
export const CLEARED_NARROWING = Object.freeze({
    driverType: '',
    state: '',
    dob: '',
    assignee: '',
    dateFilter: '',
    myAssignmentsOnly: false,
    period: null,
});

/**
 * Whether something the person set narrows the list. A value a list neither
 * shows nor applies does not count: the Assigned to pick off Applications and
 * All leads (`showAssigneeFilter`), Assigned to me and a period off Applications.
 */
export function isListNarrowed({ scope, searchQuery = '', filters = {}, segment = 'all' }) {
    if (String(searchQuery).trim()) return true;
    if (segment && segment !== 'all') return true;
    if (FILTER_FIELDS.some((key) => Boolean(filters[key]))) return true;
    if ((scope === 'applications' || scope === 'company_leads') && filters.assignee) return true;
    return scope === 'applications' && Boolean(filters.myAssignmentsOnly || filters.period);
}

const NOTHING_YET = {
    applications: () => ({
        title: 'No applications yet',
        description: 'Share your personal link (on your Profile page) with drivers. Their applications show up here.',
    }),
    company_leads: ({ canImportLeads }) => ({
        title: 'No leads yet',
        description: canImportLeads
            ? 'Use Add lead or Import leads above to bring in your first leads.'
            : 'Use Add lead above to add your first lead.',
    }),
    my_leads: ({ isCompanyAdmin }) => ({
        title: 'No leads assigned to you yet',
        description: isCompanyAdmin
            ? 'Leads assigned to you show up here.'
            : 'Leads you add with Add lead, and leads assigned to you, show up here.',
    }),
    unassigned_leads: () => ({
        title: 'No unassigned leads',
        description: 'Leads nobody is assigned to show up here.',
    }),
};

/**
 * The list's empty state, in `DataTable`'s `empty` shape. `onClear` clears the
 * search and every filter; it is offered only while something narrows the list.
 */
export function candidateListEmpty({ scope, narrowed, canImportLeads = false, isCompanyAdmin = false, onClear }) {
    const noun = scope === 'applications' ? 'applications' : 'leads';
    if (narrowed) {
        return {
            icon: Search,
            title: `No ${noun} match your search or filters`,
            description: 'Clear them to see the whole list.',
            action: onClear ? { label: 'Clear search and filters', onClick: onClear } : undefined,
        };
    }
    const nothingYet = NOTHING_YET[scope] || NOTHING_YET.company_leads;
    return { icon: Inbox, ...nothingYet({ canImportLeads, isCompanyAdmin }) };
}
