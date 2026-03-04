import React, { useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { getCompanyProfile } from '@features/companies';
import { Briefcase, LogOut } from 'lucide-react';

export function CompanyChooserModal() {
  const [loading, setLoading] = useState(true);
  const [companyDataList, setCompanyDataList] = useState([]);
  const [error, setError] = useState('');

  const { currentUserClaims, loginToCompany, handleLogout } = useData();

  useEffect(() => {
    async function fetchCompanyData() {
      if (!currentUserClaims || !currentUserClaims.roles) {
        setError("Could not find user roles.");
        setLoading(false);
        return;
      }

      const companyRoles = { ...currentUserClaims.roles };
      delete companyRoles.globalRole;
      const companyIds = Object.keys(companyRoles);

      if (companyIds.length === 0) {
        setError("User has no company memberships.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const fetchedData = [];
        for (const companyId of companyIds) {
          const companyData = await getCompanyProfile(companyId);
          if (companyData) {
            fetchedData.push({
              id: companyId,
              data: companyData,
              role: companyRoles[companyId]
            });
          }
        }
        setCompanyDataList(fetchedData);
      } catch (err) {
        console.error("Error populating company chooser:", err);
        setError("Could not load your companies.");
      } finally {
        setLoading(false);
      }
    }

    fetchCompanyData();
  }, [currentUserClaims]);

  return (
    <div
      id="choose-company-modal"
      className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200">
        <div className="p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2 text-center">Choose Company</h2>
          <p className="text-gray-600 mb-6 text-center">You have access to multiple companies. Please pick one to continue.</p>

          <div id="company-choice-list" className="space-y-3 max-h-60 overflow-y-auto pr-2">
            {loading && <p className="text-center text-gray-500">Loading companies...</p>}
            {error && <p className="text-red-600 text-center">{error}</p>}

            {!loading && !error && companyDataList.map(company => (
              <button
                key={company.id}
                className="w-full text-left p-4 border border-gray-200 rounded-lg bg-gray-50 hover:bg-white hover:border-blue-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex justify-between items-center transition-all"
                onClick={() => loginToCompany(company.id, company.role)}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                    <Briefcase size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">{company.data.companyName}</h3>
                    <p className="text-sm text-gray-500 capitalize">Your role: {company.role.replace('_', ' ')}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-blue-600">
                  Select &rarr;
                </span>
              </button>
            ))}
          </div>

          <button
            id="logout-button-modal"
            className="w-full text-center mt-6 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
            onClick={handleLogout}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}