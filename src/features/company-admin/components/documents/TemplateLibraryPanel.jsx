import React, { useId, useMemo } from 'react';
import { Icon, Copy, Edit3, FileText, Loader2, Plus, Send, Settings, Trash2 } from '@design-system/icons';
import { Badge, Button, Card, IconButton, Label, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ListToolbar } from '@/design-system/patterns';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import {
    TEMPLATE_SORTS,
    formatTimestamp,
    isTemplateDuplicable,
    searchTemplates,
    sortTemplates,
} from '@features/company-admin/utils/documentsWorkspace';

/**
 * Documents workspace — Templates.
 *
 * A library, not a settings screen: post-application configuration moved to its
 * own After-application forms view, so this one is only about the templates
 * themselves. New template (`onCreate`) starts the editor's template flow, the
 * one New Document → Create reusable template starts; an empty library offers
 * it too.
 *
 * Every action is a visible button rather than an overflow menu — the design
 * system has no approved menu primitive yet (tracked in the roadmap), and the
 * previous card already showed its actions inline. Delete is offered only with
 * `onDelete`: the rules let a company admin alone delete a template, and the
 * workspace passes it to admins only. It is the one look of a row or card
 * delete, a quiet icon button in the card's corner, and the workspace's
 * confirmation follows it.
 */
