import React from 'react';
import { Icon, RefreshCw } from '@design-system/icons';
import { Button } from '@design-system/components';
import { ErrorState } from '@design-system/patterns';

/**
 * Shown when the page cannot load its configuration, so the app cannot start.
 * The usual cause is the connection, and a reload is the whole remedy. Worded
 * for anyone: a driver opening an apply link sees it as readily as staff.
 */
export function StartupErrorScreen({ onReload = () => window.location.reload() }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
      <div className="w-full max-w-md">
        <ErrorState
          title="This page could not load"
          description="Check your internet connection, then reload the page."
          actions={(
            <Button variant="primary" onClick={onReload}>
              <Icon icon={RefreshCw} />
              Reload page
            </Button>
          )}
        />
      </div>
    </div>
  );
}

export default StartupErrorScreen;
