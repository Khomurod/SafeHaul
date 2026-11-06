import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Icon, Loader2 } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import {
    FieldMessage,
    FormField,
    FormSection,
    Textarea,
} from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { saveBarSummary } from '../utils/saveBarSummary';

/** The three messages, each saved under its own field of `settings/automated_sms`. */
const TEMPLATES = [
    { field: 'templateContactAttempt1', id: 'automated-sms-contact-attempt-1', label: 'Contact Attempt 1' },
    { field: 'templateContactAttempt2', id: 'automated-sms-contact-attempt-2', label: 'Contact Attempt 2' },
    { field: 'templateContactAttempt3', id: 'automated-sms-contact-attempt-3', label: 'Contact Attempt 3' },
];

const NONE = { templateContactAttempt1: '', templateContactAttempt2: '', templateContactAttempt3: '' };

/**
 * Settings → Automated texts: the message sent when a lead or application moves
 * into each contact-attempt stage. Edits stay on the page until the save bar's
 * Save, which writes all three to `companies/{id}/settings/automated_sms`
 * (merged, with `updatedAt`); the company shell's leave guard watches them.
 */
export function AutomatedSmsTab({ companyId }) {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(NONE);
    const [form, setForm] = useState(NONE);
    const [saveError, setSaveError] = useState(null);

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
                if (!cancelled) showError('Could not load automated SMS templates.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast stable; avoid reload loops
    }, [companyId]);

    const handleSave = async () => {
        if (!companyId) return;
        const sent = form;
        setSaving(true);
        setSaveError(null);
        try {
            await setDoc(
                doc(db, 'companies', companyId, 'settings', 'automated_sms'),
                {
                    templateContactAttempt1: sent.templateContactAttempt1,
                    templateContactAttempt2: sent.templateContactAttempt2,
                    templateContactAttempt3: sent.templateContactAttempt3,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
            // An edit made while the save was on its way stays, still unsaved.
            setSaved(sent);
            showSuccess('Automated SMS templates saved.');
        } catch (e) {
            console.error('[AutomatedSmsTab] Could not save the templates:', e);
            setSaveError('Could not save the templates. Try again.');
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
            <FormSection
                title="Contact-attempt messages"
                description={(
                    <>
                        Use{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-content">
                            {`{driver name}`}
                        </code>{' '}
                        and{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-content">
                            {`{user name}`}
                        </code>{' '}
                        for the applicant and recruiter names, and{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-content">
                            {`{application link}`}
                        </code>{' '}
                        for your application page with the recruiter&rsquo;s link.
                    </>
                )}
            >
                <FieldMessage tone="help">
                    Requires an active SMS integration and a valid phone on the record.
                    Duplicate sends are prevented when the status does not change.
                </FieldMessage>

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
