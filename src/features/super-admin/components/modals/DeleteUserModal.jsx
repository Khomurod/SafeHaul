import React, { useId, useState } from 'react';
import { httpsCallable } from "firebase/functions";
import { functions } from '@lib/firebase';
import { AlertTriangle, X } from 'lucide-react';
import { Button, IconButton } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Destructive confirmation for deleting a portal user.
 *
 * Migrated to the shared accessible `Modal` 2026-07-28. Presentation only — the
 * `deletePortalUser` callable name and its `{ userId }` payload, the
 * `onConfirm()` → `onClose()` order, and every frozen string are unchanged.
 *
 * Same defect set as `DeleteCompanyModal`: no dialog semantics, no focus trap,
 * no Escape, no focus restoration, an unnamed icon-only close control, and an
 * unannounced error. See that file for the full rationale.
 */
export function DeleteUserModal({ userId, userName, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      const deletePortalUser = httpsCallable(functions, 'deletePortalUser');
      await deletePortalUser({ userId: userId });
      await onConfirm();
      onClose();
    } catch (err) {
      console.error("Error deleting user:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
      closeOnBackdrop={false}
      closeOnEscape={!loading}
      className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div id="delete-user-modal">
        <header className="flex items-center justify-between border-b border-ds-border-subtle p-ds-5">
          <h2
            id={titleId}
            className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-danger-fg"
          >
            <AlertTriangle aria-hidden="true" />
            Delete User?
          </h2>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            <X size={20} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="p-ds-5" id={descriptionId}>
          <p className="mb-ds-2 text-ds-content-secondary">
            Are you sure you want to delete <strong className="font-bold text-ds-content">{userName}</strong>?
          </p>
          <p className="mb-ds-6 text-ds-sm text-ds-content-secondary">
            This is a destructive action. It will permanently delete the user's login, their user profile, and all their company memberships.
            This cannot be undone.
          </p>
          {error && (
            <p
              id="delete-user-error"
              role="alert"
              className="mb-ds-4 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3 text-ds-sm text-ds-status-danger-fg"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-ds-4 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={loading}>
            {loading ? 'Deleting...' : 'Delete User'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
