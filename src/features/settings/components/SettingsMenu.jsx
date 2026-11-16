import React from 'react';
import { Card, SelectableCard } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { Icon, ChevronRight } from '@design-system/icons';

/**
 * Settings' own page, at every width: every section, grouped, each a way in
 * with what it holds (`item.description`). From 1280px an open section also
 * has the rail beside it. Each group is one card, its sections rows divided by
 * a line (`SelectableCard frame="row"`); each row stays a button named by its
 * label and its line.
 */
export function SettingsMenu({ groups, onSelect }) {
    return (
        <Stack gap="lg">
            <PageHeader
                eyebrow="Account"
                title="Settings"
                description="Everything about how your company recruits, in one place."
            />
            <Stack gap="md">
                {groups.map((group) => (
                    <div key={group.id}>
                        <h2 className="mb-ds-2 text-ds-xs font-semibold uppercase tracking-wider text-ds-content-muted">
                            {group.label}
                        </h2>
                        <Card as="div" padding="none" elevation="soft">
                            <ul className="divide-y divide-ds-border-subtle">
                                {group.items.map((item) => (
                                    <li key={item.id}>
                                        <SelectableCard frame="row" onSelect={() => onSelect(item.id)}>
                                            <span className="flex w-full min-w-0 items-center gap-ds-3 text-left">
                                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-md bg-ds-brand-primary-subtle text-ds-brand-primary">
                                                    <Icon icon={item.icon} size="md" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-ds-body font-semibold text-ds-content">{item.label}</span>
                                                    <span className="block text-ds-xs text-ds-content-secondary [text-wrap:pretty]">
                                                        {item.description}
                                                    </span>
                                                </span>
                                                <Icon icon={ChevronRight} size="md" className="shrink-0 text-ds-content-muted" />
                                            </span>
                                        </SelectableCard>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    </div>
                ))}
            </Stack>
        </Stack>
    );
}
