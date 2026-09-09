import React, { useMemo, useState } from 'react';
import { Icon, Plus, Trash2 } from '@design-system/icons';
import {
    Badge, Button, Card, ChoiceGroup, FormField, Input, Notice, Radio, Select,
} from '@/design-system/components';
import { ConfirmDialog } from '@design-system/patterns';
import { EMPLOYMENT_SECTION } from '@/config/applicationSchema';
import { useUtils } from '@shared/hooks/useUtils';

/**
 * Previous employers, added, edited and removed by the company.
 *
 * ## The gap this fills
 *
 * `SchemaSection` renders an `array` section — employment history, violations,
 * accidents, previous addresses — as read-only `FieldDisplay` rows **whatever
 * `isEditing` says**. So "Edit application" let a company admin change every
 * scalar field on a submitted application and none of the employment history,
 * which is the section a recruiter most often has to correct: 49 CFR 391.21(b)(10)
 * wants three years accounted for, and a driver who left an employer out or
 * mistyped a date is the ordinary case.
 *
 * That renderer is shared with the driver's own wizard, so it is not the place to
 * put an editor. This is the editor; `ApplicationTab` swaps it in for the
 * employment section while editing and leaves every other section exactly as it
 * was.
 *
 * ## The fields come from the schema, not from here
 *
 * `EMPLOYMENT_SECTION.itemFields` is the same table the wizard collects and the
 * dossier displays. Duplicating it would be two answers to "what is an employer",
 * and the PDF, the verification request and the coverage calculation all read the
 * first one.
 *
 * ## What this component must never do
 *
 * **Touch a row's verification.** A Previous Employment Verification mirror lives
 * on the employer row — status, respondent, result document, history — and the
 * server strips whatever a client sends and re-attaches it by identity
 * (`shared/employerEdits.js`). This editor carries the rest of each row through
 * untouched, `employerId` included, so identity survives a rename; it shows the
 * verification state so a recruiter can see what a removal costs; and it never
 * offers to edit it.
 *
 * Removing a row that has verification activity is allowed — a carrier
 * legitimately removes an employer added in error, and a hard refusal would leave
 * them with no way to fix it — but it is confirmed explicitly and named in the
 * activity log, and the PEV record itself is never deleted.
 *
 * ## Nothing here writes anything
 *
 * The editor hands its array to `ApplicationTab`, which proposes it through
 * `proposeApplicationChanges`. On a submitted application that becomes a
 * `pending_changes` entry the driver approves, rejects or corrects — the canonical
 * record does not move until they do, and the frozen submission snapshot never
 * moves at all.
 */

/**
 * Legacy field names the dossier renderer still falls back to.
 *
 * A row written before the rename holds `name` / `street` / `reason`. Those are
 * READ for display and deliberately not rewritten: seeding the canonical key on
 * load would show the driver a change nobody made. Typing into a field sets the
 * canonical key, and the renderer prefers it, so the row becomes consistent
 * through use rather than through a migration.
 */
const LEGACY_KEYS = Object.freeze({
    companyName: 'name',
    address: 'street',
    reasonForLeaving: 'reason',
});

/** A generous ceiling, matching `shared/employerIdentity.js`. */
export const MAX_EMPLOYER_ROWS = 40;

function valueOf(row, key) {
    const direct = row?.[key];
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    const legacy = LEGACY_KEYS[key];
    return legacy ? (row?.[legacy] ?? '') : '';
}

/** The verification state of a row, in the words the PEV tab uses. */
export function verificationStateOf(row) {
    const status = row?.verification?.status;
    return typeof status === 'string' && status ? status : 'Not Started';
}

function verificationTone(state) {
    if (state === 'Completed') return 'success';
    if (state === 'Not Started') return 'neutral';
    // Sent, Requested, Reminded, No Response — in flight or unresolved.
    return 'warning';
}

/** What this row is called, for a confirmation and for an accessible name. */
function labelFor(row, index) {
    return valueOf(row, 'companyName') || `employer ${index + 1}`;
}

function EmployerFieldControl({ field, row, rowKey, onChange, states }) {
    const value = valueOf(row, field.key);
    const id = `employer-${rowKey}-${field.key}`;

    if (field.type === 'radio') {
        return (
            <ChoiceGroup legend={field.label} orientation="horizontal">
                {(field.options || []).map((option) => {
                    const optionValue = typeof option === 'object' ? option.value : option;
                    const optionLabel = typeof option === 'object' ? option.label : String(option);
                    return (
                        <Radio
                            key={optionValue}
                            name={id}
                            id={`${id}-${optionValue}`}
                            label={optionLabel}
                            value={optionValue}
                            checked={value === optionValue}
                            onChange={(event) => onChange(field.key, event.target.value)}
                            requiredMark={false}
                        />
                    );
                })}
            </ChoiceGroup>
        );
    }

    if (field.type === 'select') {
        return (
            <FormField id={id} label={field.label} required={field.required}>
                <Select value={value} onChange={(event) => onChange(field.key, event.target.value)}>
                    <option value="">Select…</option>
                    {states.map((state) => (
                        <option key={state} value={state}>{state}</option>
                    ))}
                </Select>
            </FormField>
        );
    }

    return (
        <FormField id={id} label={field.label} required={field.required}>
            <Input
                type={field.type === 'month' ? 'month' : (field.type === 'tel' ? 'tel' : 'text')}
                value={value}
                onChange={(event) => onChange(field.key, event.target.value)}
            />
        </FormField>
    );
}

