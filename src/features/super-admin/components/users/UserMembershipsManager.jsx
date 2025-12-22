import React, { useState, useEffect, useMemo } from 'react';
import { 
  getMembershipsForUser,
  addMembership,
  updateMembershipRole,
  deleteMembership
} from '@features/auth/services/userService';
import { Trash2, Plus } from 'lucide-react';

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
      e.target.value = currentRole; // Revert on error
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setRemoveLoading(true);
    try {
      await deleteMembership(membership.id);
      onRemove(); // Re-render modal list
      onUpdate(); // Refresh main user list
    } catch (error) {
      console.error("Error removing membership:", error);
      setRemoveLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200">
      <div>
        <strong className="font-medium text-gray-800">{companyName}</strong>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="w-full p-2 border border-gray-300 rounded-lg bg-white"
          value={currentRole}
          onChange={handleRoleChange}
          disabled={loading || removeLoading}
        >
          <option value="hr_user">HR User</option>
          <option value="company_admin">Company Admin</option>
        </select>
        <button
          className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm disabled:opacity-50"
          onClick={handleRemove}
          disabled={loading || removeLoading}
          title="Remove Membership"
        >
          {removeLoading ? <div className="w-5 h-5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin"></div> : <Trash2 size={18} />}
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
      setAddError(error.message);
    }
  };

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-700 mb-3">Company Memberships</h3>

      {/* Membership List */}
      <div id="edit-user-memberships-list" className="space-y-3 mb-4 max-h-48 overflow-y-auto p-1">
        {loading ? (
          <p className="text-center text-gray-500 py-4">Loading memberships...</p>
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
          <p className="text-gray-500 italic text-center p-4">This user has no company memberships.</p>
        )}
      </div>

      {/* Add New Membership Form */}
      <form id="add-membership-form" className="flex items-end gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200" onSubmit={handleAddMembership}>
        <div className="flex-1">
          <label htmlFor="add-membership-company" className="block text-sm font-medium text-gray-700 mb-1">Add to Company</label>
          <select id="add-membership-company" className="w-full p-3 border border-gray-300 rounded-lg bg-white" required value={addCompanyId} onChange={(e) => setAddCompanyId(e.target.value)} disabled={availableCompanies.length === 0}>
            <option value="">Select a company</option>
            {availableCompanies.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="add-membership-role" className="block text-sm font-medium text-gray-700 mb-1">As Role</label>
          <select id="add-membership-role" className="w-full p-3 border border-gray-300 rounded-lg bg-white" required value={addRole} onChange={(e) => setAddRole(e.target.value)}>
            <option value="hr_user">HR User</option>
            <option value="company_admin">Company Admin</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-all shadow-md" disabled={availableCompanies.length === 0}>
          <Plus size={20} />
        </button>
      </form>
      {addError && <p className="text-sm text-red-600 mt-2">{addError}</p>}
    </div>
  );
}