/**
 * The route pattern of an address, read from the route manifests, so a page
 * load is named `/apply/:slug` and never by the address itself; and which
 * addresses carry a secret (a `:token` segment). Speed monitoring records
 * nothing on those, because the Performance SDK attaches the page address to
 * everything it sends (`src/lib/monitoring/pageLoadTrace.js`).
 *
 * The manifests only, never `featureRegistry.jsx`, which pulls in the lazy
 * screens. `App.jsx` declares `/login`, `/` and the company workspace's index
 * and catch-all itself, so those are added here.
 */
import { matchPath } from 'react-router-dom';
import {
  COMPANY_WORKSPACE_ROUTE,
  PROTECTED_FEATURE_ROUTE_MANIFEST,
  PUBLIC_FEATURE_ROUTE_MANIFEST,
} from './appRouteManifest';
import { COMPANY_ROUTE_MANIFEST } from './companyRouteManifest';

export const UNMATCHED_ROUTE = 'unmatched';

const COMPANY = COMPANY_WORKSPACE_ROUTE.path;

/** Exact patterns first; splats, which match everything under them, last. */
const ROUTE_PATTERNS = Object.freeze([
  ...PUBLIC_FEATURE_ROUTE_MANIFEST.map((route) => route.path),
  '/login',
  '/',
  COMPANY,
  ...COMPANY_ROUTE_MANIFEST.map((route) => `${COMPANY}/${route.path}`),
  ...PROTECTED_FEATURE_ROUTE_MANIFEST.map((route) => route.path),
  `${COMPANY}/*`,
]);

export function isSecretPattern(pattern) {
  return pattern.split('/').includes(':token');
}

/** `/verify/`, `/review-change/`: the static part of each secret pattern. */
const SECRET_PREFIXES = Object.freeze(ROUTE_PATTERNS.filter(isSecretPattern).map((pattern) => {
  const segments = pattern.split('/');
  const firstDynamic = segments.findIndex((segment) => segment.startsWith(':') || segment === '*');
  return `${segments.slice(0, firstDynamic).join('/')}/`.toLowerCase();
}));

/** The address as the router reads it: each segment percent-decoded. */
function decoded(pathname) {
  return pathname.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join('/');
}

/** The first manifest pattern that matches `pathname` whole, else `'unmatched'`. */
export function routePatternOf(pathname) {
  return ROUTE_PATTERNS.find((path) => matchPath({ path, end: true }, pathname) !== null) ?? UNMATCHED_ROUTE;
}

/**
 * True when `pathname` is, or could be, a secret page: it matches a `:token`
 * route, or starts with a secret route's prefix (`/verify/<token>/x` matches no
 * route, yet carries the token). Case-insensitive, as the router is, and read
 * both as given and decoded, as the router reads it.
 */
export function isSecretPath(pathname) {
  const path = typeof pathname === 'string' ? pathname : '';
  return [path, decoded(path)].some((candidate) => {
    if (isSecretPattern(routePatternOf(candidate))) return true;
    const lower = candidate.toLowerCase();
    return SECRET_PREFIXES.some((prefix) => lower.startsWith(prefix));
  });
}
