import React, { useState, useEffect } from 'react';
import { loadCompanies } from '@features/companies/services/companyService';
import { deleteApplication, moveApplication } from '@features/applications/services/applicationService';
import { AlertTriangle, ArrowRight, X, Loader2 } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function MoveApplicationModal({
  sourceCompanyId,
  applicationId,
  onClose,
  onMoveComplete
}) {
  const [loading, setLoading] = useState(true);
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [destinationCompanyId, setDestinationCompanyId] = useState('');
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    async function fetchCompanies() {
      try {
        const snap = await loadCompanies();
        const companies = snap.docs
          .map(doc => ({ id: doc.id, name: doc.data().companyName }))
          .filter(c => c.id !== sourceCompanyId);
        setAvailableCompanies(companies);
        if (companies.length > 0) setDestinationCompanyId(companies[0].id);
      } catch (error) {
        showError('Failed to load company list.');
      } finally {
        setLoading(false);
      }
    }
    fetchCompanies();
  }, [sourceCompanyId, showError]);

  const handleMove = async () => {
    if (!destinationCompanyId || destinationCompanyId === sourceCompanyId) {
      showError('Please select a different company.');
      return;
    }
    setLoading(true);

    try {
      await moveApplication(
        sourceCompanyId,
        destinationCompanyId,
        applicationId
      );
      showSuccess(`Successfully moved to ${availableCompanies.find(c => c.id === destinationCompanyId)?.name}!`);
      setTimeout(() => {
        onMoveComplete();
      }, 1000);
    } catch (error) {
      console.error("Move failed:", error);
      showError(error.message || 'Application move failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-[60] backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200" onClick={e => e.stopPropagation()}>
        <header className="p-5 border-b border-gray-200 flex items-center gap-3">
          <ArrowRight className="text-blue-600" size={24} />
          <h2 className="text-xl font-bold text-gray-800">Move Application</h2>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-gray-700">Select the destination company for this application.</p>

          {loading ? (
            <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" size={16} /> Loading...</div>
          ) : availableCompanies.length === 0 ? (
            <p className="text-red-600">No other companies available.</p>
          ) : (
            <div>
              <label htmlFor="destination-company" className="block text-sm font-medium text-gray-700 mb-1">Destination Company</label>
              <select
                id="destination-company"
                className="w-full p-3 border border-gray-300 rounded-lg bg-white"
                value={destinationCompanyId}
                onChange={(e) => setDestinationCompanyId(e.target.value)}
              >
                {availableCompanies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 rounded-b-xl">
          <button className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all"
            onClick={handleMove}
            disabled={loading || availableCompanies.length === 0}
          >
            {loading ? 'Moving...' : 'Move Application'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function DeleteConfirmModal({
  appName,
  companyId,
  applicationId,
  collectionName,
  onClose,
  onDeletionComplete
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showSuccess, showError } = useToast();

  const handleDelete = async () => {
    setLoading(true);
    setError('');
    try {
      await deleteApplication(companyId, applicationId, collectionName);

      showSuccess("Record deleted successfully.");
      setTimeout(() => {
        onDeletionComplete();
      }, 500);

    } catch (err) {
      console.error("Error deleting application:", err);
      const msg = err.code === 'permission-denied'
        ? "Permission Denied. Check database rules."
        : (err.message || 'Failed to delete application.');

      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-[60] backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200" onClick={e => e.stopPropagation()}>
        <header className="p-5 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-red-700 flex items-center gap-2">
            <AlertTriangle />
            Confirm Deletion
          </h2>
          <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="p-5">
          <p className="text-gray-600 mb-4">
            Are you sure you want to permanently delete the record for <strong className="font-bold text-gray-900">{appName}</strong>?
            <br /><br />
            This action cannot be undone.
          </p>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700 mb-4">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
        </div>
        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 rounded-b-xl">
          <button className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-all flex items-center gap-2"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : null}
            {loading ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </footer>
      </div>
    </div>
  );
}
