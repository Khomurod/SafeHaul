import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { db } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useDriverSearch } from '../hooks/useDriverSearch';
import { useData } from '@/context/DataContext';

import { DriverProfileView } from './DriverProfileView';
import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { SearchFilters } from './search/SearchFilters';
import { SearchResults } from './search/SearchResults';

export function DriverSearchModal({ onClose }) {
  const { currentCompanyProfile } = useData();
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [callModalData, setCallModalData] = useState(null);
  
  const {
      selectedTypes, toggleType,
      selectedState, setSelectedState,
      statusFilter, 
      results, loading, error,
      currentPage, setCurrentPage,
      itemsPerPage, setItemsPerPage,
      paginatedData, totalPages,
      handleSearch
  } = useDriverSearch();

  const handleSearchClick = () => {
      setSelectedDriver(null);
      handleSearch();
  };

  const handleCallClick = (driver) => {
      const pi = driver.personalInfo || {};
      const dp = driver.driverProfile || {};
      
      const flatLead = {
          id: driver.id, 
          firstName: pi.firstName,
          lastName: pi.lastName,
          phone: pi.phone,
          email: pi.email,
          driverType: dp.type,
          isPlatformLead: true, 
          source: 'Search DB Call',
          status: 'Attempted' 
      };
      setCallModalData({ lead: flatLead });
  };

  const handleDataUpdate = async () => {
      handleSearch();
      if (selectedDriver) {
          try {
              const docRef = doc(db, 'drivers', selectedDriver.id);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                  setSelectedDriver({ id: docSnap.id, ...docSnap.data() });
              }
          } catch (e) {
              console.error("Failed to refresh driver data:", e);
          }
      }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
    <div className="bg-white w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">

      <div className="flex items-center justify-between p-5 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-indigo-700 text-white shrink-0">
        <div className="flex items-center gap-3">
          <Search size={24}/>
          <h2 className="text-xl font-bold">Driver Search</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition">
          <X size={24}/>
        </button>
      </div>

      {selectedDriver ? (
        <DriverProfileView 
            driver={selectedDriver} 
            onBack={() => setSelectedDriver(null)}
            onCallStart={() => handleCallClick(selectedDriver)}
        />
      ) : (
        <>
          <SearchFilters
            selectedTypes={selectedTypes}
            toggleType={toggleType}
            selectedState={selectedState}
            setSelectedState={setSelectedState}
            loading={loading}
            onSearch={handleSearchClick}
          />
          <SearchResults
            results={results}
            paginatedData={paginatedData}
            loading={loading}
            error={error}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            itemsPerPage={itemsPerPage}
            setItemsPerPage={setItemsPerPage}
            totalPages={totalPages}
            onCallClick={handleCallClick}
            onViewClick={setSelectedDriver}
          />
        </>
      )}

      {callModalData && (
        <CallOutcomeModal
          lead={callModalData.lead}
          onClose={() => setCallModalData(null)}
          onDataUpdate={handleDataUpdate}
        />
      )}
    </div>
    </div>
  );
}
