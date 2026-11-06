import { describe, expect, it } from 'vitest';
import { canOfferCompanyRoute, companyRoute, companyRoutePath } from './companyRouteAccess';

const admin = { isCompanyAdmin: true };
const recruiter = { isCompanyAdmin: false };

describe('canOfferCompanyRoute', () => {
  it('offers an admin-only page to a company admin only', () => {
    const settings = companyRoute('settings');
    expect(canOfferCompanyRoute(settings, admin)).toBe(true);
    expect(canOfferCompanyRoute(settings, recruiter)).toBe(false);
  });

  it('offers a page behind a feature unless the company has it explicitly off', () => {
    const importLeads = companyRoute('importLeads');
    expect(canOfferCompanyRoute(importLeads, { ...admin, features: undefined })).toBe(true);
    expect(canOfferCompanyRoute(importLeads, { ...admin, features: {} })).toBe(true);
    expect(canOfferCompanyRoute(importLeads, { ...admin, features: { importLeads: true } })).toBe(true);
    expect(canOfferCompanyRoute(importLeads, { ...admin, features: { importLeads: false } })).toBe(false);
  });

  it('needs both: Import Leads is never offered to a recruiter', () => {
    expect(canOfferCompanyRoute(companyRoute('importLeads'), { ...recruiter, features: { importLeads: true } })).toBe(false);
  });

  it('offers Add lead to every staff member', () => {
    expect(canOfferCompanyRoute(companyRoute('quickAddLead'), recruiter)).toBe(true);
    expect(canOfferCompanyRoute(companyRoute('quickAddLead'), admin)).toBe(true);
  });

  it('offers nothing for a route that does not exist', () => {
    expect(canOfferCompanyRoute(companyRoute('no-such-route'), admin)).toBe(false);
  });
});

describe('companyRoutePath', () => {
  it('is the address the router serves the page at', () => {
    expect(companyRoutePath(companyRoute('quickAddLead'))).toBe('/company/quick-add-lead');
    expect(companyRoutePath(companyRoute('importLeads'))).toBe('/company/import-leads');
  });
});
