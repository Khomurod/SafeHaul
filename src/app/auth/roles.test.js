import { describe, it, expect } from 'vitest';
import { isCompanyAdminForRoute, isCompanyWorkspaceRole } from './roles';

describe('isCompanyAdminForRoute (UI-006)', () => {
  it('allows a company admin of the selected company', () => {
    expect(isCompanyAdminForRoute({ roles: { co1: 'company_admin' } }, 'co1')).toBe(true);
  });

  it('allows a global super admin regardless of selected company', () => {
    expect(isCompanyAdminForRoute({ roles: { globalRole: 'super_admin' } }, 'co1')).toBe(true);
    expect(isCompanyAdminForRoute({ roles: { globalRole: 'super_admin' } }, undefined)).toBe(true);
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
