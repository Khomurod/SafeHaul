import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Badge, DataTable } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { COMPANY_FEATURES, isFeatureOn } from '../config/features';
import { mockFeatureCompanies } from './featuresOverviewMock';

const nameOf = (company) => company.companyName || company.name || company.id;

/**
 * The bucket a feature's one-line header needs (data-table README: about 8px
 * a capital, `sm` 80px, `md` 104px, `lg` 136px of text).
 */
function headerWidth(label) {
    if (label.length <= 9) return 'sm';
    return label.length <= 12 ? 'md' : 'lg';
}

/** "Off from Oct 30": the day a scheduled switch-off takes effect, in the viewer's clock. */
function scheduledOff(company, key) {
    const at = new Date(company.featureSchedules?.[key] || '');
    if (Number.isNaN(at.getTime())) return null;
    return `Off from ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Every company's features in one table, view only: each is on or off, with a
 * scheduled switch-off when one is set. A row opens that company's Features
 * tab (`onOpenCompany`), where they are switched. It reads every company, not
 * the companies list's loaded page.
 */
export function FeaturesOverview({ onOpenCompany }) {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        if (isE2ETestMode && getE2EQueryParam('e2eFeatures', '') === 'mock') {
            setCompanies(mockFeatureCompanies().sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
            setLoading(false);
            return;
        }
        try {
            const snap = await getDocs(collection(db, 'companies'));
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setCompanies(list.sort((a, b) => nameOf(a).localeCompare(nameOf(b))));
        } catch (error) {
            console.error('[FeaturesOverview] Could not read the companies:', error?.message);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // The widths fit the 926px the console leaves at 1440 (856px): each
    // feature column is as wide as its one-line header needs.
    const columns = useMemo(() => [
        {
            key: 'company',
            header: 'Company',
            rowHeader: true,
            width: 'lg',
            render: (company) => (
                <span className="font-semibold text-ds-content [overflow-wrap:anywhere]">{nameOf(company)}</span>
            ),
        },
        ...COMPANY_FEATURES.map(({ key, label }) => ({
            key,
            header: label,
            width: headerWidth(label),
            render: (company) => {
                const on = isFeatureOn(company, key);
                const offFrom = on ? scheduledOff(company, key) : null;
                return (
                    <div className="flex flex-col items-start gap-ds-1">
                        <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
                        {offFrom && <span className="text-ds-xs text-ds-status-warning-fg">{offFrom}</span>}
                    </div>
                );
            },
        })),
    ], []);

    return (
        <Stack gap="lg">
            {/* Level 2: the Super Admin masthead holds the page's one <h1>. */}
            <PageHeader
                level={2}
                title="Features"
                count={loading || failed ? undefined : companies.length}
                countLabel={companies.length === 1 ? 'company' : 'companies'}
                description="Which company has which feature. Open a company to switch one or schedule it off."
            />
            <DataTable
                ariaLabel="Features of every company"
                density="compact"
                minWidth="none"
                mobilePresentation="cards"
                data={companies}
                columns={columns}
                getRowId={(company) => company.id}
                // A row opens that company's Features tab, as a row opens its
                // record on every list (Enter or Space from the keyboard).
                getRowLabel={(company) => `Open ${nameOf(company)} features`}
                onRowActivate={onOpenCompany}
                isLoading={loading}
                loadingLabel="Loading companies"
                error={failed ? { message: 'The companies could not be read.', onRetry: load } : undefined}
                empty={{ title: 'No companies yet', description: 'A company appears here once it is created.' }}
            />
        </Stack>
    );
}

export default FeaturesOverview;
