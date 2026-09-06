import React, { useId, useState } from 'react';
import { httpsCallable } from "firebase/functions";
import { functions } from '@lib/firebase';
import { Icon, AlertTriangle, X } from '@design-system/icons';
import { Button, IconButton, Notice } from '@/design-system/components';
import { Modal } from '@design-system/patterns';

/**
 * Destructive confirmation for deleting a company.
 *
 * Migrated to the approved accessible `Modal` 2026-07-28. Presentation only — the
 * `deleteCompany` callable name and its `{ companyId }` payload, the
 * `onConfirm()` → `onClose()` order, and every frozen string are unchanged.
 *
 * Fixed here:
 *  - The hand-built `fixed inset-0` overlay had no dialog semantics, no focus
 *    trap, no Escape handling and no focus restoration, so keyboard users could
 *    Tab straight out of a destructive confirmation into the page behind it.
 *    The approved `Modal` owns all of that now.
 *  - The close control was an icon-only raw `<button>` with no accessible name.
 *  - The failure message was plain text and so was never announced; it is now
 *    `role="alert"`.
 *  - `closeOnBackdrop` is off: a stray click outside a destructive confirmation
 *    should not dismiss it. Escape is likewise suppressed while the delete is
 *    in flight, so the dialog cannot be dismissed mid-request.
 */
export function DeleteCompanyModal({ companyId, companyName, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  const handleDelete = async () => {
    setLoading(true);
    setError('');

    try {
      const deleteCompany = httpsCallable(functions, 'deleteCompany');
      await deleteCompany({ companyId: companyId });
      await onConfirm();
      onClose();
    } catch (err) {
      console.error("Error deleting company:", err);
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
      size="lg"
    >
      <div id="delete-company-modal">
        <header className="flex items-center justify-between border-b border-ds-border-subtle p-ds-5">
          <h2
            id={titleId}
            className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-danger-fg"
          >
            {/* Bare in lucide rendered 24, so `2xl` keeps what is on screen. */}
            <Icon icon={AlertTriangle} size="2xl" />
            Delete Company?
          </h2>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            <Icon icon={X} size="xl" />
          </IconButton>
        </header>

        <div className="p-ds-5" id={descriptionId}>
          <p className="mb-ds-2 text-ds-content-secondary">
            Are you sure you want to delete <strong className="font-bold text-ds-content">{companyName}</strong>?
          </p>
          <p className="mb-ds-6 text-ds-sm text-ds-content-secondary">
            This is a destructive action. It will permanently delete the company, all its users, all applications, and all associated files.
            This cannot be undone.
          </p>
          {error && (
            <Notice
              id="delete-company-error"
              announce="assertive"
              tone="danger"
              size="sm"
              className="mb-ds-4"
            >
              {error}
            </Notice>
          )}
        </div>

        <footer className="flex justify-end gap-ds-4 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={loading}>
            {loading ? 'Deleting...' : 'Delete Company'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
