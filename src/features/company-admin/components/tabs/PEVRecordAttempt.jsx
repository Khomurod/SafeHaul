import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, Phone } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button, FormField, Input, Select, Textarea } from '@/design-system/components';
import { getFieldValue } from '@shared/utils/helpers';
import { serverMessageOf } from '@shared/utils/callableErrors';

/**
 * "Record attempt": a recruiter records a phone call, a fax or a note against
 * an employer's verification request.
 *
 * The team cannot write the request itself, so `recordVerificationAttempt`
 * adds the entry to the request's attempt log and its copy to the employer row;
 * the row it returns replaces this row on screen. The dialog is the approved
 * `ConfirmDialog` (focus, Escape, the in-flight guard and the announced
 * failure) with design-system form fields.
 */

const ATTEMPT_KINDS = [
    { value: 'call', label: 'Phone call' },
    { value: 'fax', label: 'Fax' },
    { value: 'note', label: 'Note' },
];

const NOTE_CHARS = 300;

/** Today in the recruiter's own calendar, as the date field writes it. */
function localToday() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Refusals whose sentence the server writes for the person. */
const EXPLAINED = new Set(['invalid-argument', 'not-found', 'failed-precondition', 'resource-exhausted']);

/** The server's sentence for a refusal it explains (never a bare code), else a general one. */
function failureText(error) {
    const code = String(error?.code || '').replace(/^functions\//, '');
    return (EXPLAINED.has(code) && serverMessageOf(error)) || 'The attempt could not be recorded. Please try again.';
}

function RecordAttemptDialog({ record, emp, index, onRecorded, onClose }) {
    const [kind, setKind] = useState('call');
    const [date, setDate] = useState(localToday);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const employerName = getFieldValue(emp.companyName || emp.name);
    const noteMissing = kind === 'note' && !note.trim();

    const save = async () => {
        if (!date || noteMissing) {
            setError(!date ? 'Give the day of the attempt.' : 'Write the note.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const recordAttempt = httpsCallable(functions, 'recordVerificationAttempt');
            const result = await recordAttempt({
                ...record,
                employerIndex: index,
                employerId: emp.employerId || null,
                employerName: emp.companyName || emp.name || '',
                kind,
                date,
                note: note.trim(),
            });
            onRecorded(result.data?.verification || null);
        } catch (failure) {
            console.error('Record attempt error:', failure);
            setError(failureText(failure));
            setSaving(false);
        }
    };

    return (
        <ConfirmDialog
            title={`Record an attempt — ${employerName}`}
            description="A call, fax or note joins this employer's verification record."
            tone="info"
            confirmLabel="Record attempt"
            loading={saving}
            error={error}
            onConfirm={save}
            onCancel={onClose}
        >
            <div className="space-y-ds-3">
                <FormField label="Attempt" required>
                    <Select value={kind} onChange={(event) => setKind(event.target.value)}>
                        {ATTEMPT_KINDS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </Select>
                </FormField>
                <FormField label="Date" required>
                    <Input type="date" value={date} max={localToday()} onChange={(event) => setDate(event.target.value)} />
                </FormField>
                <FormField
                    label="Note"
                    required={kind === 'note'}
                    description={`Who you spoke to, what was sent. At most ${NOTE_CHARS} characters.`}
                >
                    <Textarea rows={3} maxLength={NOTE_CHARS} value={note} onChange={(event) => setNote(event.target.value)} />
                </FormField>
            </div>
        </ConfirmDialog>
    );
}

/** The card's "Record attempt" action and its dialog. */
export function PEVRecordAttempt({ record, emp, index, onVerification, showSuccess }) {
    const [open, setOpen] = useState(false);
    const employerName = getFieldValue(emp.companyName || emp.name);

    const recorded = (verification) => {
        if (verification) onVerification(index, verification);
        setOpen(false);
        showSuccess('Attempt recorded.');
    };

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                aria-label={`Record attempt for ${employerName}`}
                onClick={() => setOpen(true)}
            >
                <Icon icon={Phone} size="sm" /> Record attempt
            </Button>
            {open && (
                <RecordAttemptDialog
                    record={record}
                    emp={emp}
                    index={index}
                    onRecorded={recorded}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
