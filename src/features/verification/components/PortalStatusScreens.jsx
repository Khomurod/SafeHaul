import React from 'react';
import { Icon, Loader2, CheckCircle, AlertTriangle, Clock, ShieldCheck } from '@design-system/icons';
import { Card, Notice, StatusMedallion } from '@/design-system/components';

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

/*
 * `StatusIcon` lived here until 2026-09-06 — a 64px tinted square holding a 36px
 * glyph, with its own three-tone class map, in a file that already imported from
 * the design system. It is `StatusMedallion`, hand-built.
 *
 * Two things brought it out. The 36px is not a step on the icon scale, and an
 * off-scale size is the signal that a container is missing. And `StatusIcon`
 * rendered its `icon` prop DIRECTLY — `<Icon className="h-9 w-9" />` — which
 * throws the moment a glyph name becomes a token, on this public portal, in a
 * branch no unit test reaches.
 *
 * The four screens below are also consistent for the first time: the loading one
 * had a bare spinner where the other three had a disc.
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

export function ErrorScreen({ error }) {
    return (
        <StatusShell role="alert">
            <StatusMedallion tone="danger" className={MEDALLION}><Icon icon={AlertTriangle} /></StatusMedallion>
            <h1 className="mb-2 text-ds-heading-md font-bold text-ds-content">Verification Error</h1>
            <p className="text-ds-body text-ds-content-secondary">{error}</p>
        </StatusShell>
    );
}

export function ExpiredScreen() {
    return (
        <StatusShell role="alert">
            <StatusMedallion tone="warning" className={MEDALLION}><Icon icon={Clock} /></StatusMedallion>
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
            <StatusMedallion tone="success" className={MEDALLION}><Icon icon={CheckCircle} /></StatusMedallion>
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
            <p className="mt-6 text-ds-xs text-ds-content-muted">Verification ID: {token}</p>
        </StatusShell>
    );
}
