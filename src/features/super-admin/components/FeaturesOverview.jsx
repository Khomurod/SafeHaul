import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCompanies } from '@features/companies/services/companyService';
import { Badge, DataTable } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { COMPANY_FEATURES, isFeatureOn } from '@shared/utils/companyFeatures';
import { mockFeatureCompanies } from './featuresOverviewMock';

const nameOf = (company) => company.companyName || company.name || company.id;

/** The header text each bucket leaves room for once its padding is taken (data-table README). */
const HEADER_ROOM = [['xs', 56], ['sm', 88], ['md', 112], ['lg', 144]];

/** The narrowest bucket a feature's one-line header fits, at about 7px a letter. */
function headerWidth(label) {
    const needs = label.length * 7;
    return (HEADER_ROOM.find(([, room]) => needs <= room) || HEADER_ROOM[HEADER_ROOM.length - 1])[0];
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
 * tab (`onOpenCompany`), where they are switched. It shows every company, not
 * the companies list's loaded page, from the read the console's screens share
 * (`loadCompanies`: at most two minutes old, read again after a feature is
 * switched here).
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
            const snap = await loadCompanies();
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

    // The widths fit the 926px the console leaves at 1440 (880px), so no
    // feature is hidden past the edge: each feature column is as narrow as its
    // one-line header allows, and "Off from Oct 30" wraps under its badge.
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
