'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { BrandRail } from '@/components/login/brand-rail';
import { AlertCircle, ArrowRight, ShieldCheck, HardHat, Check } from 'lucide-react';

const devPersonas = [
  { role: 'Owner / System Admin', email: 'admin@acme.com', icon: '🛡️', badge: 'Full Control' },
  { role: 'HR & Workforce Manager', email: 'hr@acme.com', icon: '👤', badge: 'Employees & Roles' },
  { role: 'Project Manager', email: 'pm@acme.com', icon: '🏗️', badge: 'Projects & Sites' },
  { role: 'Site Manager / Supervisor', email: 'sitemanager@acme.com', icon: '📍', badge: 'Site Attendance' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [orgSlug, setOrgSlug] = useState('acme');
  const [email, setEmail] = useState('admin@acme.com');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ orgSlug, email });
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleLogin = async (roleEmail: string) => {
    setOrgSlug('acme');
    setEmail(roleEmail);
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ orgSlug: 'acme', email: roleEmail });
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 sm:p-6 lg:p-10 bg-[#f2f6f4]">
      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center justify-center gap-6 xl:flex-row xl:items-center">
        {/* Main Authentication Glass Card */}
        <div className="grid w-full max-w-4xl items-stretch overflow-hidden rounded-[36px] border border-white/95 bg-white/80 p-3 shadow-[inset_0_2px_1px_rgba(255,255,255,1),0_28px_80px_-15px_rgba(15,23,42,0.08)] backdrop-blur-[50px] saturate-[190%] lg:grid-cols-[0.95fr_1.05fr] lg:gap-3">
          <BrandRail />

          {/* Form & Dev Control Card */}
          <div className="flex w-full flex-col justify-between rounded-[28px] bg-white p-6 shadow-xs sm:p-7 lg:p-8">
            <div className="flex flex-col gap-4">
              {/* Header Logo & Secure Badge */}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex items-center space-x-2">
                  <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#023F26] text-white">
                    <HardHat className="w-4 h-4 text-[#c4d701]" />
                  </div>
                  <div>
                    <h1 className="text-base font-extrabold tracking-tight text-slate-900 leading-tight">
                      Workforce Portal
                    </h1>
                    <p className="text-[11px] font-semibold text-slate-500">Site Attendance & Operations</p>
                  </div>
                </div>
                <span className="rounded-full border-2 border-white bg-[#023F26] px-3 py-1 text-[11px] font-bold text-white shadow-xs">
                  Secure access
                </span>
              </div>

              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Manage workforce profiles, sites, geofences, and attendance records.
                </p>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start space-x-2 text-rose-800 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Direct Credentials Login Form */}
              <form onSubmit={handleSubmit} className="space-y-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Organization Slug
                  </label>
                  <input
                    type="text"
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#023F26]"
                    placeholder="acme"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Corporate Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#023F26]"
                    placeholder="admin@acme.com"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 border-2 border-white bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Portal'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            {/* Bottom Footer: Powered by Tossana & Cambodia Flag */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4 text-[11px] text-slate-500">
              <div className="flex items-center space-x-1.5 font-semibold text-slate-600">
                <span>Powered by</span>
                <span className="font-extrabold text-[#023F26] tracking-tight">TOSSANA</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-white bg-[#023F26] px-3 py-1 text-[10px] font-bold text-white shadow-xs">
                <span className="text-xs">🇰🇭</span>
                <span>Proud of Cambodia</span>
              </span>
            </div>
          </div>
        </div>

        {/* Split-out Dev Bypass Aside (Independent Floating Card) */}
        <aside className="w-full max-w-sm shrink-0 xl:w-80">
          <div className="rounded-[28px] border border-white/90 bg-white/90 p-5 shadow-lg backdrop-blur-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center space-x-1.5 text-[#023F26] font-bold text-xs uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Dev Bypass Login</span>
              </div>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-mono font-bold">
                Port 5132
              </span>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Click any role below to instantly log in and test management RBAC capabilities:
            </p>

            <div className="space-y-2">
              {devPersonas.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  onClick={() => handleRoleLogin(p.email)}
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-[#023F26]/8 border border-slate-200/80 hover:border-[#023F26]/30 text-slate-800 text-xs font-semibold transition-all group text-left cursor-pointer"
                >
                  <div className="flex items-center space-x-2.5">
                    <span className="text-lg">{p.icon}</span>
                    <div>
                      <div className="font-bold text-slate-900 group-hover:text-[#023F26]">
                        {p.role}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">{p.email}</div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#023F26] group-hover:translate-x-0.5 transition-transform" />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
