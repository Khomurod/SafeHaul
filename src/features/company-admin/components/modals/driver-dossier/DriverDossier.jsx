import React, { Suspense, lazy } from 'react';
import { Icon, Loader2 } from '@design-system/icons';
import { Modal } from '@design-system/patterns';
import { loadDriverDossier } from './loadDriverDossier';

/**
 * The driver dossier, loading its own code.
 *
 * The dossier is most of the code of every page that opens it and is needed only
 * once a record is opened, so it is a chunk of its own. Until that chunk arrives,
 * the dialog opens in the dossier's frame with its loading line: a click on a
 * slow connection is seen and announced at once, and Escape or the backdrop
 * closes it as they close the dossier.
 *
 * Render it only while a record is open, with `DriverProfileModal`'s props.
 */
const DriverProfileModal = lazy(() => loadDriverDossier()
    .then((module) => ({ default: module.DriverProfileModal })));

function DossierCodeLoading({ onClose }) {
    return (
        <Modal label="Driver dossier" onClose={onClose} size="7xl" scroll="body" fill mobile="fullscreen">
            <div role="status" className="flex flex-1 flex-col items-center justify-center gap-ds-2">
                <Icon icon={Loader2} size="3xl" className="animate-spin text-ds-action-primary" />
                <p className="text-ds-sm font-medium text-ds-content-secondary">Loading driver dossier…</p>
            </div>
        </Modal>
    );
}

export function DriverDossier(props) {
    if (!props.isOpen) return null;
    return (
        <Suspense fallback={<DossierCodeLoading onClose={props.onClose} />}>
            <DriverProfileModal {...props} />
        </Suspense>
    );
}
