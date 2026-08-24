import React from 'react';
import { Home, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';
import { Button } from '@design-system/components';
import { PageState } from '@design-system/patterns';

/**
 * Feature-scoped error boundary.
 *
 * Keeps the rest of the app usable when one feature crashes by containing
 * failures to the current route or view only.
 *
 * Migrated to `PageState` on 2026-08-21. The Sentry tags, the retry that clears
 * the boundary's own state, and the go-home navigation are unchanged.
 *
 * It uses `PageState` with `tone="warning"` rather than `ErrorState`, and the
 * distinction is the point: the *page* has not failed. One section has, the rest
 * of the application still works, and the copy says so. An `alert`-level
 * announcement would overstate it — `PageState` announces politely at this tone,
 * which matches "this part is unavailable, carry on" rather than "everything
 * stopped".
 */
class FeatureErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    Sentry.captureException(error, {
      tags: {
        boundary: 'feature',
        feature: this.props.featureName || 'unknown',
      },
      extra: errorInfo,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const featureName = this.props.featureName || 'This section';

      return (
        <div className="min-h-[280px] w-full">
          <PageState
            tone="warning"
            title={`${featureName} is temporarily unavailable`}
            description="An unexpected error occurred in this feature. You can continue using other parts of the app."
            actions={(
              <>
                <Button variant="primary" onClick={this.handleRetry}>
                  <RefreshCw aria-hidden="true" />
                  Retry section
                </Button>
                <Button variant="secondary" onClick={() => window.location.assign('/')}>
                  <Home aria-hidden="true" />
                  Go home
                </Button>
              </>
            )}
          />
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-ds-4 overflow-auto rounded-ds-md bg-ds-surface-subtle p-ds-3 text-ds-xs text-ds-content-secondary">
              {String(this.state.error)}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default FeatureErrorBoundary;
