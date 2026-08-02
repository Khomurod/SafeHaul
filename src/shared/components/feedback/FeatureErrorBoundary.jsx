import React from 'react';
import * as Sentry from '@sentry/react';

/**
 * Feature-scoped error boundary.
 *
 * Keeps the rest of the app usable when one feature crashes by
 * containing failures to the current route/view only.
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
        <div className="min-h-[280px] w-full rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="text-lg font-bold">{featureName} is temporarily unavailable</h2>
          <p className="mt-2 text-sm">
            An unexpected error occurred in this feature. You can continue using other parts of the app.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={this.handleRetry}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Retry Section
            </button>
            <button
              onClick={() => window.location.assign('/')}
              className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Go Home
            </button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 overflow-auto rounded bg-white p-3 text-xs text-amber-800">
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
