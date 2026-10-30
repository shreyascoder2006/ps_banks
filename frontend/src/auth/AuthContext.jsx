import React, { createContext, useContext, useState } from 'react';
import { client } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('bank_pulse_token'));
  const [role, setRole] = useState(() => localStorage.getItem('bank_pulse_role'));
  const [branch, setBranch] = useState(() => localStorage.getItem('bank_pulse_branch'));

  const login = async (username, password) => {
    const res = await client.post('/auth/login', { username, password });
    localStorage.setItem('bank_pulse_token', res.data.access_token);
    localStorage.setItem('bank_pulse_role', res.data.role);
    localStorage.setItem('bank_pulse_branch', res.data.branch);
    setToken(res.data.access_token);
    setRole(res.data.role);
    setBranch(res.data.branch);
  };

  const logout = () => {
    localStorage.removeItem('bank_pulse_token');
    localStorage.removeItem('bank_pulse_role');
    localStorage.removeItem('bank_pulse_branch');
    setToken(null);
    setRole(null);
    setBranch(null);
  };

  return (
    <AuthContext.Provider value={{ token, role, branch, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
