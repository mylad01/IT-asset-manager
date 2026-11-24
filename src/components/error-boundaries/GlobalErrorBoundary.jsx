import React, { Component } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

class GlobalErrorBoundary extends Component {
  state = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('GlobalErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleFullReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center p-8">
          <div className="glass-modal max-w-md w-full p-6 animate-glass-in">
            <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-xl bg-[color:var(--status-danger-strong)]/20 shrink-0">
                  <AlertTriangle className="text-[color:var(--status-danger)]" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold tt">Application Error</h3>
                  <p className="tt-label mt-2 text-sm">
                    {this.state.error?.message || 'Something went wrong while loading this page.'}
                  </p>
                  <div className="mt-5 flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={this.handleReload}
                      className="flex items-center justify-center gap-2 px-4 py-2 glass-btn glass-btn-primary text-xs font-semibold"
                    >
                      <RotateCcw size={14} />
                      Retry
                    </button>
                    <button
                      onClick={this.handleFullReload}
                      className="flex items-center justify-center gap-2 px-4 py-2 glass-btn text-xs font-semibold"
                    >
                      <RefreshCw size={14} />
                      Reload Application
                    </button>
                  </div>
                </div>
              </div>

              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <div className="mt-4 p-3 bg-white/5 rounded-xl border border-white/10 text-xs tt-muted font-mono overflow-x-auto">
                  <pre>{this.state.errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default GlobalErrorBoundary;