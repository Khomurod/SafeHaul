import React from 'react';
import { FormSection, Switch } from '@/design-system/components';
import { SettingRows, SwitchSettingRow } from './SettingRows';

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
        help: 'Applicants can upload their PSP report. Carriers it mentions are suggested for the applicant to confirm — never added on their behalf.',
    },
    {
        id: 'mvr',
        title: 'Motor vehicle record (MVR) import',
        help: 'Applicants can upload their MVR. Licence details and violations it lists are suggested for confirmation.',
    },
];

export function ApplicationIntegrationsPanel({ integrations, onChange, readOnly = false }) {
    const current = integrations && typeof integrations === 'object' ? integrations : {};
    const isOn = (id) => Boolean(current[id] && current[id].enabled === true);

    return (
        <FormSection
            layout="stacked"
            padding="none"
            title="Report uploads"
            description="Optional. A company that leaves these off is not affected in any way. When on, imported information helps the applicant fill in the application and is always shown for confirmation before it becomes part of their record."
        >
            <SettingRows>
                {SOURCES.map((source) => (
                    <SwitchSettingRow
                        key={source.id}
                        data-integration={source.id}
                        title={source.title}
                        help={source.help}
                        control={(
                            <Switch
                                checked={isOn(source.id)}
                                tone="success"
                                label={`Enable ${source.title}`}
                                disabled={readOnly}
                                onChange={(checked) => onChange({ ...current, [source.id]: { ...(current[source.id] || {}), enabled: checked } })}
                            />
                        )}
                    />
                ))}
            </SettingRows>
        </FormSection>
    );
}

export default ApplicationIntegrationsPanel;
