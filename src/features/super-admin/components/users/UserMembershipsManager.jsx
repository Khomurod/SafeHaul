import React, { useState, useEffect, useMemo } from 'react';
import { 
  getMembershipsForUser,
  addMembership,
  updateMembershipRole,
  deleteMembership
} from '@features/auth/services/userService';
import { Trash2, Plus, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

// --- MembershipItem Component ---
function MembershipItem({ membership, companyName, onUpdate, onRemove }) {
  const [currentRole, setCurrentRole] = useState(membership.role);
  const [loading, setLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);

  const handleRoleChange = async (e) => {
    const newRole = e.target.value;
    setLoading(true);
    try {
      await updateMembershipRole(membership.id, newRole);
      setCurrentRole(newRole);
      onUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Error updating role:", error);
      alert(`Failed to update role: ${error.message}\nEnsure you are logged in as Super Admin.`);
      e.target.value = currentRole; // Revert on error
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove access to ${companyName}?`)) return;
    setRemoveLoading(true);
    try {
      await deleteMembership(membership.id);
      onRemove(); // Re-render modal list
      onUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Error removing membership:", error);
      alert(`Failed to remove: ${error.message}`);
      setRemoveLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200">
      <div className="flex-1">
        <strong className="font-medium text-gray-800 block">{companyName}</strong>
        <span className="text-xs text-gray-400">ID: {membership.companyId}</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="p-2 border border-gray-300 rounded-lg bg-white text-sm"
          value={currentRole}
          onChange={handleRoleChange}
          disabled={loading || removeLoading}
        >
          <option value="hr_user">HR User</option>
          <option value="company_admin">Company Admin</option>
        </select>
        <button
          className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-sm disabled:opacity-50"
          onClick={handleRemove}
          disabled={loading || removeLoading}
          title="Remove Membership"
        >
          {removeLoading ? <div className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin"></div> : <Trash2 size={16} />}
        </button>
      </div>
    </div>
  );
}

// --- UserMembershipsManager Component ---
export function UserMembershipsManager({ userId, allCompaniesMap, onDataUpdate }) {
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addCompanyId, setAddCompanyId] = useState('');
  const [addRole, setAddRole] = useState('hr_user');
  const [addError, setAddError] = useState('');

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
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-gray-700">Access & Permissions</h3>
        <button onClick={renderUserMemberships} className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-blue-50 transition-colors" title="Refresh List">
            <RefreshCw size={16} />
        </button>
      </div>

      {/* Membership List */}
      <div id="edit-user-memberships-list" className="space-y-3 mb-4 max-h-48 overflow-y-auto p-1">
        {loading ? (
          <p className="text-center text-gray-500 py-4 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading...
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
          <div className="text-center p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-500 text-sm">No active memberships.</p>
            <p className="text-xs text-gray-400 mt-1">This user cannot access any company data.</p>
          </div>
        )}
      </div>

      {/* Add New Membership Form */}
      <form id="add-membership-form" className="flex items-end gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200" onSubmit={handleAddMembership}>
        <div className="flex-1">
          <label htmlFor="add-membership-company" className="block text-xs font-bold text-gray-500 uppercase mb-1">Add to Company</label>
          <select id="add-membership-company" className="w-full p-2 text-sm border border-gray-300 rounded-lg bg-white" required value={addCompanyId} onChange={(e) => setAddCompanyId(e.target.value)} disabled={availableCompanies.length === 0}>
            <option value="">Select Company...</option>
            {availableCompanies.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <div className="w-1/3">
          <label htmlFor="add-membership-role" className="block text-xs font-bold text-gray-500 uppercase mb-1">Role</label>
          <select id="add-membership-role" className="w-full p-2 text-sm border border-gray-300 rounded-lg bg-white" required value={addRole} onChange={(e) => setAddRole(e.target.value)}>
            <option value="hr_user">HR User</option>
            <option value="company_admin">Admin</option>
          </select>
        </div>
        <button type="submit" className="p-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-sm" disabled={availableCompanies.length === 0} title="Grant Access">
          <Plus size={20} />
        </button>
      </form>

      {addError && (
        <div className="mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{addError}</span>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3 text-center">
        Note: Users may need to log out and log back in for new permissions to apply.
      </p>
    </div>
  );
}