import React, { useState, useEffect, useId, useMemo } from 'react';
import {
  getMembershipsForUser,
  addMembership,
  updateMembershipRole,
  deleteMembership
} from '@features/auth/services/userService';
import { Trash2, Plus, AlertCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  Button, Card, FieldMessage, FormField, IconButton, Select, StatusMedallion,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Multi-tenant access editor inside the Super Admin Edit User dialog.
 *
 * Migrated to the design system 2026-07-28, alongside `EditUserNameForm`. Both
 * were missed by the Super Admin dialog pass, which migrated `EditUserModal`'s
 * shell but not the bodies it renders.
 *
 * Presentation only. Frozen and unchanged: `getMembershipsForUser(userId)` and
 * the `{ id, ...doc.data() }` mapping; `addMembership({ userId, companyId, role })`;
 * `updateMembershipRole(membership.id, newRole)`; `deleteMembership(membership.id)`;
 * the `onUpdate` / `onRemove` callback points and their order (remove: list
 * first, then the parent list; add: reset, reload, then the parent list); the
 * `availableCompanies` filter that hides companies the user already belongs to;
 * the `allCompaniesMap.get(...) || 'Unknown Company'` fallback; the two role
 * option sets (note the add-form deliberately labels `company_admin` as "Admin"
 * while the per-row select labels it "Company Admin" — both preserved); and every
 * user-facing string.
 *
 * Defects fixed:
 *  1. **Two blocking `alert()` calls** (role-change failure, remove failure) and
 *     one blocking `window.confirm` (remove access) → announced in-page messages
 *     and a shared accessible dialog. All wording preserved verbatim, including
 *     the embedded newline in the role-change failure text.
 *  2. **Three icon-only controls were named by `title` alone** — "Refresh List",
 *     "Remove Membership" and "Grant Access". A `title` is not a reliable
 *     accessible name and is unreachable by touch. They are now `IconButton`s
 *     with real names, and the remove control names *which* company it removes.
 *  3. **The per-row role `<select>` had no label of any kind** — a screen reader
 *     announced an unnamed combobox per membership row. Each now names its own
 *     company.
 *  4. **The membership list was an unnamed scroll region** (`max-h-48
 *     overflow-y-auto`) with no focusable child in the empty state, so keyboard
 *     users could not scroll it. It is now a named, focusable region.
 *  5. **`text-gray-400` on white = 2.56:1** on the company id, the empty-state
 *     hint and the log-out note — three real contrast failures.
 *  6. **The add-membership error was not announced**, and a hand-built
 *     `border-t-red-600` div spinner stood in for a loading state.
 */

// --- MembershipItem Component ---
function MembershipItem({ membership, companyName, onUpdate, onRemove }) {
  const [currentRole, setCurrentRole] = useState(membership.role);
  const [loading, setLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [error, setError] = useState('');
  // Replaces the blocking `window.confirm` on the destructive remove.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const roleFieldId = useId();

  const handleRoleChange = async (e) => {
    const newRole = e.target.value;
    setLoading(true);
    setError('');
    try {
      await updateMembershipRole(membership.id, newRole);
      setCurrentRole(newRole);
      onUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Error updating role:", error);
      // The select is controlled by `currentRole`, which is left untouched on
      // failure, so React restores the previous value on the next render.
      setError(`Failed to update role: ${error.message}\nEnsure you are logged in as Super Admin.`);
    } finally {
      setLoading(false);
    }
  };

  const confirmRemove = async () => {
    setConfirmingRemove(false);
    setRemoveLoading(true);
    setError('');
    try {
      await deleteMembership(membership.id);
      onRemove(); // Re-render modal list
      onUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Error removing membership:", error);
      setError(`Failed to remove: ${error.message}`);
      setRemoveLoading(false);
    }
  };

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between gap-ds-3">
        <div className="min-w-0 flex-1">
          <strong className="block font-medium text-ds-content">{companyName}</strong>
          <span className="text-ds-xs text-ds-content-secondary">ID: {membership.companyId}</span>
        </div>
        <div className="flex shrink-0 items-center gap-ds-2">
          {/* The role select previously had no label at all. */}
          <label htmlFor={roleFieldId} className="sr-only">{`Role for ${companyName}`}</label>
          <Select
            id={roleFieldId}
            value={currentRole}
            onChange={handleRoleChange}
            disabled={loading || removeLoading}
          >
            <option value="hr_user">HR User</option>
            <option value="company_admin">Company Admin</option>
          </Select>
          <IconButton
            label={`Remove access to ${companyName}`}
            variant="ghost"
            loading={removeLoading}
            disabled={loading || removeLoading}
            onClick={() => setConfirmingRemove(true)}
          >
            <Trash2 size={16} aria-hidden="true" className="text-ds-status-danger-fg" />
          </IconButton>
        </div>
      </div>

      {/* Failures that were previously blocking `alert()`s. */}
      <div role="alert">
        {error && (
          <FieldMessage tone="error" className="mt-ds-2 whitespace-pre-line">{error}</FieldMessage>
        )}
      </div>

      {confirmingRemove && (
        <RemoveMembershipDialog
          companyName={companyName}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={confirmRemove}
        />
      )}
    </Card>
  );
}

/**
 * Replaces the blocking `window.confirm` on removing company access. The
 * question is preserved verbatim.
 */
function RemoveMembershipDialog({ companyName, onCancel, onConfirm }) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Modal
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={descriptionId}
      closeOnBackdrop={false}
      className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div className="p-ds-5 text-center">
        <StatusMedallion tone="danger" className="mx-auto mb-ds-3"><AlertTriangle /></StatusMedallion>
        <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Remove company access?</h2>
        <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
          {`Remove access to ${companyName}?`}
        </p>
      </div>
      <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Remove access</Button>
      </div>
    </Modal>
  );
}

