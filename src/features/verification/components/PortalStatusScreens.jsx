import React from 'react';
import { Loader2, CheckCircle, AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { Card, Notice } from '@/design-system/components';

/**
 * Full-page status screens for the public PEV portal. Presentation migrated;
 * the exact token-state headings and messages are unchanged.
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

// Literal token classes (Tailwind scans complete class strings, not
// dynamically-built ones).
const STATUS_ICON_TONES = {
    danger: 'bg-ds-status-danger-bg text-ds-status-danger-fg',
    warning: 'bg-ds-status-warning-bg text-ds-status-warning-fg',
    success: 'bg-ds-status-success-bg text-ds-status-success-fg',
};

function StatusIcon({ icon: Icon, tone }) {
    return (
        <span
            aria-hidden="true"
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-ds-lg ${STATUS_ICON_TONES[tone]}`}
        >
            <Icon className="h-9 w-9" />
        </span>
    );
}

export function LoadingScreen() {
    return (
        <StatusShell role="status">
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-ds-content-link" aria-hidden="true" />
            <h1 className="text-ds-heading-md font-bold text-ds-content">Loading verification request...</h1>
        </StatusShell>
    );
}

export function ErrorScreen({ error }) {
    return (
        <StatusShell role="alert">
            <StatusIcon icon={AlertTriangle} tone="danger" />
            <h1 className="mb-2 text-ds-heading-md font-bold text-ds-content">Verification Error</h1>
            <p className="text-ds-body text-ds-content-secondary">{error}</p>
        </StatusShell>
    );
}

export function ExpiredScreen() {
    return (
        <StatusShell role="alert">
            <StatusIcon icon={Clock} tone="warning" />
            <h1 className="mb-2 text-ds-heading-md font-bold text-ds-content">Link Expired</h1>
            <p className="text-ds-body text-ds-content-secondary">
                This verification request has expired. Please contact the requesting company for a new link.
            </p>
        </StatusShell>
    );
}

export function AlreadyCompletedScreen() {
    return (
        <StatusShell role="status">
            <StatusIcon icon={CheckCircle} tone="success" />
            <h1 className="mb-2 text-ds-heading-md font-bold text-ds-content">Already Completed</h1>
            <p className="text-ds-body text-ds-content-secondary">
                This verification has already been submitted. Thank you for your cooperation.
            </p>
        </StatusShell>
    );
}

export function CompletedScreen({ verificationData, token }) {
    return (
        <StatusShell role="status" className="max-w-lg">
            <StatusIcon icon={CheckCircle} tone="success" />
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
            <p className="mt-6 text-ds-xs text-ds-content-muted">Verification ID: {token}</p>
        </StatusShell>
    );
}
