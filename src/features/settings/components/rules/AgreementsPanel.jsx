import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Eye, Icon, History, Loader2, X } from '@design-system/icons';
import { functions } from '@lib/firebase';
import { Badge, Button, DataTable, FieldMessage, FormField, FormSection, IconButton, Textarea } from '@/design-system/components';
import { Modal } from '@design-system/patterns';
import { useToast } from '@shared/components/feedback';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';
import { formatDate } from '@shared/utils/helpers';
import { listTitleOf, versionLabelOf } from './agreementLabels';

/**
 * Agreements — the versioned legal authorizations the applicant reads and accepts.
 *
 * Every carrier's applicants see the platform wording with the carrier's name
 * filled in, unless the carrier has its own published wording. The list shows
 * each agreement and the version in force, as C2 draws it; Read opens the
 * agreement: where it is presented (the MVR step or the final consent step), the
 * text in force and the company's version history.
 *
 * Legal wording is under SUPER ADMIN control. A company admin sees everything
 * read-only; a super admin can publish new wording (which creates a new,
 * content-addressed version — earlier versions are never edited, so what an
 * earlier applicant accepted stays exactly what they accepted) or revert the
 * company to the platform wording, from the same dialog. Both go through
 * callables; no client can write the underlying documents.
 */
const PLACEMENT = {
    drivingRecord: 'Motor Vehicle Record step (answered Yes/No)',
    consent: 'Agreements & Signature step (acknowledged and signed)',
};

function formatWhen(iso) {
    if (!iso) return 'date not recorded';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatDate(date, true);
}

/** One agreement, read in full: its wording, its history and, for a super admin, its changes. */
function AgreementDialog({ agreement, canPublish, busy, onPublish, onRevert, onClose }) {
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const inForce = agreement.currentBody || agreement.platformBody;
    const usesCompanyWording = Boolean(agreement.currentVersion);
    const draftId = `agreement-draft-${agreement.id}`;
    const titleId = `agreement-${agreement.id}-title`;

    return (
        <Modal onClose={onClose} labelledBy={titleId} size="2xl" mobile="sheet" scroll="body">
            <div className="flex shrink-0 items-start justify-between gap-ds-4 px-ds-4 pt-ds-5 sm:px-ds-6">
                <div className="min-w-0 space-y-ds-1">
                    <h2 id={titleId} className="text-ds-heading-md font-bold text-ds-content [text-wrap:balance]">
                        {listTitleOf(agreement.title)}
                    </h2>
                    <p className="text-ds-xs text-ds-content-secondary">Shown on the {PLACEMENT[agreement.presentedOn] || 'application'}.</p>
                    <p className="text-ds-xs font-medium text-ds-content-secondary" data-testid={`${agreement.id}-source`}>
                        {usesCompanyWording ? `Company wording · version ${agreement.currentVersion}` : `Platform wording · version ${agreement.platformVersion}`}
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose} className="-mr-ds-2 -mt-ds-1">
                    <Icon icon={X} size="lg" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 space-y-ds-4 overflow-y-auto px-ds-4 py-ds-5 sm:px-ds-6">
                <div
                    tabIndex={0}
                    role="group"
                    aria-label={`${listTitleOf(agreement.title)} wording in force`}
                    className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus"
                >
                    <p className="whitespace-pre-wrap text-ds-sm leading-relaxed text-ds-content-secondary">{inForce}</p>
                </div>

                {agreement.versions.length > 0 && (
                    <details className="text-ds-sm">
                        <summary className="flex cursor-pointer items-center gap-ds-2 font-medium text-ds-content">
                            <Icon icon={History} size="sm" /> Version history ({agreement.versions.length})
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
            </div>
        </Modal>
    );
}

export function AgreementsPanel({ companyId, canPublish = false }) {
    const { showSuccess, showError } = useToast();
    const [agreements, setAgreements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [readingId, setReadingId] = useState(null);
    // On a phone Read is a full-size target.
    const isPhone = useIsMobile();

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        setError('');
        try {
            const call = httpsCallable(functions, 'listCompanyAgreementWording');
            const { data } = await call({ companyId });
            setAgreements(Array.isArray(data?.agreements) ? data.agreements : []);
        } catch (err) {
            console.error('Agreements load failed:', err);
            setError(plainErrorMessage(err, 'The agreements could not be loaded.'));
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
            console.error('Agreement change failed:', err);
            showError(plainErrorMessage(err, 'The change could not be saved.'));
        } finally {
            setBusy(false);
        }
    };

    const columns = useMemo(() => [
        {
            key: 'title',
            header: 'Agreement',
            rowHeader: true,
            render: (agreement) => (
                <span className="font-semibold text-ds-content [text-wrap:pretty] max-md:text-ds-heading-sm">
                    {listTitleOf(agreement.title)}
                </span>
            ),
        },
        {
            key: 'version',
            header: 'Current version',
            width: 'lg',
            mobileRole: 'line',
            render: (agreement) => <Badge tone={agreement.currentVersion ? 'info' : 'neutral'}>{versionLabelOf(agreement)}</Badge>,
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'sm',
            // On a card, Read stands at the end of the title's line.
            mobileRole: 'status',
            render: (agreement) => (
                <Button
                    variant="secondary"
                    size={isPhone ? 'md' : 'sm'}
                    aria-label={`Read ${listTitleOf(agreement.title)}`}
                    onClick={() => setReadingId(agreement.id)}
                >
                    <Icon icon={Eye} size="sm" />
                    Read
                </Button>
            ),
        },
    ], [isPhone]);

    const reading = agreements.find((agreement) => agreement.id === readingId) || null;
    const loaded = !loading && !error;
    return (
        <FormSection
            layout="stacked"
            padding={loaded ? 'none' : 'md'}
            title="Agreements"
            description={`The legal authorizations your applicants read and accept. Every version is kept, and an application always records the exact version its applicant saw.${canPublish
                ? ' As a super admin you can publish new wording for this company or return it to the platform wording.'
                : ' Changes to legal wording are made by a SafeHaul super admin — contact support to request one.'}`}
        >
            {loading && (
                <p role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-muted">
                    <Icon icon={Loader2} className="animate-spin" /> Loading agreements…
                </p>
            )}
            {error && <FieldMessage tone="error">{error}</FieldMessage>}
            {loaded && (
                <DataTable
                    embedded
                    ariaLabel="Agreements"
                    minWidth="none"
                    mobilePresentation="cards"
                    data={agreements}
                    columns={columns}
                    getRowId={(agreement) => agreement.id}
                    empty={{ title: 'No agreements yet' }}
                />
            )}
            {reading && (
                <AgreementDialog
                    agreement={reading}
                    canPublish={canPublish}
                    busy={busy}
                    onPublish={(agreementId, body) => run('publishCompanyAgreementWording', { agreementId, body }, 'New wording published. Applicants see it from now on; earlier applications are unchanged.')}
                    onRevert={(agreementId) => run('revertCompanyAgreementWording', { agreementId }, 'Platform wording restored for this agreement.')}
                    onClose={() => setReadingId(null)}
                />
            )}
        </FormSection>
    );
}

export default AgreementsPanel;
