import React, { Component } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

class WidgetErrorBoundary extends Component {
  state = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('WidgetErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const fallbackText = this.props.fallbackText || 'Failed to load this component';
      const showRetry = this.props.showRetry !== false;

      return (
        <div className={`glass-badge glass-badge-amber p-3 rounded-xl flex items-center justify-between gap-3 ${this.props.className || ''}`}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <AlertCircle className="text-[color:var(--status-warning)] shrink-0" size={16} />
            <span className="text-xs font-bold text-[color:var(--status-warning-hi)] truncate">
              {fallbackText}
            </span>
          </div>
          {showRetry && (
            <button
              onClick={this.handleRetry}
              className="text-[color:var(--status-warning)] hover:text-[color:var(--status-warning-hi)] transition-colors p-1 rounded hover:bg-white/10"
              title="Retry"
              aria-label="Retry"
            >
              <RotateCcw size={14} />
            </button>
          )}

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <div className="mt-2 p-2 bg-white/5 rounded-lg text-xs tt-muted font-mono break-words">
              {this.state.error.message}
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default WidgetErrorBoundary;