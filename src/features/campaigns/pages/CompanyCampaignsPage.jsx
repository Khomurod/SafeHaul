import React from 'react';
import { CampaignsDashboard } from '../CampaignsDashboard';
import { useData } from '@/context/DataContext';

export function CompanyCampaignsPage() {
  const { currentCompanyProfile } = useData();
  const companyId = currentCompanyProfile?.id;

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ds-content-secondary">
        Please select a company.
      </div>
    );
  }

  return <CampaignsDashboard companyId={companyId} />;
}
