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
      adminOnly: route.nav?.adminOnly === true,
    }));

    expect(companyChildRouteDefs).toEqual(manifestProjection);
  });

  it('UI-006: adminOnly route defs mirror the sidebar adminOnly nav flags', () => {
    // Every route def marked adminOnly must correspond to a nav item flagged
    // adminOnly, and vice versa — so the route guard and the menu agree.
    const navAdminOnly = new Set(
      COMPANY_ROUTE_MANIFEST.filter((r) => r.nav?.adminOnly === true).map((r) => r.id),
    );
    const routeAdminOnly = new Set(
      companyChildRouteDefs.filter((r) => r.adminOnly === true).map((r) => r.id),
    );
    expect(routeAdminOnly).toEqual(navAdminOnly);
    // Settings must be guarded (the reported UI-006 page).
    expect(routeAdminOnly.has('settings')).toBe(true);
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
   * `Started (unfinished)` and `Start an application` were two sidebar items over
   * one collection of drafts — `listApplicationDrafts` filters by nothing, so a
   * carrier-prepared draft appeared under both. They became one workspace on
   * 2026-09-10, and this is what stops the second item drifting back in.
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
    expect(campaignsRoute.nav?.featureFlag).toBe('campaignsEnabled');
  });
});
