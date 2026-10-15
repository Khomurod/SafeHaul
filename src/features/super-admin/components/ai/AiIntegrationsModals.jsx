/**
 * The dialogs of the AI Integrations screen: credential add/replace, the
 * typed-back credential deletion, and the re-authentication prompt that
 * `useReauthGuard` builds. `AiIntegrationsView.jsx` owns all of their state.
 */

import React from 'react';
import { AiCredentialModal } from './AiCredentialModal';
import { AiCredentialDeleteDialog } from './AiCredentialDeleteDialog';

export function AiIntegrationsModals({
    credentialModal,
    setCredentialModal,
    handleSaveCredential,
    deleteTarget,
    setDeleteTarget,
    deleting,
    deleteError,
    setDeleteError,
    handleDelete,
    reauthPrompt,
}) {
    return (
        <>
            {credentialModal && (
                <AiCredentialModal
                    provider={credentialModal.provider}
                    field={credentialModal.field}
                    mode={credentialModal.mode}
                    onSubmit={handleSaveCredential}
                    onCancel={() => setCredentialModal(null)}
                />
            )}

            {deleteTarget && (
                <AiCredentialDeleteDialog
                    provider={deleteTarget.provider}
                    field={deleteTarget.field}
                    loading={deleting}
                    error={deleteError}
                    onConfirm={handleDelete}
                    onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
                />
            )}

            {reauthPrompt}
        </>
    );
}
