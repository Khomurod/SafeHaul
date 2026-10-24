// Companies-list fixture rows, kept apart from the screens that show them only
// in E2E test mode.

/*
 * Fixture rows for the `?e2eCompanies=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets. Without them the
 * harness reads no companies, so the companies table and a company's
 * applications dialog could be measured and pictured only empty.
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
 * One company's applications as `loadApplications` returns them: each name,
 * contact and date shape the dialog resolves, and the longest strings it shows.
 */
export function mockCompanyApplications() {
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
