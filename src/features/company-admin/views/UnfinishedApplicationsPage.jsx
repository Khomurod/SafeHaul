import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { RefreshCw } from 'lucide-react';

import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useData } from '@/context/DataContext';
import { Badge, Button, Card, DataTable, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';

/**
 * Applications somebody started and did not finish.
 *
 * ## Why this screen exists
 *
 * Answers are now saved from the applicant's first Next rather than only at
 * submission, which stops a driver losing their work — but on its own that only
 * helps an applicant who happens to come back. This is the other half: a carrier
 * watching people drop off at the licence page finally has somebody to call.
 *
 * ## Why it is not the applications list
 *
 * These are deliberately kept out of the ATS funnel. An unfinished application is
 * not a submitted one: nothing has been signed, no consent has been given, no
 * snapshot exists and no confirmation number was issued. Putting them in the
 * pipeline would mean statuses, assignment and exports treating a half-typed form
 * as a candidate record — and the applicant never agreed to file it.
 *
 * ## What it deliberately does not show
 *
 * The answers. This is a contact list: a name, a way to reach them, how far they
 * got and when. Reading someone's partial DOT questionnaire before they have
 * agreed to submit it is a decision they have not made, so the server does not
 * send it and this screen could not display it. There is no Social Security
 * Number to withhold — drafts never store one.
 */

/*
 * Fixture drafts for the `?e2eUnfinished=mock` harness, following the same shape
 * as `ReviewChangePortal`'s: gated on `VITE_E2E_TEST_MODE`, which a production
 * build never sets.
 *
 * It exists because this screen is in the blocking pixel lane and its content
 * came from a real `listApplicationDrafts` callable. With no credentials the call
 * fails, and *how* it fails decides what renders — so the committed baseline was
 * a loading skeleton in one environment and CI captured something 30% different.
 * A screenshot of a screen whose content depends on a network failure is not a
 * baseline.
 *
 * The three rows are the cases worth seeing: a complete contact, a draft with no
 * name typed yet, and one with no contact details at all. Timestamps are fixed
 * and sit before the lane's frozen clock.
 */
const MOCK_DRAFTS = Object.freeze([
    Object.freeze({
        id: 'draft-1',
        firstName: 'Dana',
        lastName: 'Whitfield',
        email: 'dana.whitfield@example.test',
        phone: '(555) 010-2233',
        lastSemanticStep: 'license',
        updatedAt: '2026-06-14T16:45:00.000Z',
    }),
    Object.freeze({
        id: 'draft-2',
        email: 'starter@example.test',
        lastSemanticStep: 'contact',
        updatedAt: '2026-06-12T09:05:00.000Z',
    }),
    Object.freeze({
        id: 'draft-3',
        firstName: 'Marcus',
        lastName: 'Iyer',
        lastSemanticStep: 'employment',
        updatedAt: '2026-06-09T21:30:00.000Z',
    }),
]);

/** The wizard's own step names, in order, so "how far did they get" reads plainly. */
const STEP_LABELS = Object.freeze({
    contact: 'Personal information',
    qualifications: 'Qualifications',
    license: 'License & credentials',
    violations: 'Driving record',
    accidents: 'Accident history',
    employment: 'Employment history',
    general: 'General questions',
    custom_questions: 'Company questions',
    review: 'Review',
    consent: 'Agreements & signature',
});

function describeStep(entry) {
    if (entry.lastSemanticStep && STEP_LABELS[entry.lastSemanticStep]) {
        return STEP_LABELS[entry.lastSemanticStep];
    }
    return `Step ${(entry.lastStep || 0) + 1}`;
}

function describeError(error, fallback) {
    switch (error?.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'You do not have access to this company.';
        default:
            return fallback;
    }
}

export function UnfinishedApplicationsPage() {
    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id;

    const isMock = isE2ETestMode && getE2EQueryParam('e2eUnfinished', '') === 'mock';

    const [drafts, setDrafts] = useState([]);
    const [retentionDays, setRetentionDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (isMock) {
            setDrafts(MOCK_DRAFTS);
            setRetentionDays(30);
            setError(null);
            setLoading(false);
            return;
        }
        if (!companyId) return;
        setLoading(true);
        setError(null);
        try {
            const call = httpsCallable(functions, 'listApplicationDrafts');
            const result = await call({ companyId });
            setDrafts(result.data?.drafts || []);
            if (result.data?.retentionDays) setRetentionDays(result.data.retentionDays);
        } catch (loadError) {
            setError(describeError(loadError, 'Unfinished applications could not be loaded.'));
            setDrafts([]);
        } finally {
            setLoading(false);
        }
    }, [companyId, isMock]);

    useEffect(() => { load(); }, [load]);

    const columns = useMemo(() => [
        {
            key: 'name',
            header: 'Applicant',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (entry) => {
                const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ');
                return (
                    <span className="font-medium text-ds-content">
                        {name || 'Name not entered yet'}
                    </span>
                );
            },
        },
        {
            key: 'contact',
            header: 'Contact',
            priority: 'secondary',
            width: 'lg',
            render: (entry) => (
                <div className="flex flex-col gap-ds-1 text-ds-sm text-ds-content-secondary">
                    {entry.email && <span>{entry.email}</span>}
                    {entry.phone && <span>{entry.phone}</span>}
                    {!entry.email && !entry.phone && <span>No contact details yet</span>}
                </div>
            ),
        },
        {
            key: 'progress',
            header: 'Reached',
            priority: 'secondary',
            width: 'md',
            render: (entry) => <Badge tone="info">{describeStep(entry)}</Badge>,
        },
        {
            key: 'updated',
            header: 'Last activity',
            priority: 'tertiary',
            width: 'md',
            render: (entry) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown'}
                </span>
            ),
        },
    ], []);

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title="Started (unfinished)"
                    description={`Applications somebody began and has not submitted. They are not in the applications pipeline: nothing has been signed and no consent has been given. Kept for ${retentionDays} days, then removed automatically.`}
                />

                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        <RefreshCw size={14} aria-hidden="true" /> Refresh
                    </Button>
                </div>

                {error && (
                    <Card padding="md">
                        <FieldMessage tone="error">{error}</FieldMessage>
                        <div className="mt-ds-2">
                            <Button variant="secondary" onClick={load}>
                                <RefreshCw size={14} aria-hidden="true" /> Try again
                            </Button>
                        </div>
                    </Card>
                )}

                <DataTable
                    ariaLabel="Unfinished applications"
                    density="compact"
                    minWidth="md"
                    data={drafts}
                    columns={columns}
                    isLoading={loading}
                    loadingLabel="Loading unfinished applications"
                    empty={{
                        title: 'No unfinished applications.',
                        description: 'Everyone who has started an application has either submitted it or their draft has expired.',
                    }}
                />
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationsPage;
