import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Badge, Button, DataTable } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { COMPANY_FEATURES, isFeatureOn } from '../config/features';

const nameOf = (company) => company.companyName || company.name || company.id;

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

    const columns = useMemo(() => [
        {
            key: 'company',
            header: 'Company',
            rowHeader: true,
            // `md`, like the feature columns, so the table stretches each one far
            // enough at 1440px for its one-line header ("Call Tracking").
            width: 'md',
            render: (company) => (
                <div className="flex flex-wrap items-center gap-ds-2">
                    <span className="font-semibold text-ds-content [overflow-wrap:anywhere]">{nameOf(company)}</span>
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Open ${nameOf(company)} features`}
                        onClick={() => onOpenCompany(company)}
                    >
                        Open
                    </Button>
                </div>
            ),
        },
        ...COMPANY_FEATURES.map(({ key, label }) => ({
            key,
            header: label,
            width: 'md',
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
    ], [onOpenCompany]);

    return (
        <Stack gap="lg">
            <div>
                <h2 className="text-ds-heading-md font-semibold text-ds-content">Features</h2>
                <p className="mt-1 max-w-prose text-ds-sm text-ds-content-secondary">
                    Which company has which feature. Open a company to switch one or schedule it off.
                </p>
            </div>
            <DataTable
                ariaLabel="Features of every company"
                density="compact"
                minWidth="none"
                mobilePresentation="cards"
                data={companies}
                columns={columns}
                getRowId={(company) => company.id}
                isLoading={loading}
                loadingLabel="Loading companies"
                error={failed ? { message: 'The companies could not be read.', onRetry: load } : undefined}
                empty={{ title: 'No companies yet', description: 'A company appears here once it is created.' }}
            />
        </Stack>
    );
}

export default FeaturesOverview;
