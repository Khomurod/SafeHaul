import { useState, useMemo } from 'react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';

export function useDriverSearch() {
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedState, setSelectedState] = useState("");
  const [statusFilter, setStatusFilter] = useState('actively_looking');
  
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const toggleType = (value) => {
      if (value === 'CLEAR_ALL') {
        setSelectedTypes([]);
        return;
      }
      if (selectedTypes.includes(value)) {
        setSelectedTypes(selectedTypes.filter(t => t !== value));
      } else {
          setSelectedTypes([...selectedTypes, value]);
      }
  };

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    setCurrentPage(1);

    try {
      const driversRef = collection(db, "drivers");
      const constraints = [];
      
      if (statusFilter) {
        constraints.push(where("driverProfile.availability", "==", statusFilter));
      }
      
      if (selectedTypes.length > 0) {
        constraints.push(where("driverProfile.type", "in", selectedTypes));
      }
      
      constraints.push(orderBy("createdAt", "desc"));
      constraints.push(limit(500)); 

      const q = query(driversRef, ...constraints);
      const snapshot = await getDocs(q);
      
      let foundDrivers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (selectedState) {
          foundDrivers = foundDrivers.filter(driver => 
             driver.personalInfo?.state?.toUpperCase() === selectedState
          );
      }

      setResults(foundDrivers);
      
      if (foundDrivers.length === 0) {
          setError("No drivers found matching your criteria.");
      }

    } catch (e) {
      console.error("Search error:", e);
      setError("Search failed. Ensure you have created the required Index in Firebase Console.");
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(results.length / itemsPerPage);
  const paginatedData = useMemo(() => {
      const start = (currentPage - 1) * itemsPerPage;
      return results.slice(start, start + itemsPerPage);
  }, [results, currentPage, itemsPerPage]);

  return {
      selectedTypes,
      selectedState, setSelectedState,
      statusFilter, setStatusFilter,
      results,
      loading,
      error,
      currentPage, setCurrentPage,
      itemsPerPage, setItemsPerPage,
      paginatedData,
      totalPages,
      
      toggleType,
      handleSearch
  };
}
