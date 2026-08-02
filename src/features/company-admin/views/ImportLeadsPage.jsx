import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { CompanyBulkUpload } from '@features/company-admin/components/CompanyBulkUpload';
import { ShieldAlert } from 'lucide-react';
import { Button, Card, StatusMedallion } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';

/**
 * Company "Import Leads" page.
 *
 * Feature-owned: the permission rule, the `importLeads` feature flag, the
 * destination after a completed import, and every string on this page. All
 * layout and controls come from the design system.
 *
 * Migrated 2026-07-27. Defects fixed, presentation only:
 *
 *  1. This page has always passed `isEmbedded` to `CompanyBulkUpload`, but the
 *     prop was never consumed, so a full-screen modal overlay rendered on top of
 *     the page's own "Import Leads" header — the header was unreachable and the
 *     page behind the overlay was still in the tab order. The prop is honoured
 *     now, and the import surface renders in place.
 *  2. The access-denied state had no `<h1>` (only an `<h2>`), so a keyboard or
 *     screen-reader user landing on it heard an unnamed page, and its action was
 *     a raw `<button>`.
 *  3. Both states used hard-coded palette classes instead of `--ds-*` tokens.
 *
 * Frozen: the "Import Leads" heading and its description, the access-denied
 * copy, the "Return to Dashboard" label, the feature-flag rule (locked only when
 * explicitly `false`, and checked before the permission rule), and both
 * navigation destinations.
 */
export const ImportLeadsPage = () => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const handleUploadComplete = () => {
        navigate('/company/drivers/leads/company');
    };

    if (currentCompanyProfile?.features?.importLeads === false) {
        return <FeatureLockedModal featureName="Import Leads" onClose={() => navigate('/company/dashboard')} />;
    }

    if (!isCompanyAdmin) {
        return (
            <div className="min-h-full bg-ds-canvas">
                <PageContainer width="standard">
                    <Card padding="lg" className="mx-auto max-w-md text-center">
                        <StatusMedallion tone="danger" className="mx-auto mb-ds-4">
                            <ShieldAlert size={32} />
                        </StatusMedallion>
                        <h1 className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">
                            Access Denied
                        </h1>
                        <p className="mb-ds-6 text-ds-content-secondary">
                            You do not have permission to import leads. Please contact your Company Admin to request access.
                        </p>
                        <Button
                            variant="secondary"
                            fullWidth
                            onClick={() => navigate('/company/dashboard')}
                        >
                            Return to Dashboard
                        </Button>
                    </Card>
                </PageContainer>
            </div>
        );
    }

    return (
        <div className="min-h-full bg-ds-canvas">
            <PageContainer width="standard">
                <Stack gap="lg">
                    <PageHeader
                        title="Import Leads"
                        description="Bulk upload leads from a CSV file."
                    />

                    <div className="mx-auto w-full max-w-3xl">
                        <CompanyBulkUpload
                            companyId={companyId}
                            onClose={() => navigate('/company/dashboard')}
                            onUploadComplete={handleUploadComplete}
                            isEmbedded={true}
                        />
                    </div>
                </Stack>
            </PageContainer>
        </div>
    );
};

export default ImportLeadsPage;
