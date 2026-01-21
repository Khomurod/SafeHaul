import React, { useState } from 'react';
import { httpsCallable } from "firebase/functions";
import { functions } from '@lib/firebase';
import { AlertTriangle, X } from 'lucide-react';

export function DeleteCompanyModal({ companyId, companyName, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    <div id="delete-company-modal" className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200">
        <header className="p-5 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-red-700 flex items-center gap-2">
            <AlertTriangle />
            Delete Company?
          </h2>
          <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="p-5">
          <p className="text-gray-600 mb-2">
            Are you sure you want to delete <strong className="font-bold text-gray-900">{companyName}</strong>?
          </p>
          <p className="text-sm text-gray-600 mb-6">
            This is a destructive action. It will permanently delete the company, all its users, all applications, and all associated files. This cannot be undone.
          </p>
          {error && <p id="delete-company-error" className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded-lg border border-red-200">{error}</p>}
        </div>

        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-4 rounded-b-xl">
          <button className="px-5 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="px-5 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-all shadow-md" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete Company'}
          </button>
        </footer>
      </div>
    </div>
  );
}
