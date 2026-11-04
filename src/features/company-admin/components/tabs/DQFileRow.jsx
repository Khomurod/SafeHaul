import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, AlertCircle, Calendar, CheckCircle, Clock, Download, FileText, Trash2 } from '@design-system/icons';
import {
    Badge, Button, FormField, IconButton, IconButtonLink, Input, Notice,
} from '@/design-system/components';
import { opensFromSignedLink } from '@features/applications/services/openApplicationFile';
import { OriginalApplicationConsents } from './OriginalApplicationConsents';
import { takesExpiration } from '../../utils/dqFileTypes';
import { calendarDay, describeExpiry, expiryStatus } from '../../utils/dqExpiry';

/**
 * One entry of the DQ tab's list (`DQFileTab`): its type, file name and
 * valid-until date, and its controls — open or download, set the date, delete.
 * Moved out of the tab with its markup unchanged; the tab keeps every read,
 * write and log, and passes them in.
 *
 * The date is judged by the UTC day (`dqExpiry.js`): expired from the day after
 * it, expiring inside thirty days. A CDL, medical card, MVR or TWIC record can
 * have it set or cleared here (`takesExpiration`); it is the DQ record's own
 * date, never the application's answer.
 */

/** Feature-owned expiry state → Badge tone and icon; the words always go with them. */
const EXPIRY_PRESENTATION = {
    expired: { tone: 'danger', icon: AlertCircle },
    expiring: { tone: 'warning', icon: Clock },
    valid: { tone: 'success', icon: CheckCircle },
};

function ExpiryBadge({ value }) {
    if (!value) return null;
    const expiry = expiryStatus(value);
    if (!expiry) return <Badge tone="neutral">Date on file: {String(value)}</Badge>;
    const { tone, icon } = EXPIRY_PRESENTATION[expiry.state];
    return <Badge tone={tone} icon={icon}>{describeExpiry(expiry)}</Badge>;
}

/** Sets or clears one record's valid-until date; it stays open with the reason when the save fails. */
function ExpiryEditor({ file, onSave, onClose }) {
    const fieldId = useId();
    const inputRef = useRef(null);
    const [value, setValue] = useState(calendarDay(file.expirationDate) || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { inputRef.current?.focus(); }, []);

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            await onSave(file, value);
            onClose();
        } catch (err) {
            setError(`Could not save the date: ${err.message}`);
            setSaving(false);
        }
    };

    // The hint sits under the whole line rather than under the field, so the
    // buttons line up with the date box.
    const hintId = `${fieldId}-hint`;
    return (
        <div className="flex w-full flex-wrap items-end gap-ds-3 border-t border-ds-border-subtle pt-ds-3">
            <FormField id={fieldId} label="Valid until">
                <Input
                    ref={inputRef}
                    type="date"
                    size="sm"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={saving}
                    aria-describedby={hintId}
                />
            </FormField>
            <div className="flex gap-ds-2">
                <Button variant="primary" size="sm" onClick={save} loading={saving}>Save date</Button>
                <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            </div>
            <p id={hintId} className="w-full text-ds-xs text-ds-content-secondary">
                The date printed on the document. Leave it empty to clear the date.
            </p>
            {/* Mounted with the editor, before any message, so it announces. */}
            <div role="alert" className="w-full">
                {error && <Notice tone="danger" size="sm" announce="off">{error}</Notice>}
            </div>
        </div>
    );
}

export function DQFileRow({
    file, companyId, applicationId, onAuditedDownload, onOpenDriverUpload, onDelete, onSaveExpiration,
}) {
    const [editingDate, setEditingDate] = useState(false);
    const editRef = useRef(null);
    // The editor held the focus; once it closes, the control that opened it takes it back.
    const returnFocus = useRef(false);
    useEffect(() => {
        if (editingDate || !returnFocus.current) return;
        returnFocus.current = false;
        editRef.current?.focus();
    }, [editingDate]);
    const closeEditor = () => {
        returnFocus.current = true;
        setEditingDate(false);
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-ds-3 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
            <div className="flex min-w-0 flex-1 items-center gap-ds-3">
                <Icon icon={FileText} size="xl" className="shrink-0 text-ds-content-link" />
                <div className="min-w-0">
                    <p className="truncate text-ds-sm font-medium text-ds-content">{file.fileType}</p>
                    <div className="flex flex-wrap items-center gap-ds-2">
                        <p className="truncate text-ds-xs text-ds-content-secondary">{file.fileName}</p>
                        <ExpiryBadge value={file.expirationDate} />
                    </div>
                </div>
            </div>
            <div className="flex shrink-0 gap-ds-2">
                {file.requiresAuditedAccess ? (
                    /*
                      The preserved application original. It has no durable link
                      on purpose: it may carry the applicant's full Social
                      Security Number, so it is fetched through a callable that
                      authorizes the caller and writes an audit record first. An
                      `<a href>` here would be an unaudited way in.
                    */
                    <IconButton
                        label={`Download ${file.fileType}: ${file.fileName}`}
                        variant="ghost"
                        onClick={() => onAuditedDownload(file)}
                    >
                        <Icon icon={Download} size="lg" className="text-ds-status-info-fg" />
                    </IconButton>
                ) : opensFromSignedLink(file.storagePath) ? (
                    <IconButton
                        label={`Download ${file.fileType}: ${file.fileName} (opens in a new tab)`}
                        variant="ghost"
                        onClick={() => onOpenDriverUpload(file)}
                    >
                        <Icon icon={Download} size="lg" className="text-ds-status-info-fg" />
                    </IconButton>
                ) : (
                    /*
                      Feature-owned exception: a real navigation to a signed Storage
                      URL, so it is a navigation and must be a link. It is
                      `IconButtonLink` at the 36px step, so it matches every
                      other row action rather than being a bespoke tinted square,
                      and `external` announces the tab it opens.
                    */
                    <IconButtonLink
                        href={file.url}
                        external
                        size="sm"
                        variant="secondary"
                        label={`Download ${file.fileType}: ${file.fileName}`}
                    >
                        <Icon icon={Download} />
                    </IconButtonLink>
                )}
                {takesExpiration(file) && (
                    <IconButton
                        ref={editRef}
                        label={`Set the valid-until date of ${file.fileType}: ${file.fileName}`}
                        variant="ghost"
                        aria-expanded={editingDate}
                        onClick={() => setEditingDate((open) => !open)}
                    >
                        <Icon icon={Calendar} size="lg" className="text-ds-content-secondary" />
                    </IconButton>
                )}
                {/*
                  The preserved original carries no delete control. It is the
                  evidentiary record of what the applicant submitted, kept for
                  the three years 49 CFR 391.51 requires; deleting the
                  application removes it, and nothing else may.
                */}
                {!file.requiresAuditedAccess && (
                    <IconButton
                        label={`Delete ${file.fileType}: ${file.fileName}`}
                        variant="ghost"
                        onClick={() => onDelete(file)}
                    >
                        <Icon icon={Trash2} size="lg" className="text-ds-status-danger-fg" />
                    </IconButton>
                )}
            </div>
            {editingDate && <ExpiryEditor file={file} onSave={onSaveExpiration} onClose={closeEditor} />}
            {/* The original's consents: a full-width second line, hence `flex-wrap` above and `flex-1` on the name. */}
            <OriginalApplicationConsents companyId={companyId} applicationId={applicationId} file={file} />
        </div>
    );
}

export default DQFileRow;
