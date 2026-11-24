import React, { createContext, useState, useContext, useEffect } from 'react';
import { readStoredPrefs, applyPreference } from '../config/applyPreferences';
import { getThemeMode } from '../config/preferencesRegistry';

const ThemeContext = createContext(null);

/**
 * Theme context (PLAN.MD §13): a thin React view over the preferences
 * registry blob — no private storage, no duplicate writes. The initial
 * value and re-reads come from readStoredPrefs() (the same studioUiPrefs
 * blob the pre-paint script and applyPreferences use); the sidebar
 * quick-toggle routes through applyPreference('theme', …) so the DOM, the
 * persisted blob, and the settings UI's optimistic state all move
 * together. Server persistence for a quick-toggle follows the same
 * pattern as the Appearance section's controls.
 */
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => readStoredPrefs().theme || 'dark');

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    // Brightness class rides along so the legacy sidebar toggle keeps the
    // light/dark patch layer correct (parity with the registry appliers).
    root.setAttribute('data-brightness', getThemeMode(theme));
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      // Toggling = picking between the two opposite-brightness presets.
      const next = getThemeMode(prev) === 'dark' ? 'light' : 'dark';
      applyPreference('theme', next); // blob + DOM via the ONE apply path
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext); // eslint-disable-line react/only-export-components
