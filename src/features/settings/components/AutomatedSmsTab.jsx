import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import {
    Button,
    FieldMessage,
    FormField,
    FormSection,
    Textarea,
} from '@/design-system/components';

export function AutomatedSmsTab({ companyId }) {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [templateContactAttempt1, setTemplateContactAttempt1] = useState('');
    const [templateContactAttempt2, setTemplateContactAttempt2] = useState('');
    const [templateContactAttempt3, setTemplateContactAttempt3] = useState('');

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
                    setTemplateContactAttempt1(d.templateContactAttempt1 || '');
                    setTemplateContactAttempt2(d.templateContactAttempt2 || '');
                    setTemplateContactAttempt3(d.templateContactAttempt3 || '');
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
        setSaving(true);
        try {
            await setDoc(
                doc(db, 'companies', companyId, 'settings', 'automated_sms'),
                {
                    templateContactAttempt1,
                    templateContactAttempt2,
                    templateContactAttempt3,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
            showSuccess('Automated SMS templates saved.');
        } catch (e) {
            console.error(e);
            showError('Failed to save templates.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-4xl animate-in fade-in" data-testid="automated-sms-settings">
                <p
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-24 text-ds-content-muted"
                >
                    <Loader2 className="animate-spin" size={22} aria-hidden="true" />
                    Loading…
                </p>
            </div>
        );
    }

    const templates = [
        {
            id: 'automated-sms-contact-attempt-1',
            label: 'Contact Attempt 1',
            value: templateContactAttempt1,
            onChange: setTemplateContactAttempt1,
        },
        {
            id: 'automated-sms-contact-attempt-2',
            label: 'Contact Attempt 2',
            value: templateContactAttempt2,
            onChange: setTemplateContactAttempt2,
        },
        {
            id: 'automated-sms-contact-attempt-3',
            label: 'Contact Attempt 3',
            value: templateContactAttempt3,
            onChange: setTemplateContactAttempt3,
        },
    ];

    return (
        <div className="max-w-4xl animate-in fade-in pb-12" data-testid="automated-sms-settings">
            <FormSection
                title="Automated SMS"
                description={(
                    <>
                        Messages sent when a lead or application moves into each
                        contact-attempt stage. Use{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-content">
                            {`{driver name}`}
                        </code>{' '}
                        and{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-content">
                            {`{user name}`}
                        </code>{' '}
                        for the applicant and recruiter names.
                    </>
                )}
            >
                <FieldMessage tone="help">
                    Requires an active SMS integration and a valid phone on the record.
                    Duplicate sends are prevented when the status does not change.
                </FieldMessage>

                {templates.map((field) => (
                    <FormField key={field.id} id={field.id} label={field.label}>
                        <Textarea
                            value={field.value}
                            onChange={(event) => field.onChange(event.target.value)}
                            placeholder={`Hi {driver name}, this is {user name} from SafeHaul…`}
                        />
                    </FormField>
                ))}

                <div>
                    <Button
                        type="button"
                        variant="primary"
                        size="lg"
                        loading={saving}
                        onClick={handleSave}
                    >
                        {!saving && <Save size={18} aria-hidden="true" />}
                        Save templates
                    </Button>
                </div>
            </FormSection>
        </div>
    );
}
