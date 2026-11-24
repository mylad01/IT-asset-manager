import React from 'react';
import { Heart } from 'lucide-react';

function GithubIcon({ size = 14, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export default function AuthorFooter({ className = '', compact = false }) {
  if (compact) {
    return (
      <div
        className={`flex items-center justify-center gap-1.5 py-1 text-[11px] font-medium transition-colors ${className}`}
        style={{ color: 'var(--text-on-glass-muted)' }}
      >
        <span>Built with</span>
        <Heart size={10} className="text-[color:var(--status-danger-hi)] fill-current" />
        <span>by</span>
        <a
          href="https://github.com/mylad01"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-bold hover:text-white transition-colors"
          style={{ color: 'var(--text-on-glass-secondary)' }}
        >
          <GithubIcon size={12} />
          mylad01
        </a>
      </div>
    );
  }

  return (
    <footer
      className={`flex items-center justify-center gap-2 py-3 text-xs font-medium transition-colors ${className}`}
      style={{ color: 'var(--text-on-glass-muted)' }}
    >
      <span>Studio IT Sync &bull; Developed by</span>
      <a
        href="https://github.com/mylad01"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-bold hover:underline transition-all"
        style={{ color: 'var(--text-on-glass)' }}
      >
        <GithubIcon size={14} />
        mylad01
      </a>
    </footer>
  );
}
