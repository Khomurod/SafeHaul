import React, { useId, useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { doc, getDoc } from "firebase/firestore";
import { X } from 'lucide-react';
import { Button, IconButton } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

import { EditUserNameForm } from '../users/EditUserNameForm';
import { UserMembershipsManager } from '../users/UserMembershipsManager';

/**
 * Super Admin user editor: name/email form plus the memberships manager.
 *
 * Migrated to the shared accessible `Modal` 2026-07-28. Presentation only — the
 * `users/{userId}` read, the `companyId || Object.keys(allCompaniesMap)[0] || null`
 * fallback passed to `EditUserNameForm`, and the `onSave` wiring into both
 * children are unchanged. The `edit-user-modal` and `edit-user-close-btn` ids are
 * preserved because existing selectors depend on them.
 *
 * Fixed here:
 *  - Hand-built overlay replaced by the shared `Modal` (dialog semantics, focus
 *    trap, Escape, focus restoration).
 *  - Unnamed icon-only close control.
 *  - The loading state was a bare `<div>` with no live-region semantics, so
 *    nothing was announced while the user record was being fetched.
 *  - Long content now scrolls inside the panel rather than growing the dialog
 *    past the viewport on short screens.
 */
export function EditUserModal({ userId, companyId, allCompaniesMap, onClose, onSave }) {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const titleId = useId();

  const fetchUserData = async () => {
    setLoading(true);
    try {
      const userDoc = await getDoc(doc(db, "users", userId));
      if (userDoc.exists()) {
        setUserData(userDoc.data());
      }
    } catch (error) {
      console.error("Error fetching user data for modal:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div id="edit-user-modal" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle p-ds-5">
          <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Edit User</h2>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </IconButton>
        </header>

        {loading || !userData ? (
          <p role="status" className="p-ds-6 text-center text-ds-content-muted">
            Loading user data...
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-ds-6 overflow-y-auto bg-ds-surface-subtle p-ds-5">

            {/* 1. Name and Email Form */}
            <EditUserNameForm
              userId={userId}
              initialName={userData.name}
              email={userData.email}
              companyId={companyId || Object.keys(allCompaniesMap || {})[0] || null}
              onSave={onSave}
            />

            {/* 2. Memberships Manager */}
            <UserMembershipsManager
              userId={userId}
              allCompaniesMap={allCompaniesMap}
              onDataUpdate={onSave} // onDataUpdate updates the main dashboard list
            />
          </div>
        )}

        <footer className="flex shrink-0 justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
          <Button id="edit-user-close-btn" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
