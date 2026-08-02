import React, { useId, useMemo } from 'react';
import { Copy, Edit3, FileText, Loader2, Send, Settings, Trash2 } from 'lucide-react';
import { Badge, Button, Card, FormField, Input, Select } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
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
 * own Application Forms view, so this one is only about the templates
 * themselves.
 *
 * Every action is a visible button rather than an overflow menu — the design
 * system has no approved menu primitive yet (tracked in the roadmap), and the
 * previous card already showed its actions inline.
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
    duplicatingTemplateId,
}) {
    const rawId = useId().replace(/:/g, '');
    const controlsHeadingId = `template-library-controls-${rawId}`;

    const visibleTemplates = useMemo(
        () => sortTemplates(searchTemplates(templates, search), sort),
        [templates, search, sort],
    );

    return (
        <Stack gap="md">
            <section
                aria-labelledby={controlsHeadingId}
                className="rounded-ds-xl border border-ds-border bg-ds-surface p-ds-4"
            >
                <h2 id={controlsHeadingId} className="mb-ds-3 text-ds-body font-bold text-ds-content">
                    Template library
                </h2>
                <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2">
                    <FormField label="Search templates">
                        <Input
                            type="search"
                            value={search}
                            placeholder="Template title"
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </FormField>
                    <FormField label="Sort by">
                        <Select value={sort} onChange={(event) => setSort(event.target.value)}>
                            {TEMPLATE_SORTS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </FormField>
                </div>
                <p role="status" className="mt-ds-2 text-ds-xs text-ds-content-secondary">
                    {templatesLoading
                        ? 'Loading templates…'
                        : `Showing ${visibleTemplates.length} of ${templates.length} template${templates.length === 1 ? '' : 's'}.`}
                </p>
            </section>

            {templatesLoading ? (
                <div
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-ds-12 text-ds-sm text-ds-content-secondary"
                >
                    <Loader2 size={20} aria-hidden="true" className="animate-spin" />
                    Loading templates
                </div>
            ) : visibleTemplates.length === 0 ? (
                <p className="rounded-ds-xl border-2 border-dashed border-ds-border bg-ds-surface p-ds-12 text-center text-ds-body text-ds-content-secondary">
                    {templates.length === 0
                        ? 'No templates saved yet.'
                        : 'No templates match this search.'}
                </p>
            ) : (
                <ResponsiveGrid minItemWidth="320px">
                    {visibleTemplates.map((template) => {
                        // Visible titles render the stored value unchanged; only the
                        // accessible action names fall back, so an untitled template
                        // still exposes distinguishable controls.
                        const actionTitle = template.title || 'Untitled';
                        const usedPostApplication = postSubmitTemplateIds.includes(template.id);
                        const duplicable = isTemplateDuplicable(template);

                        return (
                            <Card key={template.id} className="flex h-full flex-col gap-ds-3">
                                <div className="flex items-start gap-ds-3">
                                    <span
                                        aria-hidden="true"
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-ds-lg bg-ds-status-accent-bg text-ds-status-accent-fg"
                                    >
                                        <FileText size={24} />
                                    </span>
                                    <div className="min-w-0">
                                        <h3 className="text-ds-body font-bold text-ds-content [overflow-wrap:anywhere]">
                                            {template.title}
                                        </h3>
                                        <p className="mt-ds-1 flex flex-wrap items-center gap-ds-1">
                                            <Badge tone="neutral">{template.fields?.length || 0} fields</Badge>
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
                                </div>

                                <div className="mt-auto flex flex-col gap-ds-2">
                                    <Button
                                        variant="primary"
                                        fullWidth
                                        aria-label={`Send ${actionTitle}`}
                                        onClick={() => onSend(template)}
                                    >
                                        <Send size={14} aria-hidden="true" /> Send
                                    </Button>
                                    <div className="grid grid-cols-2 gap-ds-2">
                                        <Button
                                            aria-label={`Edit ${actionTitle}`}
                                            onClick={() => onEdit(template)}
                                        >
                                            <Edit3 size={14} aria-hidden="true" /> Edit
                                        </Button>
                                        {/* Only offered when the stored schema can be copied
                                            safely: a template without its PDF, or carrying a
                                            field type the editor does not know, would produce
                                            a duplicate that can never be sent. */}
                                        <Button
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
                                                <Copy size={14} aria-hidden="true" />
                                            )}
                                            Duplicate
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            aria-label={`Configure ${actionTitle}`}
                                            onClick={() => onConfigure(template)}
                                        >
                                            <Settings size={14} aria-hidden="true" /> Configure
                                        </Button>
                                        <Button
                                            variant="danger"
                                            aria-label={`Delete ${actionTitle}`}
                                            onClick={() => onDelete(template.id)}
                                        >
                                            <Trash2 size={14} aria-hidden="true" /> Delete
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </ResponsiveGrid>
            )}
        </Stack>
    );
}

export default TemplateLibraryPanel;
