import React from 'react';
import { AlertCircle } from '@design-system/icons';
import { DataTable, Notice, Switch } from '@/design-system/components';
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
 * its two switches in their own columns; on a phone each field is a card, its
 * name first and the two switches under it, each before its word, the second
 * at the middle of the card. The table is the body of the section's card
 * (`FormSection padding="none"`, which the caller draws), and the compliance
 * note is that card's last row.
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

/*
 * A switch on a phone card: the switch, then its word. The first of the two
 * takes half the card (less the card's inset and half the gap between them),
 * so the second starts at the card's middle on every card.
 * The word is for the eye only: the column's header and the switch's own name
 * ("Require Date of Birth") already say it to a screen reader. From 768px the
 * table's header says it and the word is not drawn.
 */
const PHONE_TOGGLE = 'inline-flex items-center gap-ds-2';
const PHONE_TOGGLE_FIRST = 'max-md:min-w-[calc(50cqw-var(--ds-space-4)-var(--ds-space-3)/2)]';

function PhoneToggle({ word, first = false, children }) {
    return (
        <span className={first ? `${PHONE_TOGGLE} ${PHONE_TOGGLE_FIRST}` : PHONE_TOGGLE}>
            {children}
            <span aria-hidden="true" className="md:hidden">{word}</span>
        </span>
    );
}

export function StandardQuestionsConfig({ config, onChange }) {
    const safeConfig = config || {};

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

    // The name takes half the row and each switch a quarter of it, so a switch
    // stands near its field rather than across the card from it: a fixed
    // table shares out its width in proportion to the columns' (176 : 88 : 88).
    const columns = [
        {
            key: 'field',
            header: 'Field Name',
            rowHeader: true,
            width: 'lg',
            render: (field) => <span className="font-semibold text-ds-content">{field.label}</span>,
        },
        {
            key: 'required',
            header: 'Required',
            width: 'xs',
            mobileRole: 'meta',
            render: (field) => (
                <PhoneToggle word="Required" first>
                    <Switch
                        checked={Boolean(resolveApplicationGate(safeConfig, field.id).required)}
                        tone="success"
                        label={`Require ${field.label}`}
                        onChange={() => toggleField(field.id, 'required')}
                    />
                </PhoneToggle>
            ),
        },
        {
            key: 'hidden',
            header: 'Hidden',
            width: 'xs',
            mobileRole: 'meta',
            render: (field) => (
                <PhoneToggle word="Hidden">
                    <Switch
                        checked={Boolean(resolveApplicationGate(safeConfig, field.id).hidden)}
                        tone="danger"
                        label={`Hide ${field.label}`}
                        onChange={() => toggleField(field.id, 'hidden')}
                    />
                </PhoneToggle>
            ),
        },
    ];

    // The card's rounded corners clip the table's square header (and, on a
    // phone, its first card). The clip is also the size container the phone
    // cards' two columns are measured against.
    return (
        <div className="grid min-w-0 overflow-clip rounded-ds-card [container-type:inline-size]">
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

            <Notice tone="warning" frame="flush" icon={AlertCircle}>
                <strong>Note:</strong> Hiding DOT required fields (like SSN or Employment History) may make your application{' '}
                <span className="whitespace-nowrap">non-compliant.</span>
            </Notice>
        </div>
    );
}
