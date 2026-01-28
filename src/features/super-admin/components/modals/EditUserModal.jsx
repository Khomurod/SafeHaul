import React, { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { doc, getDoc } from "firebase/firestore";
import { X } from 'lucide-react';

import { EditUserNameForm } from '../users/EditUserNameForm';
import { UserMembershipsManager } from '../users/UserMembershipsManager';

export function EditUserModal({ userId, companyId, allCompaniesMap, onClose, onSave }) {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);

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
    <div id="edit-user-modal" className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200">
        <header className="p-5 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Edit User</h2>
          <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        {loading || !userData ? (
          <div className="p-6 text-center text-gray-500">Loading user data...</div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-6 bg-gray-50">

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

        <footer className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end items-center rounded-b-xl">
          <button id="edit-user-close-btn" className="px-5 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}