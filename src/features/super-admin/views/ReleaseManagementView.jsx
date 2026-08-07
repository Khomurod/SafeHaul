import React, { useCallback, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Clock,
    History,
    Loader2,
    RefreshCw,
    Rocket,
    ServerCog,
    XCircle,
} from 'lucide-react';
import { Badge, Button, Card } from '@/design-system/components';
import { Inline, ResponsiveGrid, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';
import { RELEASE_PHASES, useReleaseStatus } from '../hooks/useReleaseStatus';
import {
    describeReleaseError,
    promoteTestingToProduction,
    rollbackProductionRelease,
} from '../services/releaseManagement';
import { ReleaseConfirmDialog } from '../components/release/ReleaseConfirmDialog';

/**
 * Super Admin "Releases" — the single, deliberate step by which a tested version
 * of SafeHaul becomes the version end users are served.
 *
 * ## What this screen is for
 *
 * A merge to `main` releases TESTING automatically and never touches Production.
 * Testing is not a fake-data staging site: it runs against the same real
 * companies, applications and recruiter links as Production, and exists so a new
 * version can be seen in use before every user gets it. This screen is where a
 * Super Admin decides that the version now on Testing becomes the version on
 * app.safehaul.io.
 *
 * ## What it deliberately does not do
 *
 * - It does not ask anyone to type a commit id. The system already knows which
 *   version Testing is serving, and the server resolves it independently; a
 *   version typed into a browser could name something nobody ever tested.
 * - It does not report success on a button press. A release takes minutes and is
 *   decided by the deployment pipeline, so every state shown here has been read
 *   back from the server.
 * - It holds no deployment credential of any kind. The request this screen sends
 *   says, in effect, "release the version you consider ready" — and nothing else.
 *
 * ## Why there is no `PageHeader` here
 *
 * `PageHeader` renders the page-level `<h1>`, and the Super Admin masthead
 * already owns the single `<h1>` for this shell — an invariant every migrated
 * Super Admin view shares. This view uses the same `<h2>` + description
 * composition the other views use.
 */

const SHORT_SHA_LENGTH = 7;

const shortSha = (sha) => (typeof sha === 'string' ? sha.slice(0, SHORT_SHA_LENGTH) : '—');

function formatTimestamp(value) {
    if (!value) return '—';
    const millis = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(millis)) return '—';
    return new Date(millis).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

/** One labelled fact inside a release card. */
function ReleaseFact({ label, children }) {
    return (
        <div>
            <dt className="text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                {label}
            </dt>
            <dd className="mt-1 text-ds-sm text-ds-content">{children}</dd>
        </div>
    );
}

/**
 * A single readiness line. Deliberately plain language: "Backend released"
 * rather than "deploy-functions conclusion=success", because the person reading
 * this is deciding whether to change what customers see, not debugging CI.
 */
function ReadinessRow({ ok, pending, label }) {
    const Icon = ok ? CheckCircle2 : (pending ? Clock : XCircle);
    const tone = ok ? 'text-ds-content' : 'text-ds-content-secondary';
    return (
        <li className={`flex items-center gap-ds-2 text-ds-sm ${tone}`}>
            <Icon
                size={16}
                aria-hidden="true"
                className={ok ? 'text-ds-status-success-fg' : (pending ? 'text-ds-status-warning-fg' : 'text-ds-status-danger-fg')}
            />
            <span>{label}</span>
        </li>
    );
}

const PHASE_PRESENTATION = {
    [RELEASE_PHASES.STARTING]: { tone: 'info', label: 'Starting the release…', Icon: Loader2, spin: true },
    [RELEASE_PHASES.RUNNING]: { tone: 'info', label: 'Releasing to Production…', Icon: Loader2, spin: true },
    [RELEASE_PHASES.SUCCEEDED]: { tone: 'success', label: 'Last release succeeded', Icon: CheckCircle2 },
    [RELEASE_PHASES.FAILED]: { tone: 'danger', label: 'Last release did not finish', Icon: AlertTriangle },
};

export function ReleaseManagementView() {
    const { showSuccess } = useToast();
    const { status, phase, loading, error, reload } = useReleaseStatus();

    const [dialog, setDialog] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [dialogError, setDialogError] = useState(null);

    const testing = status?.testing || null;
    const production = status?.production || null;
    const previousProduction = status?.previousProduction || null;
    const busy = phase === RELEASE_PHASES.STARTING || phase === RELEASE_PHASES.RUNNING;

    const alreadyLive = Boolean(testing && production && testing.sha === production.sha);
    const canRelease = Boolean(status?.configured && testing?.eligible && !alreadyLive && !busy);
    const canRollBack = Boolean(status?.configured && previousProduction?.sha && !busy);

    const runAction = useCallback(async (kind) => {
        setSubmitting(true);
        setDialogError(null);
        try {
            const call = kind === 'rollback' ? rollbackProductionRelease : promoteTestingToProduction;
            const expectedSha = kind === 'rollback' ? previousProduction?.sha : testing?.sha;
            const result = await call({ expectedSha });

            setDialog(null);

            if (result?.status === 'already-live') {
                showSuccess('Production is already serving that version. Nothing to release.');
            } else {
                // Deliberately not "Released". The release has been STARTED; the
                // screen reports what actually happened once the server says so.
                showSuccess('Release started. This page will follow its progress.');
            }
            await reload({ quiet: true });
        } catch (err) {
            setDialogError(describeReleaseError(err));
        } finally {
            setSubmitting(false);
        }
    }, [previousProduction, testing, reload, showSuccess]);

    const openDialog = (kind) => { setDialogError(null); setDialog(kind); };

    if (loading && !status) {
        return (
            <Stack gap="md">
                <h2 className="text-ds-heading-lg font-bold text-ds-content">Releases</h2>
                <Card>
                    <p className="text-ds-sm text-ds-content-secondary">Reading the current release state…</p>
                </Card>
            </Stack>
        );
    }

    const phasePresentation = PHASE_PRESENTATION[phase];

    return (
        <Stack gap="lg">
            <div>
                <h2 className="text-ds-heading-lg font-bold text-ds-content">Releases</h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Every merge releases automatically to Testing. Production only changes when you
                    release it here. Testing and Production share the same real data, companies and
                    application links — Testing simply runs the newer version.
                </p>
            </div>

            {error && (
                <Card padding="md" role="alert">
                    <Inline gap="sm">
                        <AlertTriangle size={18} aria-hidden="true" className="text-ds-status-danger-fg" />
                        <span className="text-ds-sm text-ds-content">{error}</span>
                    </Inline>
                </Card>
            )}

            {status && status.configured === false && (
                <Card padding="md" role="status">
                    <Stack gap="sm">
                        <Inline gap="sm">
                            <ServerCog size={18} aria-hidden="true" className="text-ds-status-warning-fg" />
                            <span className="text-ds-sm font-semibold text-ds-content">
                                Not connected to the deployment pipeline yet
                            </span>
                        </Inline>
                        <p className="text-ds-sm text-ds-content-secondary">{status.message}</p>
                    </Stack>
                </Card>
            )}

            {phasePresentation && (
                <Card padding="md" role="status" aria-live="polite">
                    <Inline gap="sm">
                        <phasePresentation.Icon
                            size={18}
                            aria-hidden="true"
                            className={phasePresentation.spin ? 'animate-spin' : undefined}
                        />
                        <span className="text-ds-sm font-semibold text-ds-content">
                            {phasePresentation.label}
                        </span>
                        {status?.latestPromotion?.sha && (
                            <Badge tone={phasePresentation.tone}>
                                {shortSha(status.latestPromotion.sha)}
                            </Badge>
                        )}
                    </Inline>
                    {phase === RELEASE_PHASES.FAILED && (
                        <p className="mt-ds-2 text-ds-sm text-ds-content-secondary">
                            Production was not changed by the failed attempt. The version that was
                            live before it is still live. You can start the release again once the
                            cause is resolved.
                        </p>
                    )}
                </Card>
            )}

            <ResponsiveGrid minItemWidth="320px">
                {/* ---------------------------------------------------- TESTING */}
                <Card padding="lg">
                    <Stack gap="md">
                        <Inline gap="sm">
                            <h3 className="text-ds-heading-md font-bold text-ds-content">Testing</h3>
                            {testing?.eligible
                                ? <Badge tone="success" icon={CheckCircle2}>Ready for Production</Badge>
                                : <Badge tone="warning" icon={Clock}>Not ready yet</Badge>}
                        </Inline>
                        <p className="text-ds-sm text-ds-content-secondary">
                            truckerapp-system.web.app
                        </p>

                        {testing ? (
                            <>
                                <dl className="grid grid-cols-2 gap-ds-3">
                                    <ReleaseFact label="Version">
                                        <code className="font-mono">{shortSha(testing.sha)}</code>
                                    </ReleaseFact>
                                    <ReleaseFact label="Released to Testing">
                                        {formatTimestamp(testing.createdAt)}
                                    </ReleaseFact>
                                </dl>

                                <ul className="space-y-ds-2">
                                    <ReadinessRow ok={testing.checksPassed} pending={!testing.checksPassed} label="All checks passed" />
                                    <ReadinessRow ok label="Testing site updated" />
                                    <ReadinessRow
                                        ok={testing.backendReleased}
                                        pending={!testing.backendReleased}
                                        label="Shared backend released"
                                    />
                                    <ReadinessRow
                                        ok={testing.eligible}
                                        pending={!testing.eligible}
                                        label="Eligible for Production"
                                    />
                                </ul>

                                {testing.blockers?.length > 0 && (
                                    <div className="rounded-ds-md bg-ds-surface-subtle p-ds-3">
                                        <p className="text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                                            Why it is not ready
                                        </p>
                                        <ul className="mt-1 list-disc pl-ds-4 text-ds-sm text-ds-content-secondary">
                                            {testing.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-ds-sm text-ds-content-secondary">
                                No Testing release has been recorded yet.
                            </p>
                        )}
                    </Stack>
                </Card>

                {/* ------------------------------------------------- PRODUCTION */}
                <Card padding="lg">
                    <Stack gap="md">
                        <Inline gap="sm">
                            <h3 className="text-ds-heading-md font-bold text-ds-content">Production</h3>
                            {alreadyLive && <Badge tone="success" icon={CheckCircle2}>Up to date</Badge>}
                        </Inline>
                        <p className="text-ds-sm text-ds-content-secondary">app.safehaul.io</p>

                        {production ? (
                            <dl className="grid grid-cols-2 gap-ds-3">
                                <ReleaseFact label="Version">
                                    <code className="font-mono">{shortSha(production.sha)}</code>
                                </ReleaseFact>
                                <ReleaseFact label="Released to Production">
                                    {formatTimestamp(production.createdAt)}
                                </ReleaseFact>
                            </dl>
                        ) : (
                            <p className="text-ds-sm text-ds-content-secondary">
                                No release has been made through this screen yet, so the exact version
                                currently on Production is not recorded here. The first release you make
                                will start that record.
                            </p>
                        )}

                        {previousProduction && (
                            <div className="rounded-ds-md bg-ds-surface-subtle p-ds-3">
                                <Inline gap="sm">
                                    <History size={16} aria-hidden="true" className="text-ds-content-secondary" />
                                    <span className="text-ds-sm text-ds-content-secondary">
                                        Previous release{' '}
                                        <code className="font-mono">{shortSha(previousProduction.sha)}</code>
                                        {' · '}{formatTimestamp(previousProduction.createdAt)}
                                    </span>
                                </Inline>
                            </div>
                        )}
                    </Stack>
                </Card>
            </ResponsiveGrid>

            <Inline gap="sm">
                <Button
                    variant="primary"
                    disabled={!canRelease}
                    onClick={() => openDialog('promote')}
                >
                    <Rocket size={16} aria-hidden="true" />
                    Release Testing version to Production
                </Button>

                {canRollBack && (
                    <Button variant="secondary" onClick={() => openDialog('rollback')}>
                        <History size={16} aria-hidden="true" />
                        Roll back to previous release
                    </Button>
                )}

                <Button variant="ghost" onClick={() => reload()} disabled={loading}>
                    <RefreshCw size={16} aria-hidden="true" />
                    Refresh
                </Button>
            </Inline>

            {alreadyLive && (
                <p className="text-ds-sm text-ds-content-secondary">
                    Production is already serving the version now on Testing. There is nothing to release.
                </p>
            )}

            {dialog && (
                <ReleaseConfirmDialog
                    kind={dialog}
                    testing={testing}
                    production={production}
                    previousProduction={previousProduction}
                    loading={submitting}
                    error={dialogError}
                    onConfirm={() => runAction(dialog)}
                    onCancel={() => { if (!submitting) { setDialog(null); setDialogError(null); } }}
                />
            )}
        </Stack>
    );
}
