import React from 'react';
import { PublicApplyHandler } from '@features/driver-app/components/application/PublicApplyHandler';

/**
 * Same implementation as guest `/apply/:slug` — reuses `PublicApplyHandler` so steps,
 * FMCSA employer autocomplete, submission queue, and uploads always stay in sync.
 */
export function SandboxApplyHandler() {
  return <PublicApplyHandler sandbox />;
}

export default SandboxApplyHandler;
