import React, { useState } from 'react';
import { Icon, ClipboardList } from '@design-system/icons';
import { Button } from '@design-system/components';
import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';

/**
 * The dossier's **Log call**, beside its Call: it opens the call log the lists
 * open from a driver's number (`CallOutcomeModal`, `useCallOutcome`), for the
 * record on screen, so a recruiter records a call and its result without closing
 * the dossier. The record goes in as a list row gives it (`{ id, companyId,
 * ...data }`), and as there, a record with no phone has no call to log.
 *
 * Offered to whoever may work the record in the dossier (`canLog`, its
 * `canEdit`); the rules decide the writes, as from the list. `onLogged` runs
 * once the call is saved, so the dossier shows the stage a call moves, the last
 * call and the activity.
 *
 * Presentation: the approved `Button`, in the tile shape of the Call and Email
 * links beside it.
 */
export function DossierLogCall({ companyId, recordId, record, collectionName = null, canLog = false, onLogged }) {
    const [open, setOpen] = useState(false);
    if (!canLog || !companyId || !recordId || !record?.phone) return null;

    return (
        <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                {/* Inside `Button`, whose `.ds-button__content > svg` rule owns the size. */}
                <Icon icon={ClipboardList} />
                <span>Log call</span>
            </Button>
            {open && (
                <CallOutcomeModal
                    lead={{ companyId, ...record, id: recordId }}
                    companyId={companyId}
                    // The collection the dossier found the record in, not a guess.
                    collectionName={collectionName}
                    onClose={() => setOpen(false)}
                    onUpdate={() => onLogged?.()}
                />
            )}
        </>
    );
}

export default DossierLogCall;
