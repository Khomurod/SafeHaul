import { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { collection, query, where, getDocs, Timestamp, collectionGroup } from 'firebase/firestore';

const CHICAGO_TZ = 'America/Chicago';

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

    // --- Timezone Helper ---
    // Returns a Date object representing "Now" in Chicago
    const getChicagoNow = () => {
        const now = new Date();
        const chicagoString = now.toLocaleString('en-US', { timeZone: CHICAGO_TZ });
        return new Date(chicagoString);
    };

    // Formats a Firestore Timestamp or Date object into a "MMM D" string (e.g. "Dec 8") in Chicago Time
    const formatToChicagoKey = (dateInput) => {
        if (!dateInput) return null;
        const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);

        return new Intl.DateTimeFormat('en-US', {
            timeZone: CHICAGO_TZ,
            month: 'short',
            day: 'numeric'
        }).format(date);
    };

    useEffect(() => {
        let isMounted = true;

        const fetchAnalytics = async () => {
            setLoading(true);
            try {
                // 1. Determine Date Boundaries (Chicago Time)
                // We calculate "Today" in Chicago
                const chicagoToday = getChicagoNow();

                // Set End Date to End of Day Chicago
                const endDate = new Date(chicagoToday);
                endDate.setHours(23, 59, 59, 999);

                // Set Start Date based on range, relative to Chicago Today
                const startDate = new Date(chicagoToday);
                if (dateRange === '7d') startDate.setDate(startDate.getDate() - 6); // 7 days inclusive
                if (dateRange === '30d') startDate.setDate(startDate.getDate() - 29);
                if (dateRange === '90d') startDate.setDate(startDate.getDate() - 89);
                startDate.setHours(0, 0, 0, 0);

                // 2. Convert these "Concept Dates" back to UTC Timestamps for Firestore Query
                // Since we created startDate using "new Date(string)", it has the browser's offset applied to the face value of Chicago time.
                // To query Firestore accurately, we need the UTC timestamp corresponding to "00:00 Chicago".
                // However, an easier and safer way for Analytics (read-heavy) is to query a slightly WIDER buffer in UTC
                // and then filter strictly in memory using the locale formatter.

                // Buffer: Subtract 1 day (UTC) from start to be safe
                const bufferStart = new Date(startDate.getTime() - 86400000); 
                const startTs = Timestamp.fromDate(bufferStart);

                // 3. Fetch Data
                // Fetch Companies for mapping
                const companiesSnap = await getDocs(collection(db, "companies"));
                const companyMap = {};
                companiesSnap.forEach(doc => {
                    const d = doc.data();
                    companyMap[doc.id] = d.companyName || "Unknown Company";
                });

                // Fetch Activities (Calls, etc)
                // We filter >= bufferStart to ensure we get everything
                const activitiesRef = collectionGroup(db, 'activities');
                const q = query(activitiesRef, where('timestamp', '>=', startTs));
                const snapshot = await getDocs(q);

                if (!isMounted) return;

                // 4. Aggregation Containers
                let totalCalls = 0;
                let totalEmails = 0;
                const compStats = {};
                const userStats = {};
                const dailyCounts = {};

                // Initialize Daily Buckets (X-Axis) based on Chicago Days
                // We loop from startDate to endDate
                let loopDate = new Date(startDate);
                while (loopDate <= endDate) {
                    const key = new Intl.DateTimeFormat('en-US', {
                        month: 'short', day: 'numeric'
                    }).format(loopDate); // Since loopDate was constructed from Chicago String, local format is correct key

                    dailyCounts[key] = 0;
                    loopDate.setDate(loopDate.getDate() + 1);
                }

                // 5. Process Records
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (!data.timestamp) return;

                    // Convert Document Timestamp to Chicago Date Key
                    const docKey = formatToChicagoKey(data.timestamp);

                    // FILTER: Only count if it falls in our initialized buckets
                    // This creates the strict "Chicago Time Window" enforcement
                    if (!dailyCounts.hasOwnProperty(docKey)) return;

                    // --- Processing Logic ---
                    const compId = data.companyId || 'unknown';
                    const userId = data.performedBy || 'system';

                    // Init Stats Objects
                    if (!compStats[compId]) {
                        compStats[compId] = { 
                            companyId: compId, 
                            companyName: companyMap[compId] || (compId === 'unknown' ? "System/Unknown" : "Unknown Company"), 
                            callsMade: 0,
                            actions: 0 
                        };
                    }

                    if (!userStats[userId]) {
                        userStats[userId] = {
                            userId: userId,
                            userName: data.performedByName || 'Unknown User',
                            companyName: companyMap[compId] || "Unknown",
                            callsMade: 0,
                            lastActive: data.timestamp
                        };
                    } else {
                        if (data.timestamp > userStats[userId].lastActive) {
                             userStats[userId].lastActive = data.timestamp;
                             if (data.performedByName) userStats[userId].userName = data.performedByName;
                        }
                    }

                    // Increment Counts
                    if (data.type === 'call') {
                        totalCalls++;
                        compStats[compId].callsMade++;
                        userStats[userId].callsMade++;
                    }

                    compStats[compId].actions++;
                    dailyCounts[docKey]++;
                });

                // 6. Format Output
                const companyPerformance = Object.values(compStats)
                    .filter(c => c.companyId !== 'unknown')
                    .sort((a, b) => b.callsMade - a.callsMade);

                const userPerformance = Object.values(userStats)
                    .filter(u => u.userId !== 'system')
                    .sort((a, b) => b.callsMade - a.callsMade);

                const trendData = Object.entries(dailyCounts).map(([date, value]) => ({
                    date,
                    value
                }));

                setStats({
                    summary: {
                        totalCalls,
                        totalEmails, 
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