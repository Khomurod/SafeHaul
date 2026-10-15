import { describe, it, expect } from 'vitest';
import { isCompanyAdminForRoute, isCompanyWorkspaceRole, isSuperAdminClaims } from './roles';

describe('isSuperAdminClaims', () => {
  it('reads the role at the token root and under `roles`', () => {
    expect(isSuperAdminClaims({ globalRole: 'super_admin' })).toBe(true);
    expect(isSuperAdminClaims({ roles: { globalRole: 'super_admin' } })).toBe(true);
  });

  it('refuses every other shape', () => {
    expect(isSuperAdminClaims({ roles: { co1: 'company_admin' } })).toBe(false);
    expect(isSuperAdminClaims({ globalRole: 'company_admin' })).toBe(false);
    expect(isSuperAdminClaims({ super_admin: true })).toBe(false);
    expect(isSuperAdminClaims(null)).toBe(false);
    expect(isSuperAdminClaims(undefined)).toBe(false);
  });
});

describe('isCompanyAdminForRoute (UI-006)', () => {
  it('allows a company admin of the selected company', () => {
    expect(isCompanyAdminForRoute({ roles: { co1: 'company_admin' } }, 'co1')).toBe(true);
  });

  it('allows a global super admin regardless of selected company', () => {
    expect(isCompanyAdminForRoute({ roles: { globalRole: 'super_admin' } }, 'co1')).toBe(true);
    expect(isCompanyAdminForRoute({ roles: { globalRole: 'super_admin' } }, undefined)).toBe(true);
  });

  it('allows a super admin whose claim sits at the top level, where the rules and the server also look', () => {
    expect(isCompanyAdminForRoute({ globalRole: 'super_admin' }, 'co1')).toBe(true);
    expect(isCompanyAdminForRoute({ globalRole: 'super_admin', roles: { co1: 'recruiter' } }, 'co1')).toBe(true);
    expect(isCompanyAdminForRoute({ globalRole: 'recruiter' }, 'co1')).toBe(false);
  });

  it('denies a recruiter / hr_user (the UI-006 bypass)', () => {
    expect(isCompanyAdminForRoute({ roles: { co1: 'recruiter' } }, 'co1')).toBe(false);
    expect(isCompanyAdminForRoute({ roles: { co1: 'hr_user' } }, 'co1')).toBe(false);
  });

  it('denies an admin of a DIFFERENT company', () => {
    expect(isCompanyAdminForRoute({ roles: { co2: 'company_admin' } }, 'co1')).toBe(false);
  });

  it('is safe with missing claims / company', () => {
    expect(isCompanyAdminForRoute(undefined, 'co1')).toBe(false);
    expect(isCompanyAdminForRoute({}, 'co1')).toBe(false);
    expect(isCompanyAdminForRoute({ roles: { co1: 'company_admin' } }, undefined)).toBe(false);
  });
});

describe('isCompanyWorkspaceRole', () => {
  it('recognizes company workspace roles', () => {
    ['company_admin', 'super_admin', 'hr_user', 'recruiter'].forEach((r) =>
      expect(isCompanyWorkspaceRole(r)).toBe(true));
    expect(isCompanyWorkspaceRole('driver')).toBe(false);
    expect(isCompanyWorkspaceRole(undefined)).toBe(false);
  });
});
