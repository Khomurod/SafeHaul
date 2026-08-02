// src/context/DataContext.jsx
import React, { useState, useEffect, useContext, createContext, useCallback, useRef, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@lib/firebase';
import { doc, getDoc, collection, getCountFromServer } from 'firebase/firestore';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { CompanyChooserModal } from '@shared/components/modals';
import { SESSION_KEYS } from './dataContext/sessionKeys';
import { extractRoleContext, getPrimaryCompanyRole } from './dataContext/claims';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

// D2: split the former mega-context by change-cadence into three memoized
// contexts so consumers re-render only when their slice changes. A single
// provider still owns the (tightly-coupled) auth flow; it publishes three
// independently-memoized values. `DataContext` + `useData()` remain as a
// backwards-compatible shim so the ~47 existing consumers need no changes —
// migrate them to the granular hooks (useAuth/useCompany/useUI) over time.
export const AuthContext = createContext(null);
export const CompanyContext = createContext(null);
export const UIContext = createContext(null);
export const DataContext = createContext();

function useRequiredContext(ctx, name) {
  const value = useContext(ctx);
  if (!value) {
    throw new Error(`${name} must be used within a DataProvider`);
  }
  return value;
}

/** Auth identity / role / portal slice. */
export const useAuth = () => useRequiredContext(AuthContext, 'useAuth');
/** Selected-company slice. */
export const useCompany = () => useRequiredContext(CompanyContext, 'useCompany');
/** UI (modal visibility) slice. */
export const useUI = () => useRequiredContext(UIContext, 'useUI');

/**
 * Backwards-compatible shim exposing the full former surface. Prefer the
 * granular hooks (useAuth/useCompany/useUI) in new code.
 */
export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
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

  // Prevent stale async auth callbacks from overriding state.
  const authVersionRef = useRef(0);

  /** Short TTL cache to avoid duplicate full company reads when navigating quickly. */
  const companyProfileCacheRef = useRef({ companyId: null, data: null, fetchedAt: 0 });
  const COMPANY_PROFILE_CACHE_MS = 60_000;

  const loginToCompany = useCallback(async (companyId, _role, isAutoLogin = false, options = {}) => {
    const forceRefresh = options?.forceRefresh === true;
    if (!isAutoLogin) setLoading(true);
    try {
      const now = Date.now();
      const cache = companyProfileCacheRef.current;
      if (
        !forceRefresh &&
        cache.companyId === companyId &&
        cache.data &&
        now - cache.fetchedAt < COMPANY_PROFILE_CACHE_MS
      ) {
        setCurrentCompanyProfile(cache.data);
        localStorage.setItem(SESSION_KEYS.SELECTED_COMPANY_ID, companyId);
        setShowCompanyChooser(false);
        return;
      }

      const companyDoc = await getDoc(doc(db, 'companies', companyId));
      if (companyDoc.exists()) {
        const companyData = { id: companyDoc.id, ...companyDoc.data() };
        companyProfileCacheRef.current = { companyId, data: companyData, fetchedAt: Date.now() };
        setCurrentCompanyProfile(companyData);
        localStorage.setItem(SESSION_KEYS.SELECTED_COMPANY_ID, companyId);
        setShowCompanyChooser(false);
      } else {
        companyProfileCacheRef.current = { companyId: null, data: null, fetchedAt: 0 };
        console.warn('Saved company ID no longer exists.');
        localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
        if (isAutoLogin) setShowCompanyChooser(true);
      }
    } catch (error) {
      console.error('Error logging into company:', error);
      localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
    } finally {
      if (!isAutoLogin) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isE2ETestMode) {
      const e2eAuthMode = getE2EQueryParam('e2eAuth', 'none');
      const mockCompany = {
        id: 'e2e-company',
        companyName: 'E2E Logistics',
        appSlug: 'e2e-company',
        applicationConfig: {},
      };

      if (e2eAuthMode === 'none') {
        setCurrentUser(null);
        setCurrentUserClaims(null);
        setCurrentCompanyProfile(null);
        setUserRole(null);
        setShowCompanyChooser(false);
        setLoading(false);
        return () => {};
      }

      const mockClaimsByMode = {
        super_admin: { globalRole: 'super_admin', roles: { globalRole: 'super_admin' } },
        company_admin: { roles: { [mockCompany.id]: 'company_admin' } },
      };
      const modeClaims = mockClaimsByMode[e2eAuthMode] || { roles: {} };
      const userRoleByMode = {
        super_admin: 'super_admin',
        company_admin: 'company_admin',
      };
      const userRoleForMode = userRoleByMode[e2eAuthMode] || null;

      setCurrentUser({
        uid: `e2e-${e2eAuthMode}`,
        email: `${e2eAuthMode}@safehaul.local`,
        getIdTokenResult: async () => ({ claims: modeClaims }),
      });
      setCurrentUserClaims(modeClaims);
      setUserRole(userRoleForMode);
      setCurrentCompanyProfile(
        e2eAuthMode === 'company_admin' || e2eAuthMode === 'super_admin' ? mockCompany : null,
      );
      setShowCompanyChooser(false);
      setLoading(false);
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const thisVersion = ++authVersionRef.current;

      try {
        if (!user) {
          setCurrentUser(null);
          setCurrentUserClaims(null);
          setCurrentCompanyProfile(null);
          setUserRole(null);
          setShowCompanyChooser(false);
          localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
          localStorage.removeItem(SESSION_KEYS.PLATFORM_STATS);
          return;
        }

        setLoading(true);

        const idTokenResult = await user.getIdTokenResult();
        if (authVersionRef.current !== thisVersion) return;

        const claims = idTokenResult.claims;
        const { roles, hasCompanyRoles, isSuperAdmin } = extractRoleContext(claims);

        setCurrentUser(user);
        setCurrentUserClaims(claims);

        if (isSuperAdmin) {
          try {
            const [companiesSnap, driversSnap] = await Promise.all([
              getCountFromServer(collection(db, 'companies')),
              getCountFromServer(collection(db, 'drivers')),
            ]);
            if (authVersionRef.current !== thisVersion) return;
            const platformStats = {
              companies: companiesSnap.data().count || 0,
              drivers: driversSnap.data().count || 0,
              updatedAt: Date.now(),
            };
            localStorage.setItem(SESSION_KEYS.PLATFORM_STATS, JSON.stringify(platformStats));
          } catch (statsErr) {
            console.warn('Could not cache platform stats:', statsErr);
          }
        }

        if (isSuperAdmin) {
          setUserRole('super_admin');
          const savedCompanyId = localStorage.getItem(SESSION_KEYS.SELECTED_COMPANY_ID);
          if (savedCompanyId) {
            await loginToCompany(savedCompanyId, null, true);
          }
          return;
        }

        if (hasCompanyRoles) {
          setUserRole(getPrimaryCompanyRole(claims));
          const savedCompanyId = localStorage.getItem(SESSION_KEYS.SELECTED_COMPANY_ID);
          if (savedCompanyId) {
            await loginToCompany(savedCompanyId, null, true);
          } else {
            setShowCompanyChooser(true);
          }
          return;
        }

        // No company access and not a super admin: no workspace to route to.
        setUserRole(roles.globalRole || null);
      } catch (error) {
        console.error('Error initializing user data:', error);
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

  // Handlers wrapped in useCallback so their identity is stable — required for
  // the memoized context slices below to actually prevent re-renders.
  const handleLogout = useCallback(async () => {
    try {
      companyProfileCacheRef.current = { companyId: null, data: null, fetchedAt: 0 };
      await auth.signOut();
      localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed', e);
    }
  }, []);

  const returnToCompanyChooser = useCallback(() => {
    companyProfileCacheRef.current = { companyId: null, data: null, fetchedAt: 0 };
    setCurrentCompanyProfile(null);
    localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
    setShowCompanyChooser(true);
  }, []);

  // --- Memoized context slices (split by change-cadence) ---
  const authValue = useMemo(() => ({
    currentUser,
    currentUserClaims,
    userRole,
    loading,
    handleLogout,
    logout: handleLogout,
  }), [
    currentUser, currentUserClaims, userRole, loading, handleLogout,
  ]);

  const companyValue = useMemo(() => ({
    currentCompanyProfile,
    setCurrentCompanyProfile,
    loginToCompany,
    returnToCompanyChooser,
  }), [currentCompanyProfile, loginToCompany, returnToCompanyChooser]);

  const uiValue = useMemo(() => ({
    showCompanyChooser,
    setShowCompanyChooser,
  }), [showCompanyChooser]);

  // Backwards-compatible shim: exactly the former public surface, now memoized
  // (the old object was rebuilt every render). Prefer the granular hooks above.
  const dataValue = useMemo(() => ({
    currentUser,
    currentUserClaims,
    userRole,
    currentCompanyProfile,
    setCurrentCompanyProfile,
    loginToCompany,
    handleLogout,
    logout: handleLogout,
    returnToCompanyChooser,
    setShowCompanyChooser,
    loading,
  }), [
    currentUser, currentUserClaims, userRole, currentCompanyProfile, loginToCompany,
    handleLogout, returnToCompanyChooser, loading,
  ]);

  // All hooks are declared above this point — the loading early-return must come
  // after them to satisfy the rules of hooks.
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

  return (
    <AuthContext.Provider value={authValue}>
      <CompanyContext.Provider value={companyValue}>
        <UIContext.Provider value={uiValue}>
          <DataContext.Provider value={dataValue}>
            {children}

            {currentUser && showCompanyChooser && !loading && (
              <CompanyChooserModal />
            )}
          </DataContext.Provider>
        </UIContext.Provider>
      </CompanyContext.Provider>
    </AuthContext.Provider>
  );
}
