import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { CompanyBulkUpload } from '@features/company-admin/components/CompanyBulkUpload';
import { ShieldAlert } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { PageState } from '@design-system/patterns';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * Company "Import Leads" page.
 *
 * Feature-owned: the permission rule, the `importLeads` feature flag, the
 * destination after a completed import, and every string on this page. All
 * layout and controls come from the design system.
 *
 * Rules this page keeps (presentation only):
 *
 *  1. It passes `isEmbedded` to `CompanyBulkUpload`, which honours it, so the
 *     import surface renders in place — not as a full-screen overlay on top of
 *     the page's own "Import Leads" header, with the page behind it still in the
 *     tab order.
 *  2. The access-denied state has an `<h1>`, so a keyboard or screen-reader user
 *     landing on it hears a named page, and its action is a design-system
 *     `Button`.
 *  3. Both states use `--ds-*` tokens, not hard-coded palette classes.
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

    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);

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
                    {/*
                     * The approved page-state pattern. `announce`
                     * is `off` deliberately: this is ordinary page content on
                     * navigation, not a state that appeared in response to
                     * something the user just did, and an assertive announcement
                     * would interrupt whatever they were reading.
                     */}
                    <div className="mx-auto w-full max-w-md">
                        <PageState
                            tone="danger"
                            icon={ShieldAlert}
                            announce="off"
                            headingLevel={1}
                            title="Access Denied"
                            description="You do not have permission to import leads. Please contact your Company Admin to request access."
                            actions={(
                                <Button
                                    variant="secondary"
                                    fullWidth
                                    onClick={() => navigate('/company/dashboard')}
                                >
                                    Return to Dashboard
                                </Button>
                            )}
                        />
                    </div>
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
