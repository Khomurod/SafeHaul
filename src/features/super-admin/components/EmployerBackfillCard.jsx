import React, { useEffect, useId, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, Wrench } from '@design-system/icons';
import { Button, Card } from '@/design-system/components';
import { useToast } from '@shared/components/feedback';
import {
    BackfillEmployersConfirmDialog,
    BackfillEmployersResultDialog,
} from './BackfillEmployersDialogs';

/**
 * Maintenance → Employer backfill: renames old employer field names in every
 * existing application, across every company (`backfillEmployerFields`). It
 * asks first, reports four counters in a dialog and refreshes the console's
 * lists, exactly as it did from the masthead.
 *
 * The callable renames a field only where the new one is missing, so running it
 * again changes nothing that is already renamed. Its explanation is visible help
 * text and the button's accessible description, not a `title` tooltip.
 *
 * @param {{ onDataUpdate?: () => void }} props `onDataUpdate` refreshes the
 *   console's lists after a run.
 */
export function EmployerBackfillCard({ onDataUpdate }) {
    const { showSuccess, showError, showInfo } = useToast();
    const descriptionId = useId();
    const [backfillingEmployers, setBackfillingEmployers] = useState(false);
    const [confirmingBackfill, setConfirmingBackfill] = useState(false);
    const [backfillReport, setBackfillReport] = useState(null);
    // The backfill spans two dialogs, and the shared Modal's own focus restoration
    // cannot bridge them: confirming disables the trigger (`loading`) *and*
    // unmounts the confirmation, so the confirmation restores focus to a disabled
    // button — which silently lands on <body>. The result dialog then captures
    // <body> as its "previously focused" element, and closing the report drops a
    // keyboard user at the top of the page. Holding the trigger ourselves lets us
    // put focus back where it started once the whole flow ends.
    const backfillTriggerRef = useRef(null);
    const restoreFocusAfterReport = useRef(false);

    // Deliberately an effect rather than a call inside the dialog's `onClose`:
    // the closing Modal restores focus in its own unmount cleanup, which runs
    // *after* the click handler, so focusing there would just be overwritten.
    // An effect runs after that cleanup, so this wins.
    useEffect(() => {
        if (!backfillReport && restoreFocusAfterReport.current) {
            restoreFocusAfterReport.current = false;
            backfillTriggerRef.current?.focus();
        }
    }, [backfillReport]);

    const runBackfillEmployers = async () => {
        setConfirmingBackfill(false);
        setBackfillingEmployers(true);
        showInfo("Running employer field backfill... this may take a few minutes.");

        try {
            const backfillFn = httpsCallable(functions, 'backfillEmployerFields', { timeout: 540000 });
            const result = await backfillFn({ dryRun: false });
            const stats = result.data.stats || {};
            showSuccess(result.data.message);
            setBackfillReport(stats);
            onDataUpdate?.();
        } catch (e) {
            console.error("Employer Backfill Failed:", e);
            showError("Employer backfill failed: " + e.message);
        } finally {
            setBackfillingEmployers(false);
        }
    };

    return (
        <Card padding="lg">
            <h3 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">Employer backfill</h3>
            <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-start sm:justify-between">
                <p id={descriptionId} className="max-w-prose text-ds-sm text-ds-content-secondary">
                    Renames old employer field names in every existing application, across every
                    company. Applications already using the new names are left as they are.
                </p>
                <div className="shrink-0">
                    <Button
                        ref={backfillTriggerRef}
                        variant="secondary"
                        onClick={() => setConfirmingBackfill(true)}
                        loading={backfillingEmployers}
                        aria-describedby={descriptionId}
                    >
                        {!backfillingEmployers && <Icon icon={Wrench} />}
                        {backfillingEmployers ? "Backfilling..." : "Backfill Employers"}
                    </Button>
                </div>
            </div>

            {confirmingBackfill && (
                <BackfillEmployersConfirmDialog
                    onConfirm={runBackfillEmployers}
                    onCancel={() => setConfirmingBackfill(false)}
                />
            )}

            {backfillReport && (
                <BackfillEmployersResultDialog
                    stats={backfillReport}
                    onClose={() => {
                        // By now `backfillingEmployers` is false, so the trigger is
                        // focusable again and this is the end of the flow.
                        restoreFocusAfterReport.current = true;
                        setBackfillReport(null);
                    }}
                />
            )}
        </Card>
    );
}