export function TemplateLibraryPanel({
    templates,
    templatesLoading,
    postSubmitTemplateIds,
    search,
    setSearch,
    sort,
    setSort,
    onSend,
    onEdit,
    onDuplicate,
    onConfigure,
    onDelete,
    onCreate,
    duplicatingTemplateId,
}) {
    const isMobile = useIsMobile();
    const rawId = useId().replace(/:/g, '');
    const controlsHeadingId = `template-library-controls-${rawId}`;
    const sortId = `template-library-sort-${rawId}`;
    const actionSize = isMobile ? 'md' : 'sm';

    const visibleTemplates = useMemo(
        () => sortTemplates(searchTemplates(templates, search), sort),
        [templates, search, sort],
    );

    const newTemplate = (
        <Button variant="secondary" onClick={onCreate} className="shrink-0">
            <Icon icon={Plus} size="sm" /> New template
        </Button>
    );

    return (
        <Stack gap="md">
            {/* One row without a frame: the heading and how many are shown, then
                the search, Sort by and New template. When they do not fit beside
                the heading, the tools take a row of their own from the left. On a
                phone New template stays beside the heading (C2), and the search
                and Sort by take a row each. */}
            <section aria-labelledby={controlsHeadingId}>
                <ListToolbar
                    placement="page"
                    lead={(
                        <div className="flex min-w-0 items-start justify-between gap-ds-3">
                            <div className="flex min-w-0 flex-col">
                                <h2 id={controlsHeadingId} className="text-ds-heading-md font-semibold text-ds-content">
                                    Template library
                                </h2>
                                <p role="status" className="text-ds-xs text-ds-content-secondary">
                                    {templatesLoading
                                        ? 'Loading templates…'
                                        : `Showing ${visibleTemplates.length} of ${templates.length} template${templates.length === 1 ? '' : 's'}.`}
                                </p>
                            </div>
                            {isMobile && newTemplate}
                        </div>
                    )}
                    search={{
                        label: 'Search templates',
                        placeholder: 'Template title',
                        value: search,
                        onChange: setSearch,
                    }}
                    actions={(
                        <>
                            {/* On a phone the list takes the row. */}
                            <div className="flex min-w-0 items-center gap-ds-2 max-md:basis-full">
                                <Label htmlFor={sortId} className="whitespace-nowrap">Sort by</Label>
                                <div className="w-[12.5rem] max-md:w-auto max-md:min-w-0 max-md:flex-1">
                                    <Select id={sortId} value={sort} onChange={(event) => setSort(event.target.value)}>
                                        {TEMPLATE_SORTS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </Select>
                                </div>
                            </div>
                            {!isMobile && newTemplate}
                        </>
                    )}
                />
            </section>

            {templatesLoading ? (
                <div
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-ds-12 text-ds-sm text-ds-content-secondary"
                >
                    <Icon icon={Loader2} size="xl" className="animate-spin" />
                    Loading templates
                </div>
            ) : visibleTemplates.length === 0 ? (
                <div className="flex flex-col items-center gap-ds-3 rounded-ds-card border-2 border-dashed border-ds-border bg-ds-surface p-ds-12 text-center">
                    <p className="text-ds-body text-ds-content-secondary">
                        {templates.length === 0
                            ? 'No templates saved yet.'
                            : 'No templates match this search.'}
                    </p>
                    {templates.length === 0 && (
                        <Button variant="primary" onClick={onCreate}>
                            <Icon icon={Plus} size="sm" /> New template
                        </Button>
                    )}
                </div>
            ) : (
                // Columns of at least 340px that never stretch a lone card across
                // the page: three on the 1200px canvas, one on a tablet or a phone.
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21.25rem),1fr))] gap-ds-5">
                    {visibleTemplates.map((template) => {
                        // Visible titles render the stored value unchanged; only the
                        // accessible action names fall back, so an untitled template
                        // still exposes distinguishable controls.
                        const actionTitle = template.title || 'Untitled';
                        const usedPostApplication = postSubmitTemplateIds.includes(template.id);
                        const duplicable = isTemplateDuplicable(template);

                        return (
                            <Card key={template.id} className="flex h-full flex-col gap-ds-5">
                                <div className="flex items-start gap-ds-3">
                                    <span
                                        aria-hidden="true"
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ds-lg bg-ds-status-accent-bg text-ds-status-accent-fg"
                                    >
                                        <Icon icon={FileText} size="xl" />
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col items-start gap-ds-1">
                                        <h3 className="text-ds-heading-md font-semibold text-ds-content [overflow-wrap:anywhere]">
                                            {template.title}
                                        </h3>
                                        <p className="flex flex-wrap items-center gap-ds-1">
                                            <Badge tone="accent">{template.fields?.length || 0} fields</Badge>
                                            {template.updatedAt && (
                                                <Badge tone="neutral">
                                                    Updated {formatTimestamp(template.updatedAt)}
                                                </Badge>
                                            )}
                                            {usedPostApplication && (
                                                <Badge tone="info">Sent after application</Badge>
                                            )}
                                        </p>
                                    </div>
                                    {/* The one look of a row or card delete: a quiet
                                        icon button in the danger colour, named for
                                        the template; the confirmation carries the weight. */}
                                    {onDelete && (
                                        <IconButton
                                            variant="ghost"
                                            size="sm"
                                            className="-mr-ds-2 -mt-ds-1 shrink-0"
                                            label={`Delete ${actionTitle}`}
                                            onClick={() => onDelete(template.id)}
                                        >
                                            <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                                        </IconButton>
                                    )}
                                </div>

                                {/* An even two-by-two grid, in the order Tab takes them. */}
                                <div className="mt-auto grid grid-cols-2 gap-ds-2">
                                    <Button
                                        variant="primary"
                                        size={actionSize}
                                        fullWidth
                                        aria-label={`Send ${actionTitle}`}
                                        onClick={() => onSend(template)}
                                    >
                                        <Icon icon={Send} size="sm" /> Send
                                    </Button>
                                    <Button
                                        size={actionSize}
                                        fullWidth
                                        aria-label={`Edit ${actionTitle}`}
                                        onClick={() => onEdit(template)}
                                    >
                                        <Icon icon={Edit3} size="sm" /> Edit
                                    </Button>
                                    {/* Only offered when the stored schema can be copied
                                        safely: a template without its PDF, or carrying a
                                        field type the editor does not know, would produce
                                        a duplicate that can never be sent. */}
                                    <Button
                                        size={actionSize}
                                        fullWidth
                                        aria-label={`Duplicate ${actionTitle}`}
                                        disabled={!duplicable}
                                        loading={duplicatingTemplateId === template.id}
                                        title={
                                            duplicable
                                                ? `Duplicate ${actionTitle}`
                                                : 'This template cannot be duplicated safely — its file or field types are missing or unsupported.'
                                        }
                                        onClick={() => onDuplicate(template)}
                                    >
                                        {duplicatingTemplateId !== template.id && (
                                            <Icon icon={Copy} size="sm" />
                                        )}
                                        Duplicate
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size={actionSize}
                                        fullWidth
                                        aria-label={`Configure ${actionTitle}`}
                                        onClick={() => onConfigure(template)}
                                    >
                                        <Icon icon={Settings} size="sm" /> Configure
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </Stack>
    );
}

export default TemplateLibraryPanel;
