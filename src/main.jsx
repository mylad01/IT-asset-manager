import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { applyPreferences, readStoredPrefs } from './config/applyPreferences';

// Apply the STORED prefs blob to <html> BEFORE the first React render so
// density/motion/performance/font-scale hold from the first painted frame
// (theme was already covered by the index.html pre-paint script; P2 attrs
// ride the same localStorage blob). Read-then-apply — calling
// applyPreferences() with no argument would store the DEFAULTS over the
// user's blob (caught live by the P2 reload-persistence check).
applyPreferences(readStoredPrefs());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);