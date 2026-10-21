import React from 'react';
import { Icon, Activity } from '@design-system/icons';
import { Stack } from '@/design-system/layouts';
import { TelegramAlertsCard } from './alerts/TelegramAlertsCard';

/**
 * System Health — the hourly AI and blog watcher, and where it sends its
 * alerts.
 *
 * Maintenance actions are on the Maintenance page (`MaintenanceView`), Sync
 * Public Profiles and its output log among them. There is no Deep Diagnostic
 * (it created test users and records in the live database with a fixed
 * password) and no "Sync Backend Structure" (it wrote schema defaults into every
 * live record missing a field), here or as a server callable, and no one-off
 * SMS history backfill.
 */
export function SystemHealthView() {
    return (
        <Stack gap="lg">
            <header>
                <h2 className="flex items-center gap-ds-2 text-ds-heading-lg font-bold text-ds-content">
                    {/* Standalone in an `<h2>`, so it is `2xl` — lucide rendered 24 bare. */}
                    <Icon icon={Activity} size="2xl" className="text-ds-content-link" /> System Health
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    The hourly AI and blog watcher, and where it sends its alerts.
                </p>
            </header>

            {/* The hourly watcher of AI and the blog, and where it sends its alerts. */}
            <TelegramAlertsCard />
        </Stack>
    );
}
