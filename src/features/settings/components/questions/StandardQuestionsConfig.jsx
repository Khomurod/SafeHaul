import React, { useId } from 'react';
import { Settings } from 'lucide-react';
import { Card, FieldMessage } from '@/design-system/components';
import { ToggleSwitch } from './ToggleSwitch';
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
 */
export const STANDARD_FIELDS = [
    { id: 'ssn', label: 'Social Security Number' },
    { id: 'dob', label: 'Date of Birth' },
    { id: 'addressHistory', label: '3 Years Address History' },
    { id: 'employmentHistory', label: 'Employment History (3-10 Yrs)' },
    { id: 'cdlUpload', label: 'CDL Document Upload' },
    { id: 'medCardUpload', label: 'Medical Card Upload' },
    { id: 'mvrConsent', label: 'MVR Consent Form' },
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

    return (
        <Card padding="none" className="mb-8 overflow-hidden" aria-labelledby={titleId}>
            <div className="flex items-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Settings size={18} className="text-ds-content-muted" aria-hidden="true" />
                <h4 id={titleId} className="text-ds-body font-bold text-ds-content">
                    Standard DOT Questions Configuration
                </h4>
            </div>

            {/* Column headers (desktop); mobile rows carry inline captions instead. */}
            <div className="hidden items-center gap-ds-4 border-b border-ds-border-subtle px-ds-4 py-ds-2 text-ds-xs font-bold uppercase text-ds-content-muted sm:flex">
                <span className="flex-1">Field Name</span>
                <span className="w-11 text-center">Required</span>
                <span className="w-11 text-center">Hidden</span>
            </div>

            <ul className="divide-y divide-ds-border-subtle">
                {STANDARD_FIELDS.map(field => {
                    const setting = resolveApplicationGate(safeConfig, field.id);

                    return (
                        <li
                            key={field.id}
                            className="flex flex-col gap-ds-3 px-ds-4 py-ds-3 sm:flex-row sm:items-center sm:gap-ds-4"
                        >
                            <span className="min-w-0 flex-1 font-medium text-ds-content">{field.label}</span>
                            <div className="flex items-center gap-ds-4 sm:gap-ds-4">
                                <span className="flex items-center gap-ds-2">
                                    <span className="text-ds-xs font-medium text-ds-content-muted sm:hidden">Required</span>
                                    <ToggleSwitch
                                        checked={Boolean(setting.required)}
                                        tone="success"
                                        label={`Require ${field.label}`}
                                        onChange={() => toggleField(field.id, 'required')}
                                    />
                                </span>
                                <span className="flex items-center gap-ds-2">
                                    <span className="text-ds-xs font-medium text-ds-content-muted sm:hidden">Hidden</span>
                                    <ToggleSwitch
                                        checked={Boolean(setting.hidden)}
                                        tone="danger"
                                        label={`Hide ${field.label}`}
                                        onChange={() => toggleField(field.id, 'hidden')}
                                    />
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>

            <div className="border-t border-ds-border-subtle p-ds-4">
                <FieldMessage tone="help">
                    <strong>Note:</strong> Hiding DOT required fields (like SSN or Employment History) may make your application non-compliant.
                </FieldMessage>
            </div>
        </Card>
    );
}
