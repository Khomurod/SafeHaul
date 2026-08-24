import React from 'react';
import { Home, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';
import { Button } from '@design-system/components';
import { ErrorState } from '@design-system/patterns';

/**
 * The top-level crash handler.
 *
 * Migrated to `ErrorState` on 2026-08-21. Presentation only — the Sentry
 * capture, the `console.error`, the reload and go-home behaviour, the
 * development-only error text and the `UI_CRASH_HANDLER` code are unchanged.
 *
 * What changed, beyond the tokens: the old markup announced nothing. A crash
 * replaced the page with a `<div>` containing an `<h2>`, so a screen-reader user
 * whose action had just failed got silence. `ErrorState` is `role="alert"`, so
 * the failure is announced the moment it appears — which for the screen that
 * appears *because something broke* is the whole point.
 *
 * The medallion, heading, body and action row are the pattern's, so this crash
 * screen is now the same shape as every other error state in the product rather
 * than a bespoke card with its own shadow, radius and red header band.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught Error:', error, errorInfo);
    Sentry.captureException(error, { extra: errorInfo });
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
          <div className="w-full max-w-md">
            <ErrorState
              title="Something went wrong"
              description="We encountered an unexpected error. Our team has been notified. Please try reloading the page."
              actions={(
                <>
                  <Button variant="primary" onClick={this.handleReload}>
                    <RefreshCw aria-hidden="true" />
                    Reload page
                  </Button>
                  <Button variant="secondary" onClick={this.handleGoHome}>
                    <Home aria-hidden="true" />
                    Go home
                  </Button>
                </>
              )}
            />
            {/*
              Development only, and deliberately outside the alert: the stack is
              for whoever is at the keyboard, and reading a JavaScript error
              aloud to a user helps nobody.
            */}
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-ds-4 max-h-32 overflow-auto rounded-ds-md bg-ds-surface-subtle p-ds-3 text-ds-xs text-ds-content-danger">
                {this.state.error.toString()}
              </pre>
            )}
            <p className="mt-ds-3 text-center text-ds-xs text-ds-content-muted">
              Error Code: UI_CRASH_HANDLER
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
