// Companies-list fixture rows, kept apart from the screens that show them only
// in E2E test mode.

/*
 * Fixture rows for the `?e2eCompanies=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets. Without them the
 * harness reads no companies or users, so the companies and users tables and a
 * company's applications dialog could be measured and pictured only empty.
 *
 * Every company and driver is made up; phones are 555-01xx numbers.
 */

/** The companies as the console's first page reads them from `companies`. */
export function mockCompanies() {
    return [
        { id: 'e2e-co-1', companyName: 'Artificial Freight Lines', appSlug: 'artificial-freight', planType: 'paid' },
        {
            id: 'e2e-co-2',
            companyName: 'Northern Plains Refrigerated Transport Cooperative',
            appSlug: 'northern-plains-refrigerated',
            planType: 'free',
        },
        { id: 'e2e-co-3', companyName: 'Sample Haulage', appSlug: 'sample-haulage', planType: 'free', isActive: false },
    ];
}

/**
 * The console's first page of users, memberships attached: a Super Admin by
 * membership, an admin of one company who is also a user of the long-named
 * one, and someone with no company yet.
 */
export function mockUsers() {
    return [
        { id: 'e2e-user-1', name: 'Riley Sample', email: 'riley.sample@example.test', memberships: [{ companyId: 'e2e-co-1', role: 'super_admin' }] },
        {
            id: 'e2e-user-2', name: 'Alexandra Montgomery-Okonkwo', email: 'alexandra.montgomery-okonkwo@example.test',
            memberships: [
                { companyId: 'e2e-co-1', role: 'company_admin' },
                { companyId: 'e2e-co-2', role: 'recruiter' },
            ],
        },
        { id: 'e2e-user-3', name: 'Jordan Unassigned', email: 'jordan@example.test', memberships: [] },
    ];
}

/**
 * A company's applications as `loadApplications` returns them. Only the first
 * company has any: each name, contact and date shape the dialog resolves, and
 * the longest strings it shows. The others have none.
 */
export function mockCompanyApplications(companyId) {
    if (companyId !== 'e2e-co-1') return [];
    const at = (iso) => ({ seconds: Date.parse(iso) / 1000 });
    return [
        {
            id: 'e2e-app-1', firstName: 'Ana Lucia', lastName: 'Ferreira-Montgomery',
            email: 'ana.ferreira-montgomery@example.test', phone: '(555) 010-0101',
            status: 'New Application', submittedAt: at('2026-10-14T15:00:00Z'),
        },
        {
            id: 'e2e-app-2', personalInfo: { 'first-name': 'Omar', 'last-name': 'Attempt', email: 'omar@example.test' },
            status: 'Hired', createdAt: at('2026-10-09T12:00:00Z'),
        },
        {
            id: 'e2e-app-3', firstName: 'Lena', lastName: 'Leadsen', phone: '(555) 010-0103',
            status: 'Rejected', submittedAt: at('2026-09-30T18:30:00Z'),
        },
        { id: 'e2e-app-4' },
    ];
}
