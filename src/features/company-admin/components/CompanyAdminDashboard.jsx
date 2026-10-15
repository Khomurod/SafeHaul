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


import { Icon, FileText, Briefcase, User, CheckCircle } from '@design-system/icons';

export function CompanyAdminDashboard() {
    const { currentCompanyProfile } = useData();
    const navigate = useNavigate();


    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName;

    // The four counts only: the dashboard shows no list, so it reads no records.
    const { counts, statsFetchError, refresh } = useDashboardCounts(companyId);

    const [userName, setUserName] = useState('Admin User');

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (user) {
                const portalUserDoc = await getPortalUser(user.uid);
                if (portalUserDoc && portalUserDoc.name) setUserName(portalUserDoc.name);
            }
        });
        return () => unsubscribe();
    }, []);

    return (
        <div id="company-admin-container" className="min-h-full bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title={`Welcome back, ${userName}`}
                        description={`Here's what's happening at ${companyName} today.`}
                    />

                    <Section aria-label="Company activity summary">
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
                                value={counts.applications || 0}
                                icon={<Icon icon={FileText} size="xl" />}
                                tone="info"
                                onActivate={() => navigate('/company/drivers/applications')}
                            />

                            <MetricCard
                                label="Company Leads"
                                value={counts.companyLeads || 0}
                                icon={<Icon icon={Briefcase} size="xl" />}
                                tone="warning"
                                onActivate={() => navigate('/company/drivers/leads/company')}
                            />
                            <MetricCard
                                id="stat-card-my_leads"
                                label="My Leads"
                                value={counts.myLeads || 0}
                                icon={<Icon icon={User} size="xl" />}
                                tone="accent"
                                onActivate={() => navigate('/company/drivers/leads/my')}
                            />
                            <MetricCard
                                id="stat-card-hired"
                                label="Hired"
                                value={counts.hired || 0}
                                icon={<Icon icon={CheckCircle} size="xl" />}
                                tone="success"
                                onActivate={() => navigate('/company/drivers/applications', { state: { segment: 'hired' } })}
                            />
                        </ResponsiveGrid>
                    </Section>

                    <Section aria-label="Team performance">
                        <InlineLeaderboard companyId={companyId} />
                    </Section>
                </Stack>
            </PageContainer>
        </div>
    );
}
