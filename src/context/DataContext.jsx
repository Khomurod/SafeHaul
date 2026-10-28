// src/context/DataContext.jsx
import React, { useState, useEffect, useContext, createContext, useCallback, useRef, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { CompanyChooserModal } from '@shared/components/modals';
import { SESSION_KEYS } from './dataContext/sessionKeys';
import { extractRoleContext, getPrimaryCompanyRole } from './dataContext/claims';
import { DEMO_COMPANY_NAME, getE2EQueryParam, isE2ETestMode, isMarketingDemo } from '@lib/runtime/e2eMode';

export const DataContext = createContext();

/** The signed-in user, their claims and role, and the selected company. */
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

  /** Opens a company's workspace; resolves true when its profile loaded. */
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
        return true;
      }

      const companyDoc = await getDoc(doc(db, 'companies', companyId));
      if (companyDoc.exists()) {
        const companyData = { id: companyDoc.id, ...companyDoc.data() };
        companyProfileCacheRef.current = { companyId, data: companyData, fetchedAt: Date.now() };
        setCurrentCompanyProfile(companyData);
        localStorage.setItem(SESSION_KEYS.SELECTED_COMPANY_ID, companyId);
        setShowCompanyChooser(false);
        return true;
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
    return false;
  }, []);

  /**
   * A save just wrote `changes` to company `companyId`: the company in use and
   * the short cache take them, so every screen reading it (and the next visit
   * to one) shows what was saved without another read.
   */
  const applyCompanyChanges = useCallback((companyId, changes) => {
    setCurrentCompanyProfile((prev) => (prev?.id === companyId ? { ...prev, ...changes } : prev));
    const cache = companyProfileCacheRef.current;
    if (cache.companyId === companyId && cache.data) {
      companyProfileCacheRef.current = { ...cache, data: { ...cache.data, ...changes } };
    }
  }, []);

  useEffect(() => {
    if (isE2ETestMode) {
      const e2eAuthMode = getE2EQueryParam('e2eAuth', 'none');
      // `?demo=marketing` renames the fixture tenant so landing-page
      // screenshots carry a plausible carrier rather than "E2E Logistics".
      // Nothing else about the session changes: same fixtures, same closed
      // Firestore port, same mock claims.
      const mockCompany = {
        id: 'e2e-company',
        companyName: isMarketingDemo() ? DEMO_COMPANY_NAME : 'E2E Logistics',
        appSlug: 'e2e-company',
        applicationConfig: {},
        // The team cache the server keeps on a company document.
        teamMembers: [{ userId: 'e2e-company_admin', name: 'E2E Admin', email: 'company_admin@safehaul.local', role: 'company_admin' }],
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
        const { roles, companyRoleKeys, hasCompanyRoles, isSuperAdmin } = extractRoleContext(claims);

        setCurrentUser(user);
        setCurrentUserClaims(claims);

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
          // The company chosen last, if the account still belongs to it; else the
          // only one it belongs to. Signing out forgets the choice, so without the
          // second a one-company member was asked to choose at every sign-in.
          const savedCompanyId = localStorage.getItem(SESSION_KEYS.SELECTED_COMPANY_ID);
          const companyId = companyRoleKeys.includes(savedCompanyId)
            ? savedCompanyId
            : (companyRoleKeys.length === 1 ? companyRoleKeys[0] : null);
          // A company that cannot be read just now (offline, say) leaves the
          // chooser, which lists the companies again, rather than an empty workspace.
          if (!companyId || !(await loginToCompany(companyId, null, true))) {
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

  // Handlers wrapped in useCallback so their identity is stable, and with it the
  // memoized context value below.
  const handleLogout = useCallback(async () => {
    try {
      companyProfileCacheRef.current = { companyId: null, data: null, fetchedAt: 0 };
      await auth.signOut();
      localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
      window.location.href = '/login';
      return true;
    } catch (e) {
      console.error('Logout failed', e);
      return false;
    }
  }, []);

  const returnToCompanyChooser = useCallback(() => {
    companyProfileCacheRef.current = { companyId: null, data: null, fetchedAt: 0 };
    setCurrentCompanyProfile(null);
    localStorage.removeItem(SESSION_KEYS.SELECTED_COMPANY_ID);
    setShowCompanyChooser(true);
  }, []);

  const dataValue = useMemo(() => ({
    currentUser,
    currentUserClaims,
    userRole,
    currentCompanyProfile,
    loginToCompany,
    applyCompanyChanges,
    handleLogout,
    returnToCompanyChooser,
  }), [
    currentUser, currentUserClaims, userRole, currentCompanyProfile, loginToCompany,
    applyCompanyChanges, handleLogout, returnToCompanyChooser,
  ]);

  // All hooks are declared above this point — the loading early-return must come
  // after them to satisfy the rules of hooks.
  if (loading) {
    return (
      <div role="status" className="flex h-screen items-center justify-center bg-ds-canvas">
        <div className="text-center">
          <SafeHaulLoader size="h-20 w-20" className="mx-auto mb-ds-4" />
          <p className="font-medium text-ds-content-muted">Loading Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <DataContext.Provider value={dataValue}>
      {children}

      {currentUser && showCompanyChooser && !loading && (
        <CompanyChooserModal />
      )}
    </DataContext.Provider>
  );
}
