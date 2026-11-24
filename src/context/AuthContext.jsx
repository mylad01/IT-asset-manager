import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '../utils/apiClient';
import { useBrandDefaults } from '../hooks/useBrandDefaults';
import {
  getStoredUser,
  getStoredToken,
  setStoredUser,
  setStoredToken,
  clearStoredAuth,
} from '../utils/appStorage';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupPending, setSetupPending] = useState(false);

  // Root-defined defaults for never-touched prefs (PLAN.MD §13 P3),
  // scoped to the user's role when role overrides exist.
  useBrandDefaults(user?.role);

  useEffect(() => {
    const initAuth = async () => {
      const storedUser = getStoredUser();
      const storedToken = getStoredToken();
      
      if (storedUser && storedToken) {
        setUser(storedUser);
        setToken(storedToken);
        
        // Check if setup is pending
        try {
          const { ok, data } = await api.get('/api/setup/status', { showToast: false });
          if (ok && data?.status === 'SETUP_PENDING') {
            setSetupPending(true);
            setUser(null);
            setToken(null);
            clearStoredAuth();
          }
        } catch (err) {
          console.warn('Setup status check failed:', err);
        }
      }
      setLoading(false);
    };
    
    initAuth();
  }, []);

  const login = (userData, jwtToken) => {
    setUser(userData);
    setToken(jwtToken);
    setSetupPending(false);
    // The ONE write site for the auth keys (apiClient only reads/removes;
    // the sync test holds the key literals to this module).
    setStoredUser(userData);
    setStoredToken(jwtToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setSetupPending(false);
    clearStoredAuth();
  };

  const completePasswordChange = () => {
    if (user) {
      const updatedUser = { ...user, requires_password_change: 0 };
      setUser(updatedUser);
      setStoredUser(updatedUser);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, setupPending, completePasswordChange }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); // eslint-disable-line react/only-export-components