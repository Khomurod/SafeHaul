import React, { useId } from 'react';
import { useData } from '@/context/DataContext';
import { Icon, LogOut, ShieldAlert } from '@design-system/icons';
import { Button } from '@design-system/components';
import { PageState } from '@design-system/patterns';

/**
 * Shown to a signed-in account that belongs to no company, for instance one a
 * company admin removed from the team (the login itself stays). There is no
 * workspace to send it to, so it says why and offers the one way out.
 */
export function NoAccessScreen() {
  const { currentUser, handleLogout } = useData();
  const headingId = `no-access-${useId().replace(/:/g, '')}`;
  const signedInAs = currentUser?.email ? `You are signed in as ${currentUser.email}, but this` : 'This';

  return (
    <main aria-labelledby={headingId} className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
      <div className="w-full max-w-md">
        <PageState
          tone="warning"
          icon={ShieldAlert}
          headingLevel={1}
          titleId={headingId}
          focusOnMount
          title="Your account has no company access"
          description={(
            <span className="[overflow-wrap:anywhere]">
              {signedInAs} account is not part of any company. Ask your company administrator to add you, then sign in again.
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
