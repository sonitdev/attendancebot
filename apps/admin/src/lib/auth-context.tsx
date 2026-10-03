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
import type { AdminLoginInput, AdminRegistrationInput } from '@workforce/contracts';
import { PORTAL_BRANDING_UPDATED, type PortalBranding } from './portal-branding';

interface AuthContextType {
  session: AdminAuthState | null;
  isLoading: boolean;
  login: (input: AdminLoginInput) => Promise<void>;
  registerOrganization: (input: AdminRegistrationInput) => Promise<void>;
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
    const syncOrganizationMetadata = (event: Event) => {
      const branding = (event as CustomEvent<PortalBranding>).detail;
      if (!branding.id || !branding.name) return;
      setSession((current) => {
        if (!current || current.organization.id !== branding.id || current.organization.name === branding.name) return current;
        const next = {
          ...current,
          organization: { ...current.organization, name: branding.name as string },
        };
        setStoredSession(next);
        return next;
      });
    };
    window.addEventListener(PORTAL_BRANDING_UPDATED, syncOrganizationMetadata);
    return () => window.removeEventListener(PORTAL_BRANDING_UPDATED, syncOrganizationMetadata);
  }, []);

  useEffect(() => {
    if (mounted && !session && pathname !== '/login') {
      router.push('/login');
    }
  }, [mounted, pathname, router, session]);

  useEffect(() => {
    if (!session?.token) return;
    // Prime the core operational data once per authenticated session. Running
    // this again on every route change competed with each page's own request.
    void Promise.all([
      adminApi.getTodayAttendance(),
      adminApi.listEmployees(),
      adminApi.listProjects(),
      adminApi.listSites(),
      adminApi.listSchedules(),
      adminApi.listAssignments(),
      adminApi.getExceptions(),
    ]).catch(() => undefined);
  }, [session?.token]);

  const login = async (input: AdminLoginInput) => {
    const res = await adminApi.login(input);
    const newSession: AdminAuthState = {
      token: res.token,
      user: res.user,
      organization: res.organization,
    };
    setStoredSession(newSession);
    setSession(newSession);
    router.push(`/${res.organization.slug}`);
  };

  const logout = () => {
    clearStoredSession();
    setSession(null);
    router.push('/login');
  };

  const registerOrganization = async (input: AdminRegistrationInput) => {
    const res = await adminApi.registerOrganization(input);
    const newSession: AdminAuthState = {
      token: res.token,
      user: res.user,
      organization: res.organization,
    };
    setStoredSession(newSession);
    setSession(newSession);
    router.push(`/${res.organization.slug}`);
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, registerOrganization, logout }}>
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
