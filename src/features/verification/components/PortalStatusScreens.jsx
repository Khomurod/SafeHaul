import React from 'react';
import { Icon, Loader2, CheckCircle, ShieldCheck } from '@design-system/icons';
import { Card, Notice, StatusMedallion } from '@/design-system/components';

/**
 * Full-page status screens for the public PEV portal. Presentation migrated;
 * the exact headings and messages are unchanged. A link that does not open is
 * not one of these: the portal shows the public pages' shared
 * `LinkProblemScreen`, as signing and change review do.
 */

function StatusShell({ children, role, className = '' }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
            <Card as="main" padding="lg" className={`w-full max-w-md text-center ${className}`.trim()}>
                <div role={role}>{children}</div>
            </Card>
        </div>
    );
}

/*
 * The screens below each show their glyph in a `StatusMedallion`, the loading
 * one included; do not hand-build the disc. An off-scale icon size is the signal
 * that a container is missing, and a glyph must go through `Icon`: rendering an
 * `icon` prop DIRECTLY throws the moment a glyph name becomes a token, on this
 * public portal, in a branch no unit test reaches.
 */
const MEDALLION = 'mx-auto mb-4';

export function LoadingScreen() {
    return (
        <StatusShell role="status">
            <StatusMedallion tone="info" className={MEDALLION}>
                <Icon icon={Loader2} className="animate-spin" />
            </StatusMedallion>
            <h1 className="text-ds-heading-md font-bold text-ds-content">Loading verification request...</h1>
        </StatusShell>
    );
}

export function AlreadyCompletedScreen() {
    return (
        <StatusShell role="status">
            <StatusMedallion tone="success" className={MEDALLION}><Icon icon={CheckCircle} /></StatusMedallion>
            <h1 className="mb-2 text-ds-heading-md font-bold text-ds-content">Already Completed</h1>
            <p className="text-ds-body text-ds-content-secondary">
                This verification has already been submitted. Thank you for your cooperation.
            </p>
        </StatusShell>
    );
}

/**
 * The answer is recorded. It shows the request's short number, never the link's
 * token: the token answers as this employer to anyone who has it.
 */
export function CompletedScreen({ verificationData }) {
    return (
        <StatusShell role="status" className="max-w-lg">
            <StatusMedallion tone="success" className={MEDALLION}><Icon icon={CheckCircle} /></StatusMedallion>
            <h1 className="mb-2 text-ds-heading-lg font-bold text-ds-content">Verification Submitted Successfully</h1>
            <p className="mb-6 text-ds-body text-ds-content-secondary">
                Thank you for completing the employment verification for{' '}
                <strong className="text-ds-content">{verificationData?.applicantName}</strong>.
                Your response has been securely recorded and the requesting company has been notified.
            </p>
            {/* `ShieldCheck` is passed explicitly rather than falling to the
                success tone's tick: it says *securely recorded*, which a generic
                tick does not. The glyph does move — it was inline in the
                sentence and is now in the leading slot, which is better for a
                message that wraps but is a visible change either way.
                `Notice` sets `text-align: start`, so `text-left` is redundant. */}
            <Notice tone="success" icon={ShieldCheck}>
                A PDF record has been generated and added to the applicant&apos;s Qualification file.
            </Notice>
            {verificationData?.requestNumber && (
                <p className="mt-6 text-ds-xs text-ds-content-muted">Request number: {verificationData.requestNumber}</p>
            )}
        </StatusShell>
    );
}
