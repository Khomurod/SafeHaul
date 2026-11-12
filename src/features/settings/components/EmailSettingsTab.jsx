import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, Loader2, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, HelpCircle, TestTube } from '@design-system/icons';
import {
    Badge,
    Button,
    FormField,
    FormSection,
    Input,
    Notice,
    SelectableCard,
    Textarea,
} from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { PevCopiesSection } from './PevCopiesSection';
import { SmtpSetupGuide } from './SmtpSetupGuide';
import { useSmtpSettingsDraft } from '../hooks/useSmtpSettingsDraft';
import { usePevCopiesDraft } from '../hooks/usePevCopiesDraft';
import { saveBarSummary } from '../utils/saveBarSummary';

/**
 * Settings → Email: the company's SMTP server (`useSmtpSettingsDraft`) and the
 * people verification requests copy (`usePevCopiesDraft`). Edits to either stay
 * on the page until the save bar's Save, which checks both and writes only the
 * parts changed; the company shell's leave guard watches them. Test Connection
 * checks what is typed and, when it connects, saves the server settings itself.
 */
export function EmailSettingsTab({ currentCompanyProfile }) {
    const smtp = useSmtpSettingsDraft(currentCompanyProfile?.id);
    const copies = usePevCopiesDraft(currentCompanyProfile);
    const [showGuide, setShowGuide] = useState(false);
    const guideRef = useRef(null);
    const guideOpenedHere = useRef(false);
    const guideId = useId().replace(/:/g, '');
    const guideTriggerId = `smtp-guide-${guideId}-trigger`;
    const guidePanelId = `smtp-guide-${guideId}-panel`;
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    // The guides open under the whole server section; where that is below the
    // screen (the section stacked on a laptop, a tablet or a phone), bring them
    // into view, at once for someone who asked for less motion.
    useEffect(() => {
        const panel = guideRef.current;
        if (!showGuide || !guideOpenedHere.current || typeof panel?.scrollIntoView !== 'function') return;
        guideOpenedHere.current = false;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        panel.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, [showGuide]);

    const toggleGuide = () => {
        guideOpenedHere.current = !showGuide;
        setShowGuide(!showGuide);
    };

    const dirty = smtp.dirty || copies.dirty;
    useUnsavedChanges(dirty);
    // A failure is about changes that are no longer there once the page is clean.
    if (!dirty && saveError) setSaveError(null);

    const handleSave = async () => {
        setSaveError(null);
        // Nothing is written while either part cannot be saved as it is.
        const problems = [smtp.dirty && smtp.validate(), copies.dirty && copies.validate()].filter(Boolean);
        if (problems.length > 0) {
            setSaveError(problems.join(' '));
            return;
        }
        setSaving(true);
        try {
            const failures = [];
            if (smtp.dirty) failures.push(await smtp.save());
            if (copies.dirty) failures.push(await copies.save());
            const failed = failures.filter(Boolean);
            if (failed.length > 0) setSaveError(failed.join(' '));
        } finally {
            setSaving(false);
        }
    };

    const discard = () => {
        smtp.discard();
        copies.discard();
        setSaveError(null);
    };

    // Show loading state while callable fetches settings
    if (smtp.loading) {
        return (
            <div className="space-y-ds-6" data-testid="email-settings">
                <PageHeader title="Email" description="Loading email settings…" />
                <p
                    role="status"
                    className="flex items-center justify-center gap-ds-2 py-24 text-ds-content-muted"
                >
                    <Icon icon={Loader2} size="3xl" className="animate-spin" />
                    Loading email settings…
                </p>
            </div>
        );
    }

    const { form, testResult } = smtp;
    const changed = [...smtp.changed, ...(copies.dirty ? ['Verification copies'] : [])];

    return (
        <div className="space-y-ds-6" data-testid="email-settings">
            <PageHeader
                title="Email"
                description="Configure your company's email server to send automated messages directly from your domain."
            />

            {/* SMTP Configuration: its state and the setup guide in the side column. */}
            <FormSection
                layout="aside"
                title="SMTP Server Configuration"
                actions={(
                    <>
                        <SelectableCard
                            as="div"
                            tone={smtp.isConnected ? 'success' : 'warning'}
                            role="group"
                            aria-label="Email connection status"
                        >
                            {smtp.isConnected ? (
                                <span className="flex flex-col items-start gap-ds-2 text-ds-xs text-ds-content-secondary [text-wrap:pretty]">
                                    <Badge tone="success" icon={CheckCircle}>Successfully Linked</Badge>
                                    <span>Currently linked and sending emails as: <strong className="text-ds-content [overflow-wrap:anywhere]">{smtp.savedUser}</strong></span>
                                    <span>
                                        This email account is automatically being used to safely send <strong>E-Docs</strong> and <strong>Previous Employment Verification (PEV)</strong> forms.
                                    </span>
                                </span>
                            ) : (
                                <span className="flex flex-col items-start gap-ds-2 text-ds-xs text-ds-content-secondary [text-wrap:pretty]">
                                    <Badge tone="warning" icon={AlertTriangle}>Not Connected / Unverified</Badge>
                                    <span>Please enter your credentials and run a Test Connection to verify your email setup.</span>
                                </span>
                            )}
                        </SelectableCard>
                        <SelectableCard
                            id={guideTriggerId}
                            aria-expanded={showGuide}
                            aria-controls={guidePanelId}
                            onSelect={toggleGuide}
                        >
                            <span className="flex w-full items-center gap-ds-3 text-left">
                                <Icon icon={HelpCircle} size="lg" className="shrink-0 text-ds-brand-primary" />
                                <span className="flex min-w-0 flex-1 flex-col gap-ds-1">
                                    <span className="text-ds-body font-semibold text-ds-content">How to Set Up SMTP</span>
                                    <span className="text-ds-xs text-ds-content-secondary [text-wrap:balance]">
                                        Step-by-step guides for Gmail, Outlook, and SendGrid
                                    </span>
                                </span>
                                <Icon icon={showGuide ? ChevronUp : ChevronDown} size="md" className="shrink-0 text-ds-content-muted" />
                            </span>
                        </SelectableCard>
                    </>
                )}
                footer={(
                    <Button
                        type="button"
                        variant="secondary"
                        loading={smtp.testing}
                        // Not while Save is writing: both write the same settings.
                        disabled={!form.smtpHost || !form.smtpUser || !smtp.password || saving}
                        onClick={smtp.test}
                    >
                        {!smtp.testing && <Icon icon={TestTube} size="lg" />}
                        Test Connection
                    </Button>
                )}
            >
                {/* Two fields a row where the card has 430px for them; one where it is narrower. */}
                <div className="[container-type:inline-size]">
                    <div className="grid grid-cols-1 gap-ds-4 [@container(min-width:430px)]:grid-cols-2 [@container(min-width:430px)]:gap-x-ds-5">
                        <FormField
                            id="email-smtp-host"
                            label="SMTP Host"
                            required
                            description="Example: smtp.gmail.com, smtp.office365.com"
                        >
                            <Input
                                type="text"
                                value={form.smtpHost || ''}
                                onChange={e => smtp.setField('smtpHost', e.target.value)}
                                placeholder="smtp.gmail.com"
                            />
                        </FormField>

                        <FormField
                            id="email-smtp-port"
                            label="SMTP Port"
                            required
                            description="Common: 587 (TLS), 465 (SSL), 25"
                        >
                            <Input
                                type="number"
                                min="1"
                                max="65535"
                                value={form.smtpPort || 587}
                                onChange={e => smtp.setField('smtpPort', parseInt(e.target.value))}
                                placeholder="587"
                            />
                        </FormField>

                        <FormField id="email-smtp-user" label="SMTP Username" required>
                            <Input
                                type="email"
                                value={form.smtpUser || ''}
                                onChange={e => smtp.setField('smtpUser', e.target.value)}
                                placeholder="your-email@company.com"
                            />
                        </FormField>

                        <FormField
                            id="email-smtp-password"
                            label="SMTP Password"
                            required={!smtp.hasPassword}
                            description={smtp.hasPassword
                                ? 'Password already saved. Enter a new password only if you want to change it.'
                                : 'For Gmail, use an App Password, not your regular password.'}
                        >
                            <Input
                                type="password"
                                value={smtp.password}
                                onChange={e => smtp.setPassword(e.target.value)}
                                placeholder={smtp.hasPassword ? 'Password is saved but hidden. Enter new to rotate.' : '••••••••••••'}
                            />
                        </FormField>
                    </div>
                </div>

                {testResult && (
                    /* Tone and announcement both follow the test's answer; the
                       Notice's own glyph says the state, so no badge inside. */
                    <Notice
                        tone={testResult.success ? 'success' : 'danger'}
                        announce={testResult.success ? 'polite' : 'assertive'}
                        title={testResult.success ? 'Connection Connected & Saved!' : 'Connection Failed'}
                    >
                        {testResult.message}
                    </Notice>
                )}
            </FormSection>

            {showGuide && <SmtpSetupGuide ref={guideRef} id={guidePanelId} labelledBy={guideTriggerId} />}

            {/* Email Signature */}
            <FormSection
                layout="aside"
                title="Email Signature (Optional)"
                description="This signature will be automatically appended to all outgoing emails."
            >
                <FormField id="email-signature" label="Default Signature">
                    <Textarea
                        value={form.signature || ''}
                        onChange={e => smtp.setField('signature', e.target.value)}
                        placeholder={"Best regards,\n[Your Name]\n[Your Company]"}
                    />
                </FormField>
            </FormSection>

            <PevCopiesSection text={copies.text} error={copies.error} onChange={copies.onChange} />

            {dirty && (
                <SaveBar
                    summary={saveBarSummary(changed)}
                    // A successful Test Connection saves the server settings too.
                    saving={saving || smtp.testing}
                    error={saveError}
                    onSave={handleSave}
                    onDiscard={discard}
                />
            )}
        </div>
    );
}
