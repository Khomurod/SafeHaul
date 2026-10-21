import React, { useCallback, useEffect, useId, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Icon, ArrowLeft, Building, Crown, Edit2, FileText, Layers, MessageSquare, Shield } from '@design-system/icons';
import { Badge, Button, Card, TabList, TabPanel } from '@/design-system/components';
import { ErrorState, LoadingState, PageState } from '@design-system/patterns';
import { FeaturesView } from './FeaturesView.jsx';
import { IntegrationManager } from './integrations/IntegrationManager';

const TABS = Object.freeze([
    { id: 'features', label: 'Features', icon: Layers },
    { id: 'sms', label: 'SMS', icon: MessageSquare },
]);

/**
 * One company's screen: what it is, and a tab for each thing set for it — its
 * features and its SMS setup. Opened from the companies list or from its
 * address (`/super-admin/companies/<id>[/sms]`, after a reload or from a
 * shared link).
 *
 * The company is read first, every time: the SMS form saves under
 * `companies/<id>` and `saveIntegrationConfig` does not check that the company
 * exists, so a deleted or mistyped id gets a notice and the way back, never a
 * form. It is read again after a feature changes and after the details are
 * edited (`revision`), so the screen shows what is saved.
 */
export function CompanyView({ companyId, tab, onTabChange, onBack, onEdit, onViewApps, revision = 0 }) {
    const tabsId = useId();
    const [lookup, setLookup] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const reload = useCallback(() => setAttempt((count) => count + 1), []);

    useEffect(() => {
        if (!companyId) return undefined;
        let current = true;
        // Inside the promise chain, so an id Firestore refuses is a failed read too.
        Promise.resolve()
            .then(() => getDoc(doc(db, 'companies', companyId)))
            .then((snapshot) => {
                if (!current) return;
                setLookup(snapshot.exists()
                    ? { companyId, company: { id: companyId, ...snapshot.data() } }
                    : { companyId, missing: true });
            }, (error) => {
                console.error('Error reading the company:', error);
                if (current) setLookup({ companyId, failed: true });
            });
        return () => { current = false; };
    }, [companyId, attempt, revision]);

    const back = (
        <Button variant="secondary" onClick={onBack}>
            <Icon icon={ArrowLeft} /> All companies
        </Button>
    );
    // Only the answer for this company counts: another one's, or none yet, is still loading.
    if (lookup?.companyId !== companyId) {
        return <LoadingState title="Loading the company" />;
    }
    if (lookup.failed) {
        return (
            <ErrorState
                title="Could not load this company"
                description="Check the connection and try again."
                actions={<><Button onClick={reload}>Try again</Button>{back}</>}
            />
        );
    }
    if (lookup.missing) {
        return (
            <PageState
                tone="warning"
                title="Company not found"
                description={`No company has the ID “${companyId}”. It may have been deleted, or the link may be mistyped.`}
                actions={back}
            />
        );
    }

    const { company } = lookup;
    const companyName = getFieldValue(company.companyName) || 'Company';
    const activeTab = TABS.some((item) => item.id === tab) ? tab : TABS[0].id;
    return (
        <Card padding="none" className="flex flex-col">
            <div className="flex flex-col gap-ds-4 border-b border-ds-border-subtle p-ds-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <Icon icon={Building} size="xl" className="text-ds-content-link" />
                        <span className="truncate">{companyName}</span>
                    </h2>
                    <p className="mt-ds-1 flex flex-wrap items-center gap-ds-2 font-mono text-ds-xs text-ds-content-muted">
                        <span>/{getFieldValue(company.appSlug)}</span>
                        <span>{company.id}</span>
                    </p>
                    <div className="mt-ds-2 flex flex-wrap gap-ds-2">
                        {company.planType === 'paid'
                            ? <Badge tone="warning" icon={Crown}>Pro Plan</Badge>
                            : <Badge tone="neutral" icon={Shield}>Free Plan</Badge>}
                        {company.isActive === false
                            ? <Badge tone="danger">Inactive</Badge>
                            : <Badge tone="success">Active</Badge>}
                    </div>
                </div>
                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="secondary" size="sm" onClick={() => onEdit(company.id)}>
                        <Icon icon={Edit2} size="sm" /> Edit details
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => onViewApps({ id: company.id, name: company.companyName })}>
                        <Icon icon={FileText} size="sm" /> View applications
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <Icon icon={ArrowLeft} size="sm" /> All companies
                    </Button>
                </div>
            </div>

            <TabList
                ariaLabel={`${companyName} settings`}
                idBase={tabsId}
                tabs={TABS}
                activeTab={activeTab}
                onChange={onTabChange}
                className="px-ds-5"
            />
            <TabPanel idBase={tabsId} tabId={activeTab} className="p-ds-5">
                {activeTab === 'features'
                    ? <FeaturesView company={company} onChanged={reload} />
                    : <IntegrationManager companyId={company.id} companyName={companyName} />}
            </TabPanel>
        </Card>
    );
}
