import React, { useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { CompanyBulkUpload } from '@features/company-admin/components/CompanyBulkUpload';
import { BulkUploadSteps } from '@shared/components/admin/BulkUploadSteps';
import { ShieldAlert } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { PageState } from '@design-system/patterns';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';

import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { COMPANY_NAV_GROUPS } from '@app/routes/companyRouteManifest';
import { leadsBackLink, leadsListPath } from './leadsListPath';
import { isFeatureOn } from '@shared/utils/companyFeatures';

/**
 * Company "Import Leads" page, reached from the Leads page's header
 * (`LeadsHeaderActions`). A page of its own, not a dialog: the wizard is long,
 * and a stray click outside a dialog would throw away the preview.
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
 *  4. The header says where the page sits ("Driver Applications & Leads") and
 *     links back to the person's leads list ("← Leads"), which is the way out
 *     of the import: the card has no close control of its own. The import's
 *     steps sit at the header's right, on the title's row, as the import
 *     reports them (`onStepChange`); the card spans the page.
 *
 * Frozen: the "Import Leads" heading and its description, the access-denied
 * copy, the "Return to Dashboard" label and destination, and the feature-flag
 * rule (locked only when explicitly `false`, and checked before the permission
 * rule). Every other way out — the back link, its Close once done, the
 * import finishing, dismissing the feature-locked notice — returns to the
 * person's leads list (`leadsListPath`).
 */
const EYEBROW = COMPANY_NAV_GROUPS.applications.label;

/*
 * The page width from which the steps fit on the title's row, as C2 has it:
 * the title (about 180px), a 16px gap and the steps' 344px. Narrower (a
 * tablet beside the menu, a phone), C2 draws them as a full-width row under
 * the description, their connectors sharing the width — not as header actions
 * wrapped to the right — so they leave the header there.
 */
const STEPS_BESIDE_TITLE_MIN = 560;

/**
 * Whether an element is at least `min` px wide, following resizes; true until
 * measured. Returns a callback ref, so the element is measured whenever it
 * mounts (the header renders only once access is settled), before it paints.
 */
function useWidthAtLeast(min) {
    const [node, setNode] = useState(null);
    const [atLeast, setAtLeast] = useState(true);
    useLayoutEffect(() => {
        if (!node) return undefined;
        const update = () => {
            const { width } = node.getBoundingClientRect();
            if (width > 0) setAtLeast(width >= min);
        };
        update();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [node, min]);
    return [setNode, atLeast];
}

export const ImportLeadsPage = () => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const navigate = useNavigate();
    const companyId = currentCompanyProfile?.id;
    const [step, setStep] = useState('upload');
    const [headerRef, stepsBesideTitle] = useWidthAtLeast(STEPS_BESIDE_TITLE_MIN);

    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    const returnToLeads = () => navigate(leadsListPath(isCompanyAdmin));

    if (!isFeatureOn(currentCompanyProfile, 'importLeads')) {
        return <FeatureLockedModal featureName="Import Leads" onClose={returnToLeads} />;
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
                    <div ref={headerRef} className="min-w-0">
                        <PageHeader
                            eyebrow={EYEBROW}
                            back={leadsBackLink(isCompanyAdmin, navigate)}
                            title="Import Leads"
                            description="Bulk upload leads from a CSV file."
                            actions={stepsBesideTitle ? <BulkUploadSteps step={step} /> : undefined}
                        />
                        {/* Stretched across the row: its connectors share the width. */}
                        {!stepsBesideTitle && <BulkUploadSteps step={step} className="mt-ds-4 w-full" />}
                    </div>

                    <CompanyBulkUpload
                        companyId={companyId}
                        onClose={returnToLeads}
                        onUploadComplete={returnToLeads}
                        onStepChange={setStep}
                        isEmbedded={true}
                    />
                </Stack>
            </PageContainer>
        </div>
    );
};

export default ImportLeadsPage;
