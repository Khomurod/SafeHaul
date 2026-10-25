import React, { useId } from 'react';
import { Icon, Settings } from '@design-system/icons';
import { Card, DataTable, FieldMessage, Switch } from '@/design-system/components';
import { resolveApplicationGate } from '@/config/applicationGates';

/**
 * The standard DOT questions a company can configure.
 *
 * Defaults are no longer duplicated here: every toggle resolves through
 * `src/config/applicationGates.js`, which is what the wizard, the submission
 * validator and the immutable snapshot resolve against too. They used to
 * differ — this screen showed Medical Card Upload as optional and MVR Consent
 * as required while the application enforced the exact opposite — so the
 * toggles described a configuration that was not the one in force.
 *
 * The fields are a `DataTable` row each, the field's name heading the row and
 * its two switches in their own columns; on a phone each field is a card.
 */
export const STANDARD_FIELDS = [
    { id: 'ssn', label: 'Social Security Number' },
    { id: 'dob', label: 'Date of Birth' },
    { id: 'addressHistory', label: '3 Years Address History' },
    { id: 'employmentHistory', label: 'Employment History (3-10 Yrs)' },
    { id: 'cdlUpload', label: 'CDL Document Upload' },
    { id: 'medCardUpload', label: 'Medical Card Upload' },
    { id: 'mvrConsent', label: 'Signed MVR Authorization Form (upload)' },
    { id: 'referralSource', label: 'Referral Source' },
    { id: 'emergencyContacts', label: 'Emergency Contacts' },
];

export function StandardQuestionsConfig({ config, onChange }) {
    const safeConfig = config || {};
    const rawId = useId().replace(/:/g, '');
    const titleId = `standard-questions-title-${rawId}`;

    const toggleField = (fieldId, type) => {
        // type: 'required' | 'hidden'

        // Start from the resolved state (canonical key, then legacy alias, then
        // the shared default) so the first toggle does not silently reset the
        // other half of a gate the company already configured elsewhere.
        const currentSetting = resolveApplicationGate(safeConfig, fieldId);

        let newSetting = { required: currentSetting.required, hidden: currentSetting.hidden };

        if (type === 'required') {
            newSetting.required = !newSetting.required;
            // If making required, it cannot be hidden
            if (newSetting.required) newSetting.hidden = false;
        } else if (type === 'hidden') {
            newSetting.hidden = !newSetting.hidden;
            // If hiding, it cannot be required
            if (newSetting.hidden) newSetting.required = false;
        }

        onChange({
            ...safeConfig,
            [fieldId]: newSetting
        });
    };

    const columns = [
        {
            key: 'field',
            header: 'Field Name',
            rowHeader: true,
            width: 'xl',
            render: (field) => <span className="font-medium text-ds-content">{field.label}</span>,
        },
        {
            key: 'required',
            header: 'Required',
            width: 'md',
            render: (field) => (
                <Switch
                    checked={Boolean(resolveApplicationGate(safeConfig, field.id).required)}
                    tone="success"
                    label={`Require ${field.label}`}
                    onChange={() => toggleField(field.id, 'required')}
                />
            ),
        },
        {
            key: 'hidden',
            header: 'Hidden',
            width: 'md',
            render: (field) => (
                <Switch
                    checked={Boolean(resolveApplicationGate(safeConfig, field.id).hidden)}
                    tone="danger"
                    label={`Hide ${field.label}`}
                    onChange={() => toggleField(field.id, 'hidden')}
                />
            ),
        },
    ];

    return (
        <Card padding="none" className="mb-8 overflow-hidden" aria-labelledby={titleId}>
            <div className="flex items-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Icon icon={Settings} size="lg" className="text-ds-content-muted" />
                <h4 id={titleId} className="text-ds-body font-bold text-ds-content">
                    Standard DOT Questions Configuration
                </h4>
            </div>

            <DataTable
                embedded
                ariaLabel="Standard DOT questions"
                density="compact"
                minWidth="none"
                mobilePresentation="cards"
                data={STANDARD_FIELDS}
                columns={columns}
                getRowId={(field) => field.id}
            />

            <div className="border-t border-ds-border-subtle p-ds-4">
                <FieldMessage tone="help">
                    <strong>Note:</strong> Hiding DOT required fields (like SSN or Employment History) may make your application non-compliant.
                </FieldMessage>
            </div>
        </Card>
    );
}
