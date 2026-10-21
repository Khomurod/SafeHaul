import { useCallback, useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

const CHICAGO_TZ = 'America/Chicago';

/**
 * Analytics hook that reads from pre-aggregated stats_daily collection
 * This is much more efficient than collection group queries on raw activities
 *
 * It reports only what `stats_daily` holds, which is logged calls: each
 * company's calls, each recruiter's calls and the last day in the period they
 * logged one (`lastActive`, a Chicago `YYYY-MM-DD`, the day's document id). A
 * read that fails sets `error` rather than leaving zeros to be shown;
 * `reload()` reads the same period again.
 */
export function useAnalytics() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Bumped by `reload()`, so the same period can be read again.
    const [attempt, setAttempt] = useState(0);
    const [stats, setStats] = useState({
        summary: {
            totalCalls: 0,
            totalEmails: 0,
            totalApplications: 0,
            activeRecruiters: 0
        },
        companyPerformance: [],
        userPerformance: [],
        dailyTrend: []
    });
    const [dateRange, setDateRange] = useState('7d');

    // Format date to Chicago timezone YYYY-MM-DD
    const toChicagoDateKey = (date) => {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: CHICAGO_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(date);
    };

    // Format date to display format (MMM D)
    const toDisplayDate = (dateKey) => {
        const date = new Date(dateKey + 'T12:00:00Z');
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric'
        }).format(date);
    };

    useEffect(() => {
        let isMounted = true;

        const fetchAnalytics = async () => {
            setLoading(true);
            setError(null);
            try {
                // 1. Calculate date range in Chicago timezone
                const now = new Date();
                const endKey = toChicagoDateKey(now);

                const startDate = new Date(now);
                if (dateRange === '7d') startDate.setDate(startDate.getDate() - 6);
                if (dateRange === '30d') startDate.setDate(startDate.getDate() - 29);
                if (dateRange === '90d') startDate.setDate(startDate.getDate() - 89);
                const startKey = toChicagoDateKey(startDate);

                // 2. Fetch all companies
                const companiesSnap = await getDocs(collection(db, "companies"));

                if (!isMounted) return;

                // 3. Aggregate stats from each company's stats_daily
                let totalCalls = 0;
                const compStats = {};
                const userStats = {};
                const dailyCounts = {};

                // Initialize daily buckets
                let loopDate = new Date(startDate);
                const endDate = new Date(now);
                while (loopDate <= endDate) {
                    const key = toDisplayDate(toChicagoDateKey(loopDate));
                    dailyCounts[key] = 0;
                    loopDate.setDate(loopDate.getDate() + 1);
                }

                // Every company's stats_daily within the date range, read side
                // by side; they are added up below in the companies' order.
                const statsSnaps = await Promise.all(companiesSnap.docs.map((companyDoc) => getDocs(query(
                    collection(db, "companies", companyDoc.id, "stats_daily"),
                    where('__name__', '>=', startKey),
                    where('__name__', '<=', endKey)
                ))));

                if (!isMounted) return;

                companiesSnap.docs.forEach((companyDoc, index) => {
                    const companyId = companyDoc.id;
                    const companyName = companyDoc.data().companyName || "Unknown Company";
                    const statsSnap = statsSnaps[index];

                    if (!compStats[companyId]) {
                        compStats[companyId] = {
                            companyId,
                            companyName,
                            callsMade: 0
                        };
                    }

                    statsSnap.forEach(doc => {
                        const data = doc.data();
                        const dateKey = doc.id;
                        const displayKey = toDisplayDate(dateKey);
                        const dials = data.totalDials || 0;

                        // Update totals
                        totalCalls += dials;
                        compStats[companyId].callsMade += dials;

                        // Update daily trend
                        if (dailyCounts.hasOwnProperty(displayKey)) {
                            dailyCounts[displayKey] += dials;
                        }

                        // Process per-user stats
                        const byUser = data.byUser || {};
                        Object.entries(byUser).forEach(([userId, userData]) => {
                            if (!userStats[userId]) {
                                userStats[userId] = {
                                    userId,
                                    userName: userData.name || 'Unknown User',
                                    companyName,
                                    callsMade: 0,
                                    lastActive: null
                                };
                            }
                            userStats[userId].callsMade += (userData.dials || 0);
                            // The latest day with a logged call. Date keys sort
                            // as text, and the days arrive in no set order.
                            const lastActive = userStats[userId].lastActive;
                            if ((userData.dials || 0) > 0 && (lastActive === null || dateKey > lastActive)) {
                                userStats[userId].lastActive = dateKey;
                            }
                        });
                    });
                });

                // 4. Format output
                const companyPerformance = Object.values(compStats)
                    .filter(c => c.callsMade > 0)
                    .sort((a, b) => b.callsMade - a.callsMade);

                const userPerformance = Object.values(userStats)
                    .filter(u => u.userId !== 'system' && u.userId !== 'unknown')
                    .sort((a, b) => b.callsMade - a.callsMade);

                const trendData = Object.entries(dailyCounts).map(([date, value]) => ({
                    date,
                    value
                }));

                setStats({
                    summary: {
                        totalCalls,
                        totalEmails: 0,
                        totalApplications: 0,
                        activeRecruiters: userPerformance.length
                    },
                    companyPerformance,
                    userPerformance,
                    dailyTrend: trendData
                });

            } catch (readError) {
                console.error("Analytics Error:", readError);
                if (isMounted) setError(readError);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchAnalytics();

        return () => { isMounted = false; };
    }, [dateRange, attempt]);

    const reload = useCallback(() => setAttempt((count) => count + 1), []);

    return {
        loading,
        error,
        stats,
        dateRange,
        setDateRange,
        reload
    };
}