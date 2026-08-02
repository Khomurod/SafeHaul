import { describe, expect, it } from 'vitest';
import {
  COMPANY_WORKSPACE_ROUTE,
  PROTECTED_FEATURE_ROUTE_MANIFEST,
  PUBLIC_FEATURE_ROUTE_MANIFEST,
} from './appRouteManifest';
import { featureScreens } from './featureRegistry';

describe('app route manifest contract', () => {
  it('uses unique ids and paths across public/protected manifests', () => {
    const defs = [...PUBLIC_FEATURE_ROUTE_MANIFEST, ...PROTECTED_FEATURE_ROUTE_MANIFEST];
    const ids = defs.map((route) => route.id);
    const paths = defs.map((route) => route.path);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('references registered screens', () => {
    const registeredScreens = new Set(Object.keys(featureScreens));
    const defs = [
      ...PUBLIC_FEATURE_ROUTE_MANIFEST,
      ...PROTECTED_FEATURE_ROUTE_MANIFEST,
      COMPANY_WORKSPACE_ROUTE,
    ];

    for (const route of defs) {
      expect(registeredScreens.has(route.screen)).toBe(true);
    }
  });

  it('keeps protected routes role-gated', () => {
    for (const route of PROTECTED_FEATURE_ROUTE_MANIFEST) {
      expect(Array.isArray(route.allowedRoles)).toBe(true);
      expect(route.allowedRoles.length).toBeGreaterThan(0);
    }

    expect(Array.isArray(COMPANY_WORKSPACE_ROUTE.allowedRoles)).toBe(true);
    expect(COMPANY_WORKSPACE_ROUTE.allowedRoles.length).toBeGreaterThan(0);
  });
});
