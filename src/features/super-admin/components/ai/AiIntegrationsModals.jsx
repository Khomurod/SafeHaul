/**
 * The three dialogs of the AI Integrations screen: credential add/replace,
 * the typed-back credential deletion, and re-authentication. Extracted
 * verbatim from `AiIntegrationsView.jsx`, which owns all of their state; a
 * cancelled re-authentication still rejects with the typed error, so a
 * cancelled mutation is never reported as done.
 */

import React from 'react';
import { ReauthCancelledError } from '../../services/aiIntegrations';
import { AiCredentialModal } from './AiCredentialModal';
import { AiCredentialDeleteDialog } from './AiCredentialDeleteDialog';
import { ReauthenticateModal } from '../environment/ReauthenticateModal';

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
    reauth,
    setReauth,
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

            {reauth && (
                <ReauthenticateModal
                    onSuccess={() => {
                        const { resolve } = reauth;
                        setReauth(null);
                        resolve();
                    }}
                    onCancel={() => {
                        const { reject } = reauth;
                        setReauth(null);
                        // The typed error is what lets every caller distinguish
                        // "the operator backed out" from "the server refused",
                        // so a cancelled mutation is never reported as done.
                        reject(new ReauthCancelledError());
                    }}
                />
            )}
        </>
    );
}
