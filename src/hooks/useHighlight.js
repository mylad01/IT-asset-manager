import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useHighlight(durationMs = 5000) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightedId, setHighlightedId] = useState(null);

  useEffect(() => {
    const id = searchParams.get('highlight');
    if (id) {
      setHighlightedId(id);
      const timer = setTimeout(() => {
        setHighlightedId(null);
        const next = new URLSearchParams(searchParams);
        next.delete('highlight');
        setSearchParams(next, { replace: true });
      }, durationMs);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams, durationMs]);

  const clearHighlight = useCallback(() => {
    setHighlightedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return { highlightedId, clearHighlight };
}
