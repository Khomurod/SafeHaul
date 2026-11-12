import React, { useId } from 'react';
import { Icon, ArrowDown, ArrowUp, Loader2, Save } from '@design-system/icons';
import { Button, Checkbox, FormSection, IconButton } from '@/design-system/components';

/**
 * Documents workspace — After-application forms.
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
 * `forms` is `usePostSubmitForms`'s result, whole; `templates` and
 * `templatesLoading` come from the company's template list.
 */
export function ApplicationFormsPanel({ templates, templatesLoading, forms }) {
    const {
        postSubmitTemplateIds,
        postSubmitRequiredById = {},
        togglePostSubmitRequired,
        savingPostSubmitTemplates,
        handleSavePostSubmitTemplates,
        movePostSubmitTemplate,
        isTemplateEnabledPostSubmit,
        togglePostSubmitTemplate,
    } = forms;
    const rawId = useId().replace(/:/g, '');
    const chooseHeadingId = `application-forms-choose-${rawId}`;

    // One section: the heading and what it does above a single card, which
    // holds the enabled forms, the templates to choose from and, at its foot,
    // Save forms.
    return (
        <FormSection
            layout="stacked"
            padding="none"
            title="Forms shown after an application"
            description={(
                <>
                    These templates appear right after a driver submits the application, in the order
                    below. Forms are <strong>required</strong> by default — drivers see them as a
                    must-complete checklist. Untick "Required" to make a form optional.
                </>
            )}
            footer={(
                <Button
                    variant="primary"
                    loading={savingPostSubmitTemplates}
                    onClick={handleSavePostSubmitTemplates}
                >
                    {!savingPostSubmitTemplates && <Icon icon={Save} size="sm" />}
                    Save forms
                </Button>
            )}
        >
            {/* Announce the in-flight save; the Button also reports aria-busy. */}
            <p role="status" className="ds-visually-hidden">
                {savingPostSubmitTemplates ? 'Saving after-application forms…' : ''}
            </p>

            {postSubmitTemplateIds.length === 0 ? (
                <p className="flex min-h-14 items-center rounded-t-[calc(var(--ds-card-radius)-1px)] border-b border-ds-border-subtle bg-ds-canvas px-ds-5 py-ds-4 text-ds-body text-ds-content-secondary max-md:px-ds-4">
                    No follow-up forms enabled yet.
                </p>
            ) : (
                <ul className="flex flex-col gap-ds-2 border-b border-ds-border-subtle p-ds-5 max-md:p-ds-4">
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
                                        <Icon icon={ArrowUp} size="sm" />
                                    </IconButton>
                                    <IconButton
                                        label={`Move ${title} down`}
                                        variant="ghost"
                                        size="sm"
                                        disabled={isLast}
                                        title={isLast ? `${title} is already last` : `Move ${title} down`}
                                        onClick={() => movePostSubmitTemplate(templateId, 'down')}
                                    >
                                        <Icon icon={ArrowDown} size="sm" />
                                    </IconButton>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* On a phone a checklist's 44px rows already leave white under the
                last box, so the footer follows 8px later. */}
            <div
                role="group"
                aria-labelledby={chooseHeadingId}
                className={`px-ds-5 pb-ds-5 pt-ds-5 max-md:px-ds-4 max-md:pt-ds-4 ${templatesLoading || templates.length === 0 ? '' : 'max-md:pb-ds-2'}`}
            >
                <h3 id={chooseHeadingId} className="text-ds-heading-sm font-semibold text-ds-content">
                    Choose templates
                </h3>
                <p className="mt-ds-1 text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                    Changes are not live until you press “Save forms”.
                </p>
                {templatesLoading ? (
                    <p role="status" className="mt-ds-3 flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                        <Icon icon={Loader2} className="animate-spin" />
                        Loading templates
                    </p>
                ) : templates.length === 0 ? (
                    <p className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                        No templates saved yet. Create a template first, then enable it here.
                    </p>
                ) : (
                    // On a phone each choice is a 44px row, its box centred in it.
                    <ul className="mt-ds-3 flex flex-col gap-ds-1 max-md:mt-ds-2 max-md:gap-ds-2">
                        {templates.map((template) => (
                            <li key={template.id} className="max-md:flex max-md:min-h-ds-control max-md:items-center">
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
            </div>
        </FormSection>
    );
}

export default ApplicationFormsPanel;
