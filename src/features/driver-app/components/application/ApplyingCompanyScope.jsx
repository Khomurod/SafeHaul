import React, { useMemo } from 'react';
import { DataContext, useData } from '@/context/DataContext';

/**
 * The company a public application is for, as the application's steps read it:
 * `useData().currentCompanyProfile`, scoped to them. Setting the session's
 * company instead swapped a signed-in staff member's own company for this one,
 * so their workspace showed the wrong company until a reload.
 */
export function ApplyingCompanyScope({ company, children }) {
  const data = useData();
  const scoped = useMemo(() => ({ ...data, currentCompanyProfile: company }), [data, company]);
  return <DataContext.Provider value={scoped}>{children}</DataContext.Provider>;
}
