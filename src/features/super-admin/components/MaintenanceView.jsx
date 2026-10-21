import React from 'react';
import { useHref, useLinkClickHandler, useLocation } from 'react-router-dom';
import { Card, Link } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { SUPER_ADMIN_VIEWS, superAdminPathFor } from '../config/views';
import { EmployerBackfillCard } from './EmployerBackfillCard';
import StatsBackfillPanel from './StatsBackfillPanel';
import { PublicProfileSyncCard } from './PublicProfileSyncCard';
import { HistoricalMigrationPanel } from './HistoricalMigrationPanel';
import { DataCleanupCard } from './DataCleanupCard';

/**
 * Super Admin → Maintenance: every platform-wide repair and backfill on one
 * page, one card per action. Each action that changes data asks first, through
 * the design system's `ConfirmDialog`; a dry-run or a check changes nothing and
 * runs at once.
 *
 * What each action does is its card's own contract — the same callables,
 * payloads and timeouts as where it lived before. The maintenance that belongs
 * to one screen stays on that screen (AI model versions, the blog's
 * publication check, releases); this page links to them.
 *
 * The `<h1>` lives in the Super Admin masthead, so this page starts at `<h2>`
 * and each card's title is an `<h3>`.
 *
 * @param {{ onDataUpdate?: () => void }} props `onDataUpdate` refreshes the
 *   console's lists, which the employer backfill does when it finishes.
 */
export function MaintenanceView({ onDataUpdate }) {
    return (
        <Stack gap="lg">
            <header>
                <h2 className="text-ds-heading-lg font-bold text-ds-content">Maintenance</h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Repairs and backfills for the whole platform. Every action that changes data asks
                    before it runs; a dry-run or a check changes nothing.
                </p>
            </header>

            <EmployerBackfillCard onDataUpdate={onDataUpdate} />
            <StatsBackfillPanel />
            <PublicProfileSyncCard />
            <HistoricalMigrationPanel />
            <DataCleanupCard />

            <Card padding="lg">
                <h3 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">On other screens</h3>
                <p className="mb-ds-3 text-ds-sm text-ds-content-secondary">
                    These stay beside the things they look after.
                </p>
                <ul className="space-y-ds-2 text-ds-sm text-ds-content-secondary">
                    <li>
                        <ScreenLink view={SUPER_ADMIN_VIEWS.AI_INTEGRATIONS}>AI Integrations</ScreenLink>
                        {' '}— Model versions: check the AI versions now, or go back to the built-in ones.
                    </li>
                    <li>
                        <ScreenLink view={SUPER_ADMIN_VIEWS.BLOG_POSTS}>Blog Posts</ScreenLink>
                        {' '}— run today&rsquo;s publication check, and read each run&rsquo;s outcome.
                    </li>
                    <li>
                        <ScreenLink view={SUPER_ADMIN_VIEWS.RELEASES}>Releases</ScreenLink>
                        {' '}— release the Testing version to Production, or roll back.
                    </li>
                </ul>
            </Card>
        </Stack>
    );
}

/**
 * A link to another panel screen: a real `href` (open in a new tab, copy the
 * address), and an ordinary click opens the screen in place, as the rail does.
 * The query string goes with it, which is how the browser tests sign in.
 */
function ScreenLink({ view, children }) {
    const { search } = useLocation();
    const to = { pathname: superAdminPathFor(view), search };
    const href = useHref(to);
    const handleClick = useLinkClickHandler(to);
    return <Link href={href} onClick={handleClick}>{children}</Link>;
}
