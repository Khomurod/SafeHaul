import React, { useId } from 'react';
import { Blocks } from 'lucide-react';
import { Card, Switch } from '@/design-system/components';

/**
 * Optional data sources for the driver application: the FMCSA Pre-Employment
 * Screening Program (PSP) report and the motor vehicle record (MVR).
 *
 * Off for every company until it switches one on, and switching one on changes
 * exactly one thing for applicants: an optional "upload your report" control
 * appears, and anything read from the report is offered back for confirmation —
 * a possible previous carrier, an approximate period, a licence detail, a
 * violation — never written into an answer the applicant already gave. A PSP
 * report shows crash and inspection history, not employment dates, so nothing
 * from it is ever presented as exact employment history.
 *
 * Stored as `applicationIntegrations.{psp,mvr}.enabled`; only these two flags
 * reach the public apply page (`publicProfileDto`).
 */
const SOURCES = [
    {
        id: 'psp',
        title: 'FMCSA PSP report import',
        help: 'Applicants can upload their PSP report. Carriers and violations it mentions are suggested for the applicant to confirm — never added on their behalf.',
    },
    {
        id: 'mvr',
        title: 'Motor vehicle record (MVR) import',
        help: 'Applicants can upload their MVR. Licence details and violations it lists are suggested for confirmation.',
    },
];

export function ApplicationIntegrationsPanel({ integrations, onChange, readOnly = false }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `application-integrations-title-${rawId}`;
    const current = integrations && typeof integrations === 'object' ? integrations : {};
    const isOn = (id) => Boolean(current[id] && current[id].enabled === true);

    return (
        <Card padding="none" className="overflow-hidden" aria-labelledby={titleId}>
            <div className="flex items-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Blocks size={18} className="text-ds-content-muted" aria-hidden="true" />
                <h4 id={titleId} className="text-ds-body font-bold text-ds-content">Application Integrations</h4>
            </div>
            <p className="border-b border-ds-border-subtle px-ds-4 py-ds-3 text-ds-sm text-ds-content-muted">
                Optional. A company that leaves these off is not affected in any way. When on, imported information helps the
                applicant fill in the application and is always shown for confirmation before it becomes part of their record.
            </p>
            <ul className="divide-y divide-ds-border-subtle">
                {SOURCES.map((source) => (
                    <li key={source.id} className="flex flex-col gap-ds-3 px-ds-4 py-ds-4 sm:flex-row sm:items-start sm:justify-between sm:gap-ds-6" data-integration={source.id}>
                        <div className="min-w-0 space-y-ds-1">
                            <p className="text-ds-sm font-semibold text-ds-content">{source.title}</p>
                            <p className="text-ds-xs text-ds-content-muted">{source.help}</p>
                        </div>
                        <div className="shrink-0">
                            <Switch
                                checked={isOn(source.id)}
                                tone="success"
                                label={`Enable ${source.title}`}
                                disabled={readOnly}
                                onChange={(checked) => onChange({ ...current, [source.id]: { ...(current[source.id] || {}), enabled: checked } })}
                            />
                        </div>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

export default ApplicationIntegrationsPanel;
