import { matchPath } from 'react-router-dom';
import { PUBLIC_FEATURE_ROUTE_MANIFEST } from './appRouteManifest';

/**
 * The routes that open the driver application, read from the route manifest by
 * id so no path is copied. The old interest link is included because it
 * forwards to the apply page, so a driver on it waits for the same screen.
 */
const APPLY_PAGE_ROUTE_IDS = ['publicApply', 'legacyInterestRedirect', 'sandboxApply'];

export const APPLY_PAGE_PATHS = Object.freeze(
  PUBLIC_FEATURE_ROUTE_MANIFEST
    .filter((route) => APPLY_PAGE_ROUTE_IDS.includes(route.id))
    .map((route) => route.path),
);

/** True when `pathname` is one of the driver application's routes. */
export function isApplyPagePath(pathname) {
  return APPLY_PAGE_PATHS.some((path) => matchPath(path, pathname) !== null);
}