// --- UserMembershipsManager Component ---
export function UserMembershipsManager({ userId, allCompaniesMap, onDataUpdate }) {
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addCompanyId, setAddCompanyId] = useState('');
  const [addRole, setAddRole] = useState('hr_user');
  const [addError, setAddError] = useState('');
  const listRegionId = useId();
  const addCompanyFieldId = useId();
  const addRoleFieldId = useId();

  // Fetch and re-render memberships for the current user
  const renderUserMemberships = async () => {
    setLoading(true);
    try {
      const membershipsSnap = await getMembershipsForUser(userId);
      const userMembers = membershipsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMemberships(userMembers);
    } catch (error) {
      console.error("Error rendering user memberships:", error);
      setAddError("Could not load memberships. Check permissions.");
    }
    setLoading(false);
  };

  useEffect(() => {
    renderUserMemberships();
  }, [userId]);

  const userCompanyIds = useMemo(() => {
    return new Set(memberships.map(m => m.companyId));
  }, [memberships]);

  const availableCompanies = useMemo(() => {
    return Array.from(allCompaniesMap.entries())
      .filter(([id]) => !userCompanyIds.has(id));
  }, [allCompaniesMap, userCompanyIds]);

  const handleAddMembership = async (e) => {
    e.preventDefault();
    setAddError('');
    if (!addCompanyId || !addRole) {
      setAddError('Please select a company and role.');
      return;
    }
    try {
      await addMembership({
        userId: userId,
        companyId: addCompanyId,
        role: addRole
      });
      setAddCompanyId('');
      setAddRole('hr_user');
      await renderUserMemberships(); // Re-render modal list
      onDataUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Add Membership Error:", error);
      setAddError(error.message);
    }
  };

  return (
    <Card padding="md">
      <div className="mb-ds-3 flex items-center justify-between gap-ds-2">
        <h3 id={listRegionId} className="text-ds-heading-sm font-semibold text-ds-content">
          Access &amp; Permissions
        </h3>
        <IconButton label="Refresh membership list" variant="ghost" size="sm" onClick={renderUserMemberships}>
          <RefreshCw size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {/* Membership List */}
      <div
        id="edit-user-memberships-list"
        role="region"
        aria-labelledby={listRegionId}
        tabIndex={0}
        className="mb-ds-4 max-h-48 overflow-y-auto p-1 focus-visible:outline-none focus-visible:shadow-ds-focus"
      >
        <Stack gap="sm">
          {loading ? (
            <p role="status" className="py-ds-4 text-center text-ds-content-secondary">
              Loading...
            </p>
          ) : memberships.length > 0 ? (
            memberships.map(mem => (
              <MembershipItem
                key={mem.id}
                membership={mem}
                companyName={allCompaniesMap.get(mem.companyId) || 'Unknown Company'}
                onUpdate={onDataUpdate}
                onRemove={renderUserMemberships}
              />
            ))
          ) : (
            <div className="rounded-ds-lg border border-dashed border-ds-border p-ds-4 text-center">
              <p className="text-ds-sm text-ds-content-secondary">No active memberships.</p>
              <p className="mt-1 text-ds-xs text-ds-content-secondary">
                This user cannot access any company data.
              </p>
            </div>
          )}
        </Stack>
      </div>

      {/* Add New Membership Form */}
      <form
        id="add-membership-form"
        onSubmit={handleAddMembership}
        className="flex flex-col items-stretch gap-ds-2 rounded-ds-lg border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <FormField id={addCompanyFieldId} label="Add to Company" required>
            <Select
              value={addCompanyId}
              onChange={(e) => setAddCompanyId(e.target.value)}
              disabled={availableCompanies.length === 0}
            >
              <option value="">Select Company...</option>
              {availableCompanies.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="sm:w-1/3">
          <FormField id={addRoleFieldId} label="Role" required>
            <Select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="hr_user">HR User</option>
              <option value="company_admin">Admin</option>
            </Select>
          </FormField>
        </div>
        <IconButton
          type="submit"
          label="Grant access to the selected company"
          variant="primary"
          disabled={availableCompanies.length === 0}
        >
          <Plus size={20} aria-hidden="true" />
        </IconButton>
      </form>

      <div role="alert">
        {addError && (
          <div className="mt-ds-3 flex items-start gap-ds-2 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ds-status-danger-fg" />
            <span className="break-words text-ds-sm text-ds-status-danger-fg">{addError}</span>
          </div>
        )}
      </div>

      <p className="mt-ds-3 text-center text-ds-xs text-ds-content-secondary">
        Note: Users may need to log out and log back in for new permissions to apply.
      </p>
    </Card>
  );
}
