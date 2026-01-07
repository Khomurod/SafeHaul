import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught Error:", error, errorInfo);
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-red-50 p-6 border-b border-red-100 flex justify-center">
              <div className="bg-red-100 p-3 rounded-full">
                <AlertTriangle size={48} className="text-red-600" />
              </div>
            </div>

            <div className="p-6 text-center space-y-4">
              <h2 className="text-2xl font-bold text-gray-800">Something went wrong</h2>
              <p className="text-gray-600 text-sm">
                We encountered an unexpected error. Our team has been notified. 
                Please try reloading the page.
              </p>

              {import.meta.env.DEV && this.state.error && (
                <div className="bg-gray-100 p-3 rounded text-left overflow-auto max-h-32 text-xs font-mono text-red-800 mt-2">
                  {this.state.error.toString()}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button 
                  onClick={this.handleReload}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all shadow-sm"
                >
                  <RefreshCw size={18} /> Reload Page
                </button>
                <button 
                  onClick={this.handleGoHome}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-semibold transition-all"
                >
                  <Home size={18} /> Go Home
                </button>
              </div>
            </div>

            <div className="bg-gray-50 p-3 text-center border-t border-gray-200">
              <p className="text-xs text-gray-400">Error Code: UI_CRASH_HANDLER</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
