import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Icon, Loader2, RefreshCw } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import {
    Button,
    FormField,
    FormSection,
    Notice,
    Textarea,
} from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { saveBarSummary } from '../utils/saveBarSummary';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/** The three messages, each saved under its own field of `settings/automated_sms`. */
const TEMPLATES = [
    { field: 'templateContactAttempt1', id: 'automated-sms-contact-attempt-1', label: 'Contact Attempt 1' },
    { field: 'templateContactAttempt2', id: 'automated-sms-contact-attempt-2', label: 'Contact Attempt 2' },
    { field: 'templateContactAttempt3', id: 'automated-sms-contact-attempt-3', label: 'Contact Attempt 3' },
];

/** What a message may say in braces, and what each becomes when it is sent. */
const PLACEHOLDERS = [
    { token: '{driver name}', meaning: 'The applicant’s name' },
    { token: '{user name}', meaning: 'The recruiter’s name' },
    { token: '{application link}', meaning: 'Your application page with the recruiter’s personal link' },
];

const NONE = { templateContactAttempt1: '', templateContactAttempt2: '', templateContactAttempt3: '' };

/**
 * Settings → Automated texts: the message sent when a lead or application moves
 * into each contact-attempt stage. Edits stay on the page until the save bar's
 * Save, which writes the changed ones to `companies/{id}/settings/automated_sms`
 * (merged, with `updatedAt`); the company shell's leave guard watches them.
 * When the templates could not be read, the page says so above the fields and
 * offers Retry: a blank field would otherwise read as "no text". A save then
 * writes only the templates typed in, so none it could not show is erased.
 */
export function AutomatedSmsTab({ companyId }) {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(NONE);
    const [form, setForm] = useState(NONE);
    const [saveError, setSaveError] = useState(null);
    const [loadFailed, setLoadFailed] = useState(false);
    // Retry reads the templates again.
    const [attempt, setAttempt] = useState(0);

    const changed = TEMPLATES.filter(({ field }) => form[field] !== saved[field]);
    const dirty = changed.length > 0;
    useUnsavedChanges(dirty);
    // A failure is about changes that are no longer there once the page is clean.
    if (!dirty && saveError) setSaveError(null);

    useEffect(() => {
        if (!companyId) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setLoadFailed(false);
            // Another company's templates are not this one's, saved or typed.
            setSaved(NONE);
            setForm(NONE);
            try {
                const ref = doc(db, 'companies', companyId, 'settings', 'automated_sms');
                const snap = await getDoc(ref);
                if (!cancelled && snap.exists()) {
                    const d = snap.data();
                    const loaded = {
                        templateContactAttempt1: d.templateContactAttempt1 || '',
                        templateContactAttempt2: d.templateContactAttempt2 || '',
                        templateContactAttempt3: d.templateContactAttempt3 || '',
                    };
                    setSaved(loaded);
                    setForm(loaded);
                }
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setLoadFailed(true);
                    showError('Could not load automated SMS templates.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast stable; avoid reload loops
    }, [companyId, attempt]);

    const handleSave = async () => {
        if (!companyId) return;
        const sent = form;
        // Only what the bar names is written; the others stay as stored.
        const fields = Object.fromEntries(changed.map(({ field }) => [field, sent[field]]));
        setSaving(true);
        setSaveError(null);
        try {
            await setDoc(
                doc(db, 'companies', companyId, 'settings', 'automated_sms'),
                { ...fields, updatedAt: serverTimestamp() },
                { merge: true }
            );
            // An edit made while the save was on its way stays, still unsaved.
            setSaved((previous) => ({ ...previous, ...fields }));
            showSuccess('Automated SMS templates saved.');
        } catch (e) {
            console.error('[AutomatedSmsTab] Could not save the templates:', e);
            setSaveError(plainErrorMessage(e, 'The templates could not be saved.'));
        } finally {
            setSaving(false);
        }
    };

    const discard = () => {
        setForm(saved);
        setSaveError(null);
    };

    if (loading) {
        return (
            <div className="space-y-ds-6" data-testid="automated-sms-settings">
                <PageHeader title="Automated texts" description="Messages sent when a lead or application moves into each contact-attempt stage." />
                <p
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-24 text-ds-content-muted"
                >
                    {/* 22 was never a decision — two pixels off `xl`, and the migrated
                        loading lines that keep a size all use `xl`. */}
                    <Icon icon={Loader2} size="xl" className="animate-spin" />
                    Loading…
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-ds-6" data-testid="automated-sms-settings">
            <PageHeader title="Automated texts" description="Messages sent when a lead or application moves into each contact-attempt stage." />
            {loadFailed && (
                <Notice
                    tone="danger"
                    announce="assertive"
                    title="The saved templates could not be loaded."
                    actions={(
                        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                            <Icon icon={RefreshCw} />
                            Retry
                        </Button>
                    )}
                >
                    The fields below may not show what drivers are sent. Check your internet connection,
                    then press Retry. Saving now replaces only the templates you type in.
                </Notice>
            )}
            <FormSection
                layout="aside"
                title="Contact-attempt messages"
                description="Use these in a message:"
                actions={(
                    <>
                        <ul className="flex w-full flex-col gap-ds-3">
                            {PLACEHOLDERS.map(({ token, meaning }) => (
                                // Each word under its own chip beside the card; on one line with it
                                // where the section is too narrow for a side column (under 760px).
                                <li
                                    key={token}
                                    className="flex flex-col items-start gap-ds-1 text-ds-body text-ds-content-secondary [text-wrap:pretty] [@container_ds-form-section_(max-width:759px)]:flex-row [@container_ds-form-section_(max-width:759px)]:flex-wrap [@container_ds-form-section_(max-width:759px)]:items-baseline [@container_ds-form-section_(max-width:759px)]:gap-x-ds-2"
                                >
                                    <code className="whitespace-nowrap rounded-ds-sm border border-ds-border-subtle bg-ds-surface-subtle px-ds-1 text-ds-xs text-ds-content">
                                        {token}
                                    </code>
                                    <span>{meaning}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-ds-2 w-full text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                            Requires an active SMS integration and a valid phone on the record.
                            Duplicate sends are prevented when the status does not change.
                        </p>
                    </>
                )}
            >
                {TEMPLATES.map(({ field, id, label }) => (
                    <FormField key={id} id={id} label={label}>
                        <Textarea
                            value={form[field]}
                            onChange={(event) => {
                                const { value } = event.target;
                                setForm((prev) => ({ ...prev, [field]: value }));
                            }}
                            placeholder={`Hi {driver name}, this is {user name} from SafeHaul…`}
                        />
                    </FormField>
                ))}
            </FormSection>
            {dirty && (
                <SaveBar
                    summary={saveBarSummary(changed.map(({ label }) => label))}
                    saving={saving}
                    error={saveError}
                    onSave={handleSave}
                    onDiscard={discard}
                />
            )}
        </div>
    );
}
