'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  adminApi,
  clearStoredSession,
  getStoredSession,
  setStoredSession,
  type AdminAuthState,
} from './api';
import type { AdminLoginInput } from '@workforce/contracts';

interface AuthContextType {
  session: AdminAuthState | null;
  isLoading: boolean;
  login: (input: AdminLoginInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminAuthState | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setSession(getStoredSession());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !session && pathname !== '/login') {
      router.push('/login');
    }
    if (mounted && session) {
      // Warm up in-memory cache in background so all page navigation is instant (0ms)
      adminApi.getTodayAttendance().catch(() => {});
      adminApi.listEmployees().catch(() => {});
      adminApi.listProjects().catch(() => {});
      adminApi.listSites().catch(() => {});
      adminApi.listSchedules().catch(() => {});
      adminApi.listAssignments().catch(() => {});
      adminApi.getExceptions().catch(() => {});
    }
  }, [mounted, session, pathname, router]);

  const login = async (input: AdminLoginInput) => {
    const res = await adminApi.login(input);
    const newSession: AdminAuthState = {
      token: res.token,
      user: res.user,
      organization: res.organization,
    };
    setStoredSession(newSession);
    setSession(newSession);
    router.push('/');
  };

  const logout = () => {
    clearStoredSession();
    setSession(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
