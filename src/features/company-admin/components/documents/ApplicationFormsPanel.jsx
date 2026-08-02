import React, { useId } from 'react';
import { ArrowDown, ArrowUp, Loader2, Save } from 'lucide-react';
import { Button, Card, Checkbox, IconButton } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * Documents workspace — Application Forms.
 *
 * The post-application configuration that used to sit at the top of the
 * Templates tab, now its own view. Every contract is preserved exactly:
 *
 *  - the enabled template ids and their ORDER are the array
 *    `companies/{id}.postApplicationTemplates` is written from;
 *  - "required" defaults to true for any entry without an explicit flag, which
 *    is what keeps legacy string entries working;
 *  - saving is explicit ("Save forms") — toggling never writes;
 *  - deleting a template still prunes it immediately, in DocumentsManager.
 *
 * Presentation only: every callback argument shape is the pre-redesign one.
 */
export function ApplicationFormsPanel({
    templates,
    templatesLoading,
    postSubmitTemplateIds,
    postSubmitRequiredById = {},
    togglePostSubmitRequired,
    savingPostSubmitTemplates,
    handleSavePostSubmitTemplates,
    movePostSubmitTemplate,
    isTemplateEnabledPostSubmit,
    togglePostSubmitTemplate,
}) {
    const rawId = useId().replace(/:/g, '');
    const enabledHeadingId = `application-forms-enabled-${rawId}`;
    const chooseHeadingId = `application-forms-choose-${rawId}`;

    return (
        <Stack gap="md">
            <Card aria-labelledby={enabledHeadingId}>
                <Stack gap="sm">
                    <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <h2 id={enabledHeadingId} className="text-ds-body font-bold text-ds-content">
                                Forms shown after an application
                            </h2>
                            <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
                                These templates appear right after a driver submits the application, in the order
                                below. Forms are <strong>required</strong> by default — drivers see them as a
                                must-complete checklist. Untick "Required" to make a form optional.
                            </p>
                        </div>
                        <Button
                            variant="primary"
                            className="shrink-0"
                            loading={savingPostSubmitTemplates}
                            onClick={handleSavePostSubmitTemplates}
                        >
                            {!savingPostSubmitTemplates && <Save size={14} aria-hidden="true" />}
                            Save forms
                        </Button>
                    </div>

                    {/* Announce the in-flight save; the Button also reports aria-busy. */}
                    <p role="status" className="ds-visually-hidden">
                        {savingPostSubmitTemplates ? 'Saving post-application forms…' : ''}
                    </p>

                    {postSubmitTemplateIds.length === 0 ? (
                        <p className="text-ds-sm text-ds-content-secondary">No follow-up forms enabled yet.</p>
                    ) : (
                        <ul className="flex flex-col gap-ds-2">
                            {postSubmitTemplateIds.map((templateId, index) => {
                                const template = templates.find((item) => item.id === templateId);
                                if (!template) return null;
                                const isRequired = postSubmitRequiredById[templateId] !== false;
                                const title = template.title || 'Complete Form';
                                const isFirst = index === 0;
                                const isLast = index === postSubmitTemplateIds.length - 1;

                                return (
                                    <li
                                        key={templateId}
                                        className="flex flex-wrap items-center justify-between gap-ds-2 rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg px-ds-3 py-ds-2"
                                    >
                                        <span className="min-w-0 flex-1 text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">
                                            {index + 1}. {title}
                                        </span>
                                        <div className="flex shrink-0 flex-wrap items-center gap-ds-2">
                                            <Checkbox
                                                id={`application-form-required-${templateId}-${rawId}`}
                                                label={`Required for ${title}`}
                                                labelHidden
                                                checked={isRequired}
                                                onChange={() => togglePostSubmitRequired?.(templateId)}
                                            />
                                            <span aria-hidden="true" className="text-ds-sm text-ds-content">Required</span>
                                            <IconButton
                                                label={`Move ${title} up`}
                                                variant="ghost"
                                                size="sm"
                                                disabled={isFirst}
                                                // The tooltip explains why a disabled control cannot
                                                // move, since it is skipped by keyboard focus.
                                                title={isFirst ? `${title} is already first` : `Move ${title} up`}
                                                onClick={() => movePostSubmitTemplate(templateId, 'up')}
                                            >
                                                <ArrowUp size={14} aria-hidden="true" />
                                            </IconButton>
                                            <IconButton
                                                label={`Move ${title} down`}
                                                variant="ghost"
                                                size="sm"
                                                disabled={isLast}
                                                title={isLast ? `${title} is already last` : `Move ${title} down`}
                                                onClick={() => movePostSubmitTemplate(templateId, 'down')}
                                            >
                                                <ArrowDown size={14} aria-hidden="true" />
                                            </IconButton>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Stack>
            </Card>

            <Card aria-labelledby={chooseHeadingId}>
                <Stack gap="sm">
                    <h2 id={chooseHeadingId} className="text-ds-body font-bold text-ds-content">
                        Choose templates
                    </h2>
                    {templatesLoading ? (
                        <p role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                            <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                            Loading templates
                        </p>
                    ) : templates.length === 0 ? (
                        <p className="text-ds-sm text-ds-content-secondary">
                            No templates saved yet. Create a template first, then enable it here.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-ds-1">
                            {templates.map((template) => (
                                <li key={template.id}>
                                    <Checkbox
                                        id={`application-form-enabled-${template.id}-${rawId}`}
                                        label={template.title || 'Untitled template'}
                                        checked={isTemplateEnabledPostSubmit(template.id)}
                                        onChange={() => togglePostSubmitTemplate(template.id)}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-ds-xs text-ds-content-secondary">
                        Changes are not live until you press “Save forms”.
                    </p>
                </Stack>
            </Card>
        </Stack>
    );
}

export default ApplicationFormsPanel;
