// src/context/DataContext.jsx
import React, { useState, useEffect, useContext, createContext, useCallback, useRef } from 'react';
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from '@lib/firebase';
import { doc, getDoc, collection, getCountFromServer } from 'firebase/firestore';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { CompanyChooserModal } from '@shared/components/modals';
import { RoleSelectionModal } from '@shared/components/modals/RoleSelectionModal';

export const DataContext = createContext();

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

  // P0 FIX: Auth version counter prevents stale async callbacks from overwriting logout state
  const authVersionRef = useRef(0);

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
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // P0 FIX: Increment version on every auth state change. If another callback fires
      // while we're awaiting, the old callback will detect version mismatch and bail.
      const thisVersion = ++authVersionRef.current;

      try {
        if (user) {
          // P0 FIX: Set loading true on subsequent auth changes to prevent stale renders
          setLoading(true);

          // 1. Get Claims
          const idTokenResult = await user.getIdTokenResult();
          if (authVersionRef.current !== thisVersion) return; // Stale — bail

          const claims = idTokenResult.claims;

          const roles = claims.roles || {};
          const companyRoleKeys = Object.keys(roles).filter(k => k !== 'globalRole');

          // P1 FIX: Removed client-side super admin email fallback — only trust Firebase Custom Claims
          const isSuperAdmin = claims.globalRole === 'super_admin' || roles.globalRole === 'super_admin';

          const hasCompanyRoles = companyRoleKeys.length > 0;

          // 2. Check Driver Profile
          const driverDoc = await getDoc(doc(db, "drivers", user.uid));
          if (authVersionRef.current !== thisVersion) return; // Stale — bail

          const isDriver = driverDoc.exists();

          // Only set state if this is still the current auth version
          setCurrentUser(user);
          setCurrentUserClaims(claims);
          setHasDriverProfile(isDriver);
          setHasEmployerProfile(isSuperAdmin || hasCompanyRoles);

          // 3. Cache Platform Stats (Super Admin Only)
          if (isSuperAdmin) {
            try {
              const [companiesSnap, driversSnap] = await Promise.all([
                getCountFromServer(collection(db, "companies")),
                getCountFromServer(collection(db, "drivers"))
              ]);
              if (authVersionRef.current !== thisVersion) return;
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

          // 4. Determine Initial State / Redirection
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
              // P2 FIX: Surface the actual granular role instead of always 'company_admin'
              const firstCompanyKey = companyRoleKeys[0];
              const actualRole = roles[firstCompanyKey] || 'company_admin';
              setUserRole(actualRole);
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
            // P2 FIX: Surface the actual granular role
            const firstCompanyKey = companyRoleKeys[0];
            const actualRole = roles[firstCompanyKey] || 'company_admin';
            setUserRole(actualRole);
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
            // Fallback for users with no clear role yet
            setUserRole('driver');
            setSelectedPortal('driver');
          }

        } else {
          // No User — clean up all state
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
          localStorage.removeItem('platformStats');
        }
      } catch (error) {
        console.error("Error initializing user data:", error);
      } finally {
        if (authVersionRef.current === thisVersion) {
          setLoading(false);
        }
      }
    });

    return () => {
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
      // P2 FIX: Use the actual role from claims instead of always 'company_admin'
      const roles = currentUserClaims?.roles || {};
      const companyRoleKeys = Object.keys(roles).filter(k => k !== 'globalRole');
      const firstCompanyKey = companyRoleKeys[0];
      const actualRole = roles[firstCompanyKey] || 'company_admin';
      setUserRole(actualRole);
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
          <SafeHaulLoader size="h-20 w-20" className="mx-auto mb-4" />
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

      {currentUser && showCompanyChooser && !loading && userRole === 'company_admin' && !showRoleSelection && (
        <CompanyChooserModal />
      )}
    </DataContext.Provider>
  );
}