import React from 'react';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * Confirmation for the two actions that change what end users are served.
 *
 * It states the actual versions involved rather than a generic "are you sure",
 * because the only useful question here is "is this the version I meant, and
 * what is it replacing". Both facts come from the release state the screen just
 * read from the server.
 *
 * The rollback wording names what a rollback does NOT undo. Testing and
 * Production share one Firebase project: the same Cloud Functions, Firestore
 * rules, Storage rules and all business data. Putting the previous frontend back
 * does not put the backend or the data back, and an operator reaching for
 * rollback during an incident is exactly the person who must not learn that
 * afterwards.
 */

const shortSha = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : 'unknown');

function VersionLine({ label, sha, note }) {
    return (
        <div className="flex items-baseline justify-between gap-ds-3">
            <span className="text-ds-sm text-ds-content-secondary">{label}</span>
            <span className="text-ds-sm text-ds-content">
                <code className="font-mono">{shortSha(sha)}</code>
                {note && <span className="ml-ds-2 text-ds-content-secondary">{note}</span>}
            </span>
        </div>
    );
}

export function ReleaseConfirmDialog({
    kind,
    testing,
    production,
    previousProduction,
    loading,
    error,
    onConfirm,
    onCancel,
}) {
    const isRollback = kind === 'rollback';
    const target = isRollback ? previousProduction : testing;

    return (
        <ConfirmDialog
            title={isRollback
                ? 'Put Production back on the previous version?'
                : 'Release this tested version to Production?'}
            description={isRollback
                ? 'This restores the exact frontend that was live before the current one.'
                : 'This updates the SafeHaul Production application for all end users.'}
            tone={isRollback ? 'danger' : 'warning'}
            confirmLabel={isRollback ? 'Roll back Production' : 'Release to Production'}
            cancelLabel="Cancel"
            loading={loading}
            error={error}
            onConfirm={onConfirm}
            onCancel={onCancel}
        >
            <div className="mt-ds-4 space-y-ds-3 text-start">
                <div className="space-y-ds-2 rounded-ds-md bg-ds-surface-subtle p-ds-3">
                    <VersionLine
                        label={isRollback ? 'Rolling back to' : 'Releasing version'}
                        sha={target?.sha}
                    />
                    <VersionLine
                        label="Production currently"
                        sha={production?.sha}
                        note={production ? undefined : '(not recorded)'}
                    />
                    {!isRollback && (
                        <>
                            <VersionLine label="Checks" sha={undefined} note={testing?.checksPassed ? 'Passed' : 'Not passed'} />
                            <VersionLine label="Testing" sha={undefined} note={testing?.backendReleased ? 'Healthy' : 'Incomplete'} />
                        </>
                    )}
                </div>

                <p className="text-ds-sm text-ds-content-secondary">
                    The exact version verified on Testing is copied to Production. Nothing is rebuilt,
                    so what goes live is byte for byte what you have been using on Testing.
                </p>

                {isRollback && (
                    <p className="text-ds-sm text-ds-content-secondary">
                        This changes the frontend only. Cloud Functions, security rules and all
                        business data are shared with Testing and are <strong>not</strong> rolled
                        back.
                    </p>
                )}
            </div>
        </ConfirmDialog>
    );
}
