import React, { useId } from 'react';
import { useData } from '@/context/DataContext';
import { Icon, LogOut, ShieldAlert } from '@design-system/icons';
import { Button } from '@design-system/components';
import { PageState } from '@design-system/patterns';

/**
 * Shown in place of the workspace to the staff of a company Super Admin
 * deactivated. The server already refuses them; this says why and offers the
 * one way out. Signing in again opens any other company they work for.
 */
export function CompanyDeactivatedScreen() {
    const { currentCompanyProfile, handleLogout } = useData();
    const headingId = `company-deactivated-${useId().replace(/:/g, '')}`;
    const name = currentCompanyProfile?.companyName || currentCompanyProfile?.name;

    return (
        <main aria-labelledby={headingId} className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
            <div className="w-full max-w-md">
                <PageState
                    tone="warning"
                    icon={ShieldAlert}
                    headingLevel={1}
                    titleId={headingId}
                    focusOnMount
                    title="This company has been deactivated"
                    description={(
                        <span className="[overflow-wrap:anywhere]">
                            {name ? `The ${name}` : "This company's"} workspace is closed until SafeHaul turns the company back on. If you also work for another company, sign out and sign in again to open it.
                        </span>
                    )}
                    actions={(
                        <Button variant="primary" onClick={handleLogout}>
                            <Icon icon={LogOut} />
                            Sign out
                        </Button>
                    )}
                />
            </div>
        </main>
    );
}
