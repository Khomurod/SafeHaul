/**
 * The driver application's screen code is asked for once per page, by whichever
 * caller comes first, and the route gets that same request. So the start-up
 * warm-up (`@app/startup/warmApplyScreen`) adds no second download, and when its
 * request fails the driver sees what a failed route load showed before: the
 * route's error screen, from the one attempt.
 */
import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SCREEN = '@features/driver-app/components/application/PublicApplyHandler';
let loads = 0;

// Each test registers the screen anew after `vi.resetModules()`, so every test
// counts its own downloads: `loads` is how many times the screen was fetched.
function mockScreen({ fail }) {
  vi.doMock(SCREEN, () => {
    loads += 1;
    if (fail) throw new Error('Failed to fetch dynamically imported module');
    return { PublicApplyHandler: () => 'Driver application screen' };
  });
}

async function renderRoute() {
  const { featureScreens } = await import('./featureRegistry');
  const { default: FeatureErrorBoundary } = await import('@shared/components/feedback/FeatureErrorBoundary');
  const Screen = featureScreens.publicApplyHandler;
  render(
    <FeatureErrorBoundary featureName="Driver Application">
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </FeatureErrorBoundary>,
  );
}

describe('apply screen loader', () => {
  beforeEach(() => {
    vi.resetModules();
    loads = 0;
  });

  afterEach(() => {
    vi.doUnmock(SCREEN);
    vi.restoreAllMocks();
  });

  it('asks once: every caller gets the same request', async () => {
    mockScreen({ fail: false });
    const { loadPublicApplyHandler } = await import('./applyScreenLoader');
    const first = loadPublicApplyHandler();

    expect(loadPublicApplyHandler()).toBe(first);
    await expect(first).resolves.toHaveProperty('PublicApplyHandler');
  });

  it('the route renders the screen the warm-up asked for, without asking again', async () => {
    mockScreen({ fail: false });
    const { loadPublicApplyHandler } = await import('./applyScreenLoader');
    await loadPublicApplyHandler();

    await renderRoute();

    expect(await screen.findByText('Driver application screen')).toBeInTheDocument();
    expect(loads).toBe(1);
  });

  it.each([
    ['with no warm-up (as before)', false],
    ['after a failed warm-up', true],
  ])('a failed download shows the route error screen, from one attempt, %s', async (_label, warmFirst) => {
    mockScreen({ fail: true });
    // React reports the error the boundary catches; the screen is the assertion.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if (warmFirst) {
      const { loadPublicApplyHandler } = await import('./applyScreenLoader');
      await expect(loadPublicApplyHandler()).rejects.toThrow();
    }

    await renderRoute();

    expect(await screen.findByText('Driver Application is temporarily unavailable')).toBeInTheDocument();
    expect(loads).toBe(1);
  });
});
