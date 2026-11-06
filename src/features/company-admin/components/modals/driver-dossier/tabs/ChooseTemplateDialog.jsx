import React, { useId, useMemo, useState } from 'react';
import { Icon, FileText, X } from '@design-system/icons';
import { Modal } from '@design-system/patterns';
import { Badge, Button, FormField, IconButton, Input } from '@/design-system/components';
import { useCompanyTemplates } from '@features/company-admin/hooks/useCompanyTemplates';
import { searchTemplates } from '@features/company-admin/utils/documentsWorkspace';

/**
 * Send a document's first step in the dossier: which of the company's E-Docs
 * templates to send (`useCompanyTemplates`, live, newest change first, as the
 * Templates tab lists them; `searchTemplates`, its search). Choosing one hands it
 * to `onChoose`, which opens E-Docs' own send wizard with the driver as the
 * recipient. Templates are made and changed in E-Docs, not here.
 *
 * Presentation: the approved `Modal`, `FormField`, `Input`, `Button` and `Badge`.
 */
export function ChooseTemplateDialog({ companyId, isE2EEdocMock = false, recipientName, onChoose, onClose }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `choose-template-title-${rawId}`;
    const descriptionId = `choose-template-description-${rawId}`;
    const [search, setSearch] = useState('');
    const { templates, templatesLoading } = useCompanyTemplates({ companyId, isE2EEdocMock });
    const visible = useMemo(() => searchTemplates(templates, search), [templates, search]);

    let body;
    if (templatesLoading) {
        body = <p role="status" className="py-ds-6 text-center text-ds-sm text-ds-content-secondary">Loading templates…</p>;
    } else if (visible.length === 0) {
        body = (
            <p role="status" className="py-ds-6 text-center text-ds-sm text-ds-content-secondary">
                {templates.length === 0 ? 'No templates saved yet. Templates are made in E-Docs.' : 'No templates match this search.'}
            </p>
        );
    } else {
        body = (
            <ul className="flex flex-col gap-ds-2">
                {visible.map((template) => (
                    <li key={template.id}>
                        <Button
                            variant="secondary"
                            fullWidth
                            justify="start"
                            className="h-auto py-ds-3 text-left"
                            onClick={() => onChoose(template)}
                        >
                            <Icon icon={FileText} size="lg" />
                            <span className="min-w-0 flex-1 font-bold text-ds-content [overflow-wrap:anywhere]">
                                {template.title || 'Untitled'}
                            </span>
                            <Badge tone="neutral">{template.fields?.length || 0} fields</Badge>
                        </Button>
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <Modal onClose={onClose} labelledBy={titleId} describedBy={descriptionId} size="md" scroll="body">
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Send a document</h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                        Choose the template to send to {recipientName || 'this driver'}.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                <div className="mb-ds-3">
                    <FormField label="Search templates">
                        <Input
                            type="search"
                            value={search}
                            placeholder="Template title"
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </FormField>
                </div>
                {body}
            </div>

            <div className="flex justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
        </Modal>
    );
}

export default ChooseTemplateDialog;
