import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { auth } from '@lib/firebase';
import { getPortalUser } from '@features/auth';
import { Button, MetricCard, Notice } from '@/design-system/components';
import {
    PageContainer,
    PageHeader,
    ResponsiveGrid,
    Section,
    Stack,
} from '@/design-system/layouts';
import { useDashboardCounts } from '@features/companies';

import { InlineLeaderboard } from './InlineLeaderboard';
import { CompanyReadinessCard } from './CompanyReadinessCard';
import { NeedsAttentionCard } from './NeedsAttentionCard';

import { Icon, FileText, Briefcase, User, CheckCircle } from '@design-system/icons';

export function CompanyAdminDashboard() {
    const { currentCompanyProfile } = useData();
    const navigate = useNavigate();


    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName;

    // The four counts only: the dashboard shows no list, so it reads no records.
    const { counts, loading: countsLoading, statsFetchError, refresh } = useDashboardCounts(companyId);
    // A count not yet read is a placeholder while loading and a dash after a failure, never 0.
    const countOf = (key) => (counts ? counts[key] : '—');

    // No invented name: until the profile's name arrives (or if it never does)
    // the greeting is just "Welcome back".
    const [userName, setUserName] = useState('');

    useEffect(() => {
        let active = true;
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (!user) return;
            try {
                const portalUserDoc = await getPortalUser(user.uid);
                if (active && portalUserDoc && portalUserDoc.name) setUserName(portalUserDoc.name);
            } catch (error) {
                console.warn('Could not read the name for the dashboard greeting:', error);
            }
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    return (
        <div id="company-admin-container" className="min-h-full bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title={userName ? `Welcome back, ${userName}` : 'Welcome back'}
                        description={`Here's what's happening at ${companyName} today.`}
                    />

                    <Section aria-label="Company activity summary">
                    {/* One polite sentence for the four cards, always present so it can fill. */}
                    <p role="status" className="sr-only">
                        {countsLoading ? 'Loading dashboard counts.' : statsFetchError ? '' : 'Dashboard counts loaded.'}
                    </p>
                    {statsFetchError && (
                        <Notice
                            announce="polite"
                            tone="warning"
                            className="mb-4"
                            actions={(
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => refresh()}
                                >
                                    Retry
                                </Button>
                            )}
                        >
                            Some dashboard numbers could not load: {statsFetchError}
                        </Notice>
                    )}
                        <ResponsiveGrid minItemWidth="210px">
                            <MetricCard
                                label="Applications"
                                value={countOf('applications')}
                                loading={countsLoading}
                                icon={<Icon icon={FileText} size="xl" />}
                                tone="info"
                                onActivate={() => navigate('/company/drivers/applications')}
                            />

                            <MetricCard
                                label="Company Leads"
                                value={countOf('companyLeads')}
                                loading={countsLoading}
                                icon={<Icon icon={Briefcase} size="xl" />}
                                tone="warning"
                                onActivate={() => navigate('/company/drivers/leads/company')}
                            />
                            <MetricCard
                                id="stat-card-my_leads"
                                label="My Leads"
                                value={countOf('myLeads')}
                                loading={countsLoading}
                                icon={<Icon icon={User} size="xl" />}
                                tone="accent"
                                onActivate={() => navigate('/company/drivers/leads/my')}
                            />
                            <MetricCard
                                id="stat-card-hired"
                                label="Hired"
                                value={countOf('hired')}
                                loading={countsLoading}
                                icon={<Icon icon={CheckCircle} size="xl" />}
                                tone="success"
                                onActivate={() => navigate('/company/drivers/applications', { state: { segment: 'hired' } })}
                            />
                        </ResponsiveGrid>
                    </Section>

                    {/* Everyone: what waits on someone, counted by the server once per visit (one calm line when nothing). */}
                    <NeedsAttentionCard key={companyId} companyId={companyId} />

                    {/* Admins only: what the company has not set up, read once (one calm line when ready). */}
                    <CompanyReadinessCard companyId={companyId} />

                    <Section aria-label="Team performance">
                        <InlineLeaderboard companyId={companyId} />
                    </Section>
                </Stack>
            </PageContainer>
        </div>
    );
}
