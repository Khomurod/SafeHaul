// Activity fixture figures, kept apart from `useAnalytics.js`, which returns
// them only in E2E test mode.

/*
 * Figures for the `?e2eAnalytics=mock` harness, gated on `VITE_E2E_TEST_MODE`,
 * which a production build never sets. Without them the harness reads no
 * companies, so the performance tables could be measured and pictured only
 * empty.
 *
 * Shaped as `useAnalytics` builds `stats`: a busy company and a quiet one (the
 * High/Low rule either side of 20 calls), a long company name, a long recruiter
 * name, and a recruiter with no call in the period. Every name is made up.
 */
export function mockAnalyticsStats() {
    const companyPerformance = [
        { companyId: 'e2e-co-1', companyName: 'Artificial Freight Lines', callsMade: 64 },
        { companyId: 'e2e-co-2', companyName: 'Northern Plains Refrigerated Transport Cooperative', callsMade: 27 },
        { companyId: 'e2e-co-3', companyName: 'Sample Haulage', callsMade: 6 },
    ];
    const userPerformance = [
        { userId: 'e2e-u-1', userName: 'Jordan Recruiter', companyName: 'Artificial Freight Lines', callsMade: 41, lastActive: '2026-10-07' },
        { userId: 'e2e-u-2', userName: 'Alexandra Montgomery-Okonkwo', companyName: 'Northern Plains Refrigerated Transport Cooperative', callsMade: 27, lastActive: '2026-10-06' },
        { userId: 'e2e-u-3', userName: 'Sam Example', companyName: 'Artificial Freight Lines', callsMade: 23, lastActive: '2026-10-02' },
        { userId: 'e2e-u-4', userName: 'Riley Sample', companyName: 'Sample Haulage', callsMade: 0, lastActive: null },
    ];
    const dailyTrend = [
        ['Oct 2', 9], ['Oct 3', 14], ['Oct 4', 3], ['Oct 5', 0], ['Oct 6', 22], ['Oct 7', 31], ['Oct 8', 18],
    ].map(([date, value]) => ({ date, value }));

    return {
        summary: { totalCalls: 97, totalEmails: 0, totalApplications: 0, activeRecruiters: userPerformance.length },
        companyPerformance,
        userPerformance,
        dailyTrend,
    };
}
