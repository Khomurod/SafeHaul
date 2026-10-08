import React from 'react';
import { Checkbox, ChoiceGroup } from '@/design-system/components';
import { ConfirmDialog } from '@/design-system/patterns';
import { describeApplicant, describeProgress } from './unfinishedRowActions';

/**
 * The confirmation for deleting an unfinished application with everything in it.
 *
 * It says what goes before anything does, from the server's own answer
 * (`useUnfinishedDraftDelete`): the answers, the uploaded files and every link,
 * and the same driver's other unfinished applications, each ticked, so the admin
 * can keep one that is somebody else's. What stays is said too: a submitted
 * application, a hired driver, a file a submitted application uses, and a file
 * uploaded before the server began telling submitted files apart.
 */

const filesPhrase = (count) => (count === 1 ? '1 uploaded file' : `${count} uploaded files`);

/** "One file uploaded before October 12, 2026 stays too, …", or null. */
function olderFilesSentence(count, keptBefore) {
    const day = keptBefore ? new Date(`${keptBefore}T00:00:00Z`) : null;
    if (!(count > 0) || !day || Number.isNaN(day.getTime())) return null;
    const date = day.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return count === 1
        ? `One file uploaded before ${date} stays too, as an application submitted before then may use it.`
        : `${count} files uploaded before ${date} stay too, as an application submitted before then may use them.`;
}

/** "Same last name, date of birth and SSN; same phone", from what the server says two drafts share. */
function sharedPhrase(shares = []) {
    const contact = ['email', 'phone'].filter((fact) => shares.includes(fact)).join(' and ');
    const parts = [shares.includes('identity') ? 'last name, date of birth and SSN' : '', contact].filter(Boolean);
    return parts.length > 0 ? `Same ${parts.join('; same ')}` : null;
}

/** "Same email and phone · Employment history · 2 uploaded files · dana@example.test" */
function describeRelated(row) {
    const parts = [
        sharedPhrase(row.shares),
        describeProgress(row),
        row.fileCount > 0 ? filesPhrase(row.fileCount) : null,
        row.email || row.phone || null,
    ];
    return parts.filter(Boolean).join(' · ');
}

/**
 * @param {{ deletion: ReturnType<import('./useUnfinishedDraftDelete').useUnfinishedDraftDelete> }} props
 */
export function UnfinishedDeleteDialog({ deletion }) {
    const { target, keep, toggle, deleting, error, confirm, cancel } = deletion;
    if (!target) return null;

    const { entry, preview } = target;
    // The server's summary is newer than the list's row, if the driver renamed themselves since.
    const { actionName } = describeApplicant(preview.application || entry);
    const fileCount = preview.application?.fileCount || 0;
    const what = fileCount > 0 ? `its answers, ${filesPhrase(fileCount)} and any link sent for it` : 'its answers and any link sent for it';
    const going = [preview.application, ...preview.related.filter((row) => !keep.has(row.applicantKey))];
    const total = going.length;
    const olderFiles = olderFilesSentence(
        going.reduce((sum, row) => sum + (row?.olderFileCount || 0), 0),
        preview.filesKeptBefore,
    );

    return (
        <ConfirmDialog
            title="Delete this unfinished application?"
            description={`Everything saved for ${actionName} will be deleted for good: ${what}.`}
            tone="danger"
            confirmLabel={total > 1 ? `Delete ${total} applications` : 'Delete application'}
            cancelLabel="Keep application"
            loading={deleting}
            error={error}
            onConfirm={confirm}
            onCancel={cancel}
        >
            {preview.related.length > 0 && (
                <ChoiceGroup
                    legend={preview.related.length === 1
                        ? "Also delete the same driver's other unfinished application"
                        : "Also delete the same driver's other unfinished applications"}
                    description="Untick any that belongs to someone else, such as a person sharing the phone."
                >
                    {preview.related.map((row) => (
                        <Checkbox
                            key={row.applicantKey}
                            label={describeApplicant(row).displayName}
                            description={describeRelated(row)}
                            checked={!keep.has(row.applicantKey)}
                            onChange={() => toggle(row.applicantKey)}
                            disabled={deleting}
                        />
                    ))}
                </ChoiceGroup>
            )}
            <p className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                Submitted applications and hired drivers are not touched, nor any file a submitted application uses.
                {olderFiles && ` ${olderFiles}`}
                {' '}A driver who still has this application open on their own device can still submit it from there.
            </p>
        </ConfirmDialog>
    );
}

export default UnfinishedDeleteDialog;
