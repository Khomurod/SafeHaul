/**
 * A page load is named by its route pattern, never by its address, and the
 * pages whose address is a secret are known by pattern too, so a route added to
 * a manifest is named and classified without an edit here.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANY_WORKSPACE_ROUTE,
  PROTECTED_FEATURE_ROUTE_MANIFEST,
  PUBLIC_FEATURE_ROUTE_MANIFEST,
} from './appRouteManifest';
import { COMPANY_ROUTE_MANIFEST } from './companyRouteManifest';
import { isSecretPath, isSecretPattern, routePatternOf } from './routePattern';

describe('route patterns', () => {
  it.each([
    ['/verify/abc', '/verify/:token'],
    ['/review-change/x', '/review-change/:token'],
  ])('names %s %s, a secret', (pathname, pattern) => {
    expect(routePatternOf(pathname)).toBe(pattern);
    expect(isSecretPattern(pattern)).toBe(true);
    expect(isSecretPath(pathname)).toBe(true);
  });

  it.each(['/verify/abc/extra', '/Verify/abc', '/REVIEW-CHANGE/x/y', '/verify/abc/', '/%76erify/abc'])(
    'treats %s as secret: no route matches some of these, the prefix does',
    (pathname) => {
      expect(isSecretPath(pathname)).toBe(true);
    },
  );

  it('measures the signing room: its key is a query, never part of the path', () => {
    expect(routePatternOf('/sign/c1/r1')).toBe('/sign/:companyId/:requestId');
    expect(isSecretPath('/sign/c1/r1')).toBe(false);
  });

  it.each(['/apply/acme', '/apply/acme/'])('names %s /apply/:slug', (pathname) => {
    expect(routePatternOf(pathname)).toBe('/apply/:slug');
  });

  it.each([
    ['/company/drivers/applications', '/company/drivers/applications'],
    ['/company', '/company'],
    ['/company/zzz', '/company/*'],
    ['/super-admin/companies/x/y', '/super-admin/*'],
    ['/login', '/login'],
    ['/', '/'],
    ['/nope', 'unmatched'],
  ])('names %s %s', (pathname, pattern) => {
    expect(routePatternOf(pathname)).toBe(pattern);
    expect(isSecretPath(pathname)).toBe(false);
  });

  it.each(['/verify', '/verifyx/abc', '/review-changes/x', ''])('does not treat %s as secret', (pathname) => {
    expect(isSecretPath(pathname)).toBe(false);
  });

  it('names every manifest route by itself, so a new route is never unmatched', () => {
    const paths = [
      ...PUBLIC_FEATURE_ROUTE_MANIFEST.map((route) => route.path),
      ...PROTECTED_FEATURE_ROUTE_MANIFEST.map((route) => route.path),
      COMPANY_WORKSPACE_ROUTE.path,
      ...COMPANY_ROUTE_MANIFEST.map((route) => `${COMPANY_WORKSPACE_ROUTE.path}/${route.path}`),
    ];
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      expect(routePatternOf(path), path).toBe(path);
    }
  });

  it('treats every manifest route with a :token segment as secret', () => {
    const tokenRoutes = PUBLIC_FEATURE_ROUTE_MANIFEST.filter((route) => route.path.split('/').includes(':token'));
    expect(tokenRoutes.map((route) => route.path)).toEqual(['/verify/:token', '/review-change/:token']);
    for (const { path } of tokenRoutes) {
      expect(isSecretPattern(path), path).toBe(true);
      expect(isSecretPath(path.replace(':token', 'abc')), path).toBe(true);
    }
  });
});
