// src/context/DataContext.jsx
import React, { useState, useEffect, useContext, createContext, useCallback } from 'react';
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from '@lib/firebase';
import { doc, getDoc, collection, getCountFromServer } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { CompanyChooserModal } from '@shared/components/modals';
import { RoleSelectionModal } from '@shared/components/modals/RoleSelectionModal';

const DataContext = createContext();

export const useData = () => {
    const context = useContext(DataContext);
    if (!context) {
        throw new Error("useData must be used within a DataProvider");
    }
    return context;
};

export function DataProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserClaims, setCurrentUserClaims] = useState(null);
  const [userRole, setUserRole] = useState(null);
  
  const [currentCompanyProfile, setCurrentCompanyProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCompanyChooser, setShowCompanyChooser] = useState(false);
  
  const [hasDriverProfile, setHasDriverProfile] = useState(false);
  const [hasEmployerProfile, setHasEmployerProfile] = useState(false);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [selectedPortal, setSelectedPortal] = useState(null);

  const loginToCompany = useCallback(async (companyId, role, isAutoLogin = false) => {
    if (!isAutoLogin) setLoading(true);
    try {
      const companyDoc = await getDoc(doc(db, "companies", companyId));
      if (companyDoc.exists()) {
        const companyData = { id: companyDoc.id, ...companyDoc.data() };
        setCurrentCompanyProfile(companyData);
        localStorage.setItem('selectedCompanyId', companyId);
        setShowCompanyChooser(false);
      } else {
        console.warn("Saved company ID no longer exists.");
        localStorage.removeItem('selectedCompanyId');
        if (isAutoLogin) setShowCompanyChooser(true);
      }
    } catch (error) {
      console.error("Error logging into company:", error);
      localStorage.removeItem('selectedCompanyId');
    } finally {
      if (!isAutoLogin) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
        setLoading((prev) => {
            if (prev) {
                console.warn("Safety timer triggered: Force stopping loading state.");
                return false;
            }
            return prev;
        });
    }, 8000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        try {
          const idTokenResult = await user.getIdTokenResult();
          const claims = idTokenResult.claims;
          setCurrentUserClaims(claims);

          const roles = claims.roles || {};
          const companyRoleKeys = Object.keys(roles).filter(k => k !== 'globalRole');
          
          const isSuperAdmin = claims.globalRole === 'super_admin' || roles.globalRole === 'super_admin';
          const hasCompanyRoles = companyRoleKeys.length > 0;
          
          const driverDoc = await getDoc(doc(db, "drivers", user.uid));
          const isDriver = driverDoc.exists();
          
          setHasDriverProfile(isDriver);
          setHasEmployerProfile(isSuperAdmin || hasCompanyRoles);
          
          console.log('[DataContext] User claims:', claims);
          console.log('[DataContext] Profile detection:', { isDriver, hasCompanyRoles, isSuperAdmin });

          // Cache platform stats for login page display (only for super admins who have permission)
          if (isSuperAdmin) {
            try {
              const [companiesSnap, driversSnap] = await Promise.all([
                getCountFromServer(collection(db, "companies")),
                getCountFromServer(collection(db, "drivers"))
              ]);
              const platformStats = {
                companies: companiesSnap.data().count || 0,
                drivers: driversSnap.data().count || 0,
                updatedAt: Date.now()
              };
              localStorage.setItem('platformStats', JSON.stringify(platformStats));
            } catch (statsErr) {
              console.warn("Could not cache platform stats:", statsErr);
            }
          }

          const savedPortal = localStorage.getItem('selectedPortal');
          
          if (isSuperAdmin) {
            setUserRole('super_admin');
            setSelectedPortal('employer');
            
            const savedCompanyId = localStorage.getItem('selectedCompanyId');
            if (savedCompanyId) {
              await loginToCompany(savedCompanyId, null, true);
            }
          } else if (isDriver && hasCompanyRoles) {
            if (savedPortal === 'driver') {
              setUserRole('driver');
              setSelectedPortal('driver');
            } else if (savedPortal === 'employer') {
              setUserRole('admin');
              setSelectedPortal('employer');
              
              const savedCompanyId = localStorage.getItem('selectedCompanyId');
              if (savedCompanyId) {
                await loginToCompany(savedCompanyId, null, true);
              } else {
                setShowCompanyChooser(true);
              }
            } else {
              setShowRoleSelection(true);
              setUserRole(null);
            }
          } else if (hasCompanyRoles) {
            setUserRole('admin');
            setSelectedPortal('employer');
            
            const savedCompanyId = localStorage.getItem('selectedCompanyId');
            if (savedCompanyId) {
              await loginToCompany(savedCompanyId, null, true);
            } else {
              setShowCompanyChooser(true);
            }
          } else if (isDriver) {
            setUserRole('driver');
            setSelectedPortal('driver');
          } else {
            setUserRole('driver');
            setSelectedPortal('driver');
          }
          
        } catch (e) {
          console.error("Error initializing user data:", e);
        }
      } else {
        setCurrentUser(null);
        setCurrentUserClaims(null);
        setCurrentCompanyProfile(null);
        setUserRole(null);
        setShowCompanyChooser(false);
        setHasDriverProfile(false);
        setHasEmployerProfile(false);
        setShowRoleSelection(false);
        setSelectedPortal(null);
        localStorage.removeItem('selectedCompanyId');
        localStorage.removeItem('selectedPortal');
      }
      
      setLoading(false);
    });

    return () => {
        clearTimeout(safetyTimer);
        unsubscribe();
    };
  }, [loginToCompany]);

  const handlePortalSelection = async (portal) => {
    setSelectedPortal(portal);
    localStorage.setItem('selectedPortal', portal);
    setShowRoleSelection(false);
    
    if (portal === 'driver') {
      setUserRole('driver');
      window.location.href = '/driver/dashboard';
    } else {
      setUserRole('admin');
      const savedCompanyId = localStorage.getItem('selectedCompanyId');
      if (savedCompanyId) {
        await loginToCompany(savedCompanyId, null, true);
        window.location.href = '/company/dashboard';
      } else {
        setShowCompanyChooser(true);
      }
    }
  };

  const switchPortal = () => {
    localStorage.removeItem('selectedPortal');
    setSelectedPortal(null);
    setUserRole(null);
    setShowRoleSelection(true);
  };

  const handleLogout = async () => {
    try {
        await auth.signOut();
        localStorage.removeItem('selectedCompanyId');
        localStorage.removeItem('selectedPortal');
        window.location.href = '/login';
    } catch (e) {
        console.error("Logout failed", e);
    }
  };

  const returnToCompanyChooser = () => {
    setCurrentCompanyProfile(null);
    localStorage.removeItem('selectedCompanyId');
    setShowCompanyChooser(true);
  };

  if (loading) {
    return (
        <div className="h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <Loader2 className="animate-spin text-blue-600 mx-auto mb-4" size={48} />
                <p className="text-gray-500 font-medium">Loading Platform...</p>
            </div>
        </div>
    );
  }

  const contextValue = {
    currentUser,
    currentUserClaims,
    userRole,
    currentCompanyProfile,
    setCurrentCompanyProfile,
    loginToCompany,
    handleLogout,
    returnToCompanyChooser,
    setShowCompanyChooser,
    loading,
    setLoading,
    hasDriverProfile,
    hasEmployerProfile,
    selectedPortal,
    switchPortal,
    canSwitchPortals: hasDriverProfile && hasEmployerProfile
  };

  return (
    <DataContext.Provider value={contextValue}>
      {children}
      
      {currentUser && showRoleSelection && !loading && (
        <RoleSelectionModal onSelect={handlePortalSelection} />
      )}
      
      {currentUser && showCompanyChooser && !loading && userRole === 'admin' && !showRoleSelection && (
         <CompanyChooserModal />
      )}
    </DataContext.Provider>
  );
}
