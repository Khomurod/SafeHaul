import React from 'react';
import { useLocation } from 'react-router-dom';
import { GlobalLoadingState } from '@shared/components/feedback/GlobalLoadingState';
import { ApplyPagePlaceholder } from '@features/driver-app/components/application/ApplyPagePlaceholder';
import { isApplyPagePath } from './applyPagePaths';

/**
 * The loader a page shows while it starts. The driver application shows its own
 * placeholder, shaped like its first screen, through every wait; every other
 * page keeps the branded loader. Both are in the first download, so the choice
 * waits on nothing.
 */

/** The fallback while a route's code downloads (inside the router). */
export function RouteLoadingFallback() {
  const { pathname } = useLocation();
  return isApplyPagePath(pathname) ? <ApplyPagePlaceholder /> : <GlobalLoadingState />;
}

/**
 * The fallback while the session settles. `DataProvider` sits outside the
 * router, so this reads the address bar; `platformLoader` is the provider's own.
 */
export function BootLoadingFallback({ platformLoader }) {
  return isApplyPagePath(window.location.pathname) ? <ApplyPagePlaceholder /> : platformLoader;
}
