import React, { useId } from 'react';
import { Card, Skeleton } from '@/design-system/components';

/**
 * The one placeholder the driver application shows while it starts: during the
 * session check, while the screen's code downloads and while the company loads
 * (`src/app/routes/RouteLoadingFallback.jsx`, `resolveApplyStatusScreen`). One
 * calm outline instead of three different "Loading" screens in a row.
 *
 * Shaped like `IntakeChooser` — a title, one line, two tall choices and a
 * footnote in the same card — because the chooser is the first screen of a fresh
 * link. A restored draft, a referral link, a carrier invite and `/sandbox/apply`
 * lead elsewhere after a short wait; that mismatch is accepted.
 *
 * `role="status"` is not valid on `<main>`, so the landmark and the announcement
 * are separate elements (as on the other apply status screens), and the heading
 * is visually hidden: the outline draws no words. "Loading Application..." is
 * frozen copy, asserted by `ApplyPagePlaceholder.test.jsx` and
 * `e2e/apply-loading-placeholder.spec.cjs`.
 *
 * A feature composition of approved primitives, not a `PageState` look-alike: it
 * draws no medallion, heading or actions. It ships in the first download, so it
 * imports design-system primitives only, never another feature module.
 */
export function ApplyPagePlaceholder() {
  const headingId = `apply-loading-${useId().replace(/:/g, '')}`;
  return (
    <main
      aria-labelledby={headingId}
      aria-busy="true"
      className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4"
    >
      <div role="status">
        <h1 id={headingId} className="ds-visually-hidden">Loading Application...</h1>
      </div>
      <Card as="div" padding="lg" className="w-full max-w-2xl" aria-hidden="true">
        <div className="mb-ds-8 text-center">
          <p className="mb-ds-2 text-ds-heading-lg"><Skeleton width="half" /></p>
          <p><Skeleton width="three-quarters" /></p>
        </div>
        <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
          <Skeleton shape="block" height="lg" />
          <Skeleton shape="block" height="lg" />
        </div>
        <p className="mt-ds-6 text-center text-ds-xs"><Skeleton width="half" /></p>
      </Card>
    </main>
  );
}
