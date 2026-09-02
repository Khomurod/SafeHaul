import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { FileSignature, History, Loader2 } from 'lucide-react';
import { functions } from '@lib/firebase';
import { Button, Card, FieldMessage, FormField, Textarea } from '@/design-system/components';
import { useToast } from '@shared/components/feedback';

/**
 * Agreements — the versioned legal authorizations the applicant reads and accepts.
 *
 * Every carrier's applicants see the platform wording with the carrier's name
 * filled in, unless the carrier has its own published wording. This panel shows,
 * per agreement: where it is presented (the MVR step or the final consent step),
 * the text currently in force, and the company's version history.
 *
 * Legal wording is under SUPER ADMIN control. A company admin sees everything
 * read-only; a super admin can publish new wording (which creates a new,
 * content-addressed version — earlier versions are never edited, so what an
 * earlier applicant accepted stays exactly what they accepted) or revert the
 * company to the platform wording. Both go through callables; no client can
 * write the underlying documents.
 */
const PLACEMENT = {
    drivingRecord: 'Motor Vehicle Record step (answered Yes/No)',
    consent: 'Agreements & Signature step (acknowledged and signed)',
};

function formatWhen(iso) {
    if (!iso) return 'date not recorded';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function AgreementCard({ agreement, canPublish, busy, onPublish, onRevert }) {
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const inForce = agreement.currentBody || agreement.platformBody;
    const usesCompanyWording = Boolean(agreement.currentVersion);
    const draftId = `agreement-draft-${agreement.id}`;

    return (
        <Card padding="md" className="space-y-ds-4" data-agreement-id={agreement.id}>
            <div className="flex flex-col gap-ds-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h5 className="text-ds-body font-bold text-ds-content">{agreement.title}</h5>
                    <p className="text-ds-xs text-ds-content-muted">Shown on the {PLACEMENT[agreement.presentedOn] || 'application'}.</p>
                </div>
                <p className="shrink-0 text-ds-xs font-medium text-ds-content-secondary" data-testid={`${agreement.id}-source`}>
                    {usesCompanyWording ? `Company wording · version ${agreement.currentVersion}` : `Platform wording · version ${agreement.platformVersion}`}
                </p>
            </div>

            <div
                tabIndex={0}
                role="group"
                aria-label={`${agreement.title} wording in force`}
                className="max-h-56 overflow-y-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
            >
                <p className="whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-content-secondary">{inForce}</p>
            </div>

            {agreement.versions.length > 0 && (
                <details className="text-ds-sm">
                    <summary className="flex cursor-pointer items-center gap-ds-2 font-medium text-ds-content">
                        <History size={14} aria-hidden="true" /> Version history ({agreement.versions.length})
                    </summary>
                    <ul className="mt-ds-2 space-y-ds-2">
                        {agreement.versions.map((version) => (
                            <li key={version.id} className="rounded-ds-md border border-ds-border-subtle p-ds-3">
                                <p className="text-ds-xs text-ds-content-muted">
                                    <span className="font-mono">{version.id}</span> · published {formatWhen(version.createdAt)}
                                    {version.id === agreement.currentVersion ? ' · in force' : ''}
                                    {version.note ? ` · ${version.note}` : ''}
                                </p>
                                <p className="mt-ds-1 whitespace-pre-wrap text-ds-xs text-ds-content-secondary">{version.body}</p>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {canPublish && !editing && (
                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setDraft(inForce); setEditing(true); }}>
                        Publish new wording
                    </Button>
                    {usesCompanyWording && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRevert(agreement.id)}>
                            Use platform wording
                        </Button>
                    )}
                </div>
            )}
            {canPublish && editing && (
                <div className="space-y-ds-3">
                    <FormField
                        id={draftId}
                        label={`New wording for ${agreement.title}`}
                        description="Use {{companyName}} where the carrier's name belongs. Publishing creates a new version; earlier versions, and what earlier applicants accepted, never change."
                    >
                        <Textarea rows="10" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    </FormField>
                    <div className="flex flex-wrap gap-ds-2">
                        <Button variant="primary" size="sm" loading={busy} onClick={async () => { await onPublish(agreement.id, draft); setEditing(false); }}>
                            Publish
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                    </div>
                </div>
            )}
        </Card>
    );
}

export function AgreementsPanel({ companyId, canPublish = false }) {
    const { showSuccess, showError } = useToast();
    const [agreements, setAgreements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        setError('');
        try {
            const call = httpsCallable(functions, 'listCompanyAgreementWording');
            const { data } = await call({ companyId });
            setAgreements(Array.isArray(data?.agreements) ? data.agreements : []);
        } catch (err) {
            setError(err?.message || 'The agreements could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    useEffect(() => { load(); }, [load]);

    const run = async (name, payload, successMessage) => {
        setBusy(true);
        try {
            const call = httpsCallable(functions, name);
            const { data } = await call({ companyId, ...payload });
            setAgreements(Array.isArray(data?.agreements) ? data.agreements : agreements);
            showSuccess(successMessage);
        } catch (err) {
            showError(err?.message || 'The change could not be saved.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section aria-labelledby="agreements-heading" className="space-y-ds-4">
            <div>
                <h3 id="agreements-heading" className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <FileSignature size={20} className="text-ds-action-primary" aria-hidden="true" /> Agreements
                </h3>
                <p className="text-ds-sm text-ds-content-muted">
                    The legal authorizations your applicants read and accept. Every version is kept, and an application
                    always records the exact version its applicant saw.
                    {canPublish
                        ? ' As a super admin you can publish new wording for this company or return it to the platform wording.'
                        : ' Changes to legal wording are made by a SafeHaul super admin — contact support to request one.'}
                </p>
            </div>
            {loading && (
                <p role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-muted">
                    <Loader2 className="animate-spin" size={16} aria-hidden="true" /> Loading agreements…
                </p>
            )}
            {error && <FieldMessage tone="error">{error}</FieldMessage>}
            {!loading && !error && agreements.map((agreement) => (
                <AgreementCard
                    key={agreement.id}
                    agreement={agreement}
                    canPublish={canPublish}
                    busy={busy}
                    onPublish={(agreementId, body) => run('publishCompanyAgreementWording', { agreementId, body }, 'New wording published. Applicants see it from now on; earlier applications are unchanged.')}
                    onRevert={(agreementId) => run('revertCompanyAgreementWording', { agreementId }, 'Platform wording restored for this agreement.')}
                />
            ))}
        </section>
    );
}

export default AgreementsPanel;
