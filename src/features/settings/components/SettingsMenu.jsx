import React from 'react';
import { SelectableCard } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { Icon, ChevronRight } from '@design-system/icons';

/** One line under each section's name: what it holds. */
const SECTION_SUMMARIES = {
    company: 'Name, logo, contact details and address',
    application: 'Questions, rules, agreements and imports',
    team: 'Who recruits for you',
    email: 'Sending from your own mailbox',
    sms: 'Phone lines and who texts from them',
    automated_sms: 'Messages sent at each contact attempt',
    api_keys: 'Let another service read your applications',
    integrations: 'Leads from Facebook Lead Ads',
    billing: 'Your subscription',
    personal: 'Your name and recruiting link',
};

/**
 * Settings on a phone: every section, grouped, each a way in with what it
 * holds. A phone has no room for the rail, so this list is its menu; a wider
 * screen never shows it.
 */
export function SettingsMenu({ groups, onSelect }) {
    return (
        <Stack gap="lg">
            <PageHeader
                title="Settings"
                description="Everything about how your company recruits, in one place."
            />
            {groups.map((group) => (
                <div key={group.id}>
                    <h2
                        className="mb-ds-2 text-ds-xs font-bold uppercase tracking-wider text-ds-content-muted"
                    >
                        {group.label}
                    </h2>
                    <ul className="flex flex-col gap-ds-2">
                        {group.items.map((item) => (
                            <li key={item.id}>
                                <SelectableCard onSelect={() => onSelect(item.id)} className="w-full">
                                    <span className="flex w-full min-w-0 items-center gap-ds-3 text-left">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-md bg-ds-surface-subtle text-ds-content-secondary">
                                            <Icon icon={item.icon} size="lg" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-ds-content">{item.label}</span>
                                            <span className="block truncate text-ds-sm text-ds-content-muted">
                                                {SECTION_SUMMARIES[item.id]}
                                            </span>
                                        </span>
                                        <Icon icon={ChevronRight} size="md" className="shrink-0 text-ds-content-muted" />
                                    </span>
                                </SelectableCard>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </Stack>
    );
}
