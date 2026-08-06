import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Dashboard Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.name === 'ChunkLoadError' ||
                          /failed to fetch dynamically imported module/i.test(this.state.error?.message) ||
                          /error loading dynamically imported module/i.test(this.state.error?.message);

      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-slate-800 border border-red-500/30 rounded-xl p-8 shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {isChunkError ? 'Update Available' : 'Something went wrong'}
            </h1>
            <p className="text-slate-400 mb-8">
              {isChunkError
                ? 'A new version of the dashboard has been deployed. Please reload to sync with the latest updates.'
                : 'The dashboard encountered an unexpected error. Your active trades are still being managed by the backend engine.'}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Reload Dashboard
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-lg transition-colors"
              >
                Try to Recover
              </button>
            </div>
            {this.state.error && (
              <div className="mt-8 pt-6 border-t border-slate-700 text-left">
                <p className="text-xs font-mono text-slate-500 break-all bg-slate-900/50 p-3 rounded">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
