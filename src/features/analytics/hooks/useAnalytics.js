import { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

const CHICAGO_TZ = 'America/Chicago';

/**
 * Analytics hook that reads from pre-aggregated stats_daily collection
 * This is much more efficient than collection group queries on raw activities
 */
export function useAnalytics() {
    const [loading, setLoading] = useState(true);
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

                for (const companyDoc of companiesSnap.docs) {
                    const companyId = companyDoc.id;
                    const companyName = companyDoc.data().companyName || "Unknown Company";

                    // Query stats_daily for this company within date range
                    const statsQuery = query(
                        collection(db, "companies", companyId, "stats_daily"),
                        where('__name__', '>=', startKey),
                        where('__name__', '<=', endKey)
                    );
                    const statsSnap = await getDocs(statsQuery);

                    if (!compStats[companyId]) {
                        compStats[companyId] = {
                            companyId,
                            companyName,
                            callsMade: 0,
                            actions: 0
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
                        compStats[companyId].actions += dials;

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
                                    callsMade: 0
                                };
                            }
                            userStats[userId].callsMade += (userData.dials || 0);
                        });
                    });
                }

                if (!isMounted) return;

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

            } catch (error) {
                console.error("Analytics Error:", error);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchAnalytics();

        return () => { isMounted = false; };
    }, [dateRange]);

    return {
        loading,
        stats,
        dateRange,
        setDateRange
    };
}