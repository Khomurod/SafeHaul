import { describe, expect, it } from 'vitest';
import {
  COMPANY_NAV_GROUPS,
  COMPANY_NAV_LAYOUT,
  COMPANY_ROUTE_MANIFEST,
} from './companyRouteManifest';
import { companyChildRouteDefs } from './featureRegistry';

describe('company route manifest contract', () => {
  it('uses unique route ids and paths', () => {
    const ids = COMPANY_ROUTE_MANIFEST.map((route) => route.id);
    const paths = COMPANY_ROUTE_MANIFEST.map((route) => route.path);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps route defs derived from the manifest', () => {
    const manifestProjection = COMPANY_ROUTE_MANIFEST.map((route) => ({
      id: route.id,
      path: route.path,
      screen: route.screen,
      featureName: route.featureName,
      props: route.props,
      requiresCompanyProfile: route.requiresCompanyProfile,
      adminOnly: route.adminOnly === true,
    }));

    expect(companyChildRouteDefs).toEqual(manifestProjection);
  });

  describe('UI-006: who may open a page is the page\'s own', () => {
    it('guards the admin-only pages, Import Leads with no menu item', () => {
      const guarded = companyChildRouteDefs.filter((r) => r.adminOnly).map((r) => r.id);
      expect(guarded.sort()).toEqual(['importLeads', 'settings']);
    });

    it('keeps no admin or feature rule on a menu item, where removing it would drop the rule', () => {
      for (const route of COMPANY_ROUTE_MANIFEST) {
        expect(route.nav?.adminOnly, route.id).toBeUndefined();
        expect(route.nav?.featureFlag, route.id).toBeUndefined();
      }
    });

    it('leaves Add lead open to every staff member', () => {
      const addLead = COMPANY_ROUTE_MANIFEST.find((route) => route.id === 'quickAddLead');
      expect(addLead.path).toBe('quick-add-lead');
      expect(addLead.adminOnly).toBeUndefined();
    });
  });

  it('keeps Add lead and Import Leads reachable by URL, with no menu item', () => {
    // The Leads page's header offers both (`LeadsHeaderActions`).
    for (const [id, path] of [['quickAddLead', 'quick-add-lead'], ['importLeads', 'import-leads']]) {
      const route = COMPANY_ROUTE_MANIFEST.find((entry) => entry.id === id);
      expect(route.path).toBe(path);
      expect(route.nav).toBeUndefined();
    }
    expect(COMPANY_ROUTE_MANIFEST.find((route) => route.id === 'importLeads').featureFlag).toBe('importLeads');
  });

  it('has valid route and group references in nav layout', () => {
    const routeIds = new Set(COMPANY_ROUTE_MANIFEST.map((route) => route.id));
    const groupIds = new Set(Object.keys(COMPANY_NAV_GROUPS));

    for (const block of COMPANY_NAV_LAYOUT) {
      if (block.type === 'route') {
        expect(routeIds.has(block.routeId)).toBe(true);
      }
      if (block.type === 'group') {
        expect(groupIds.has(block.group)).toBe(true);
      }
    }
  });

  it('only points nav group items to declared groups', () => {
    const groupIds = new Set(Object.keys(COMPANY_NAV_GROUPS));
    const groupedRoutes = COMPANY_ROUTE_MANIFEST.filter(
      (route) => route.nav?.kind === 'group-item',
    );

    for (const route of groupedRoutes) {
      expect(groupIds.has(route.nav.group)).toBe(true);
    }
  });

  /**
   * One destination for unfinished work, and the old URL still resolves.
   *
   * `Started (unfinished)` and `Start an application` cover one collection of
   * drafts — `listApplicationDrafts` filters by nothing, so as two sidebar items
   * a carrier-prepared draft would appear under both. They are one workspace,
   * and this is what stops the second item drifting back in.
   */
  describe('the unfinished-applications workspace', () => {
    const routeById = (id) => COMPANY_ROUTE_MANIFEST.find((route) => route.id === id);

    it('is the only navigable destination for unfinished work', () => {
      const applicationsItems = COMPANY_ROUTE_MANIFEST
        .filter((route) => route.nav?.kind === 'group-item' && route.nav.group === 'applications')
        .map((route) => route.nav.label);

      expect(applicationsItems).toContain('Unfinished applications');
      expect(applicationsItems).not.toContain('Started (unfinished)');
      expect(applicationsItems).not.toContain('Start an application');
    });

    it('keeps the old start-application URL reachable, with no menu item', () => {
      const legacy = routeById('startApplication');

      // A recruiter may have bookmarked it; a 404 is a worse outcome than a
      // redirect to where the feature went. `CompanySidebar` builds its menu by
      // filtering on `nav.kind`, so no `nav` means no item.
      expect(legacy).toBeDefined();
      expect(legacy.path).toBe('drivers/start-application');
      expect(legacy.screen).toBe('startApplicationRedirect');
      expect(legacy.nav).toBeUndefined();
    });

    it('still separates unfinished work from the submitted pipeline', () => {
      // The separation that IS a rule, unlike the one above: nothing here has been
      // signed or consented to, so it is not a candidate record.
      const workspace = routeById('unfinishedApplications');

      expect(workspace.path).toBe('drivers/unfinished');
      expect(workspace.screen).toBe('companyUnfinishedApplications');
      expect(routeById('applications').path).toBe('drivers/applications');
      expect(workspace.path).not.toBe(routeById('applications').path);
    });
  });

  it('registers campaigns as a standalone feature route', () => {
    const campaignsRoute = COMPANY_ROUTE_MANIFEST.find((route) => route.id === 'campaigns');

    expect(campaignsRoute).toBeDefined();
    expect(campaignsRoute.path).toBe('campaigns');
    expect(campaignsRoute.screen).toBe('companyCampaignsPage');
    expect(campaignsRoute.requiresCompanyProfile).toBe(true);
    expect(campaignsRoute.featureFlag).toBe('campaignsEnabled');
  });
});