export function PreviousEmployersEditor({ employers, onChange }) {
    const { states } = useUtils();
    const rows = useMemo(() => (Array.isArray(employers) ? employers : []), [employers]);
    /** The row a removal is waiting on, when it needs confirming. */
    const [pendingRemoval, setPendingRemoval] = useState(null);

    // Every update produces new objects. `ApplicationTab` copies `appData`
    // shallowly into its edit buffer, so the array it hands over is the ONE on the
    // record — mutating a row in place would corrupt the original and make the
    // diff see no change at all.
    const setRow = (index, key, value) => {
        onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    };

    const addRow = () => {
        if (rows.length >= MAX_EMPLOYER_ROWS) return;
        // No `employerId`: the server mints one, so the identity a verification is
        // filed under is never a value a browser chose.
        onChange([...rows, {}]);
    };

    const removeRow = (index) => {
        onChange(rows.filter((_, i) => i !== index));
        setPendingRemoval(null);
    };

    const requestRemoval = (index) => {
        // Confirmed only when there is something to lose from the row. A row the
        // recruiter just added, or one nobody has contacted, goes without ceremony.
        if (verificationStateOf(rows[index]) === 'Not Started') {
            removeRow(index);
            return;
        }
        setPendingRemoval(index);
    };

    return (
        <div className="space-y-ds-4">
            <Notice tone="info" size="sm">
                Employment history changes go to the driver for approval, like every other
                edit here. Verification records stay with the employer they belong to and are
                never moved or deleted.
            </Notice>

            {rows.length === 0 && (
                <p role="status" className="text-ds-sm italic text-ds-content-muted">
                    No employers on this application yet.
                </p>
            )}

            <ul className="space-y-ds-4">
                {rows.map((row, index) => {
                    const state = verificationStateOf(row);
                    const name = labelFor(row, index);
                    // Stable across a rename so the fields keep their identity while
                    // somebody is typing in them; falls back to the position for a row
                    // the server has not yet given an id.
                    const rowKey = row.employerId || `new-${index}`;
                    return (
                        <li key={rowKey}>
                            <Card padding="md">
                                <div className="mb-ds-3 flex flex-wrap items-center justify-between gap-ds-2">
                                    <div className="flex flex-wrap items-center gap-ds-2">
                                        <h5 className="text-ds-body font-semibold text-ds-content">
                                            Employer {index + 1}
                                        </h5>
                                        {/* Status is never colour alone: the state is spelled out. */}
                                        <Badge tone={verificationTone(state)}>
                                            {`Verification: ${state}`}
                                        </Badge>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label={`Remove ${name} from the employment history`}
                                        onClick={() => requestRemoval(index)}
                                    >
                                        <Icon icon={Trash2} size="sm" /> Remove
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
                                    {EMPLOYMENT_SECTION.itemFields.map((field) => (
                                        <div key={field.key} className="col-span-1">
                                            <EmployerFieldControl
                                                field={field}
                                                row={row}
                                                rowKey={rowKey}
                                                states={states}
                                                onChange={(key, value) => setRow(index, key, value)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        </li>
                    );
                })}
            </ul>

            <Button variant="secondary" size="sm" onClick={addRow} disabled={rows.length >= MAX_EMPLOYER_ROWS}>
                <Icon icon={Plus} size="sm" /> Add an employer
            </Button>
            {rows.length >= MAX_EMPLOYER_ROWS && (
                <p role="status" className="text-ds-xs text-ds-content-muted">
                    {`An application can hold ${MAX_EMPLOYER_ROWS} employers.`}
                </p>
            )}

            {pendingRemoval !== null && (
                <ConfirmDialog
                    tone="warning"
                    title={`Remove ${labelFor(rows[pendingRemoval], pendingRemoval)}?`}
                    description={
                        `This employer has a verification on file (${verificationStateOf(rows[pendingRemoval])}). `
                        + 'Removing it takes the employer off the employment history. The verification '
                        + 'response, its signature and its document stay on file and are not deleted, and '
                        + 'they are never transferred to another employer.'
                    }
                    confirmLabel="Remove employer"
                    onConfirm={() => removeRow(pendingRemoval)}
                    onCancel={() => setPendingRemoval(null)}
                />
            )}
        </div>
    );
}

export default PreviousEmployersEditor;
