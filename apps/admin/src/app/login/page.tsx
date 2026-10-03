'use client';

import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Building2, HardHat } from 'lucide-react';
import { km } from '@workforce/contracts';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login, registerOrganization } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [organizationName, setOrganizationName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        await registerOrganization({ organizationName, orgSlug, email, password });
      } else {
        await login({ orgSlug, email, password });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AUTHENTICATION_FAILED');
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeMode = (next: 'login' | 'register') => {
    setMode(next);
    setError(null);
    setPassword('');
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#edf3ef] p-4 sm:p-8">
      <section className="w-full max-w-md overflow-hidden rounded-[32px] border border-white bg-white shadow-[0_24px_70px_-32px_rgba(2,63,38,0.35)]">
        <header className="bg-[#023F26] px-7 py-7 text-white">
          <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-white/10">
            <HardHat className="size-6 text-[#C4D701]" />
          </div>
          <h1 className="text-2xl font-black">{km.auth.portalTitle}</h1>
          <p className="mt-2 text-sm leading-6 text-emerald-50/80">
            {mode === 'register' ? km.auth.registrationIntro : km.auth.portalSubtitle}
          </p>
        </header>

        <div className="p-7">
          <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
            <button type="button" onClick={() => changeMode('login')} className={`rounded-xl px-3 py-2.5 text-sm font-bold ${mode === 'login' ? 'bg-white text-[#023F26] shadow-sm' : 'text-slate-500'}`}>
              {km.auth.signIn}
            </button>
            <button type="button" onClick={() => changeMode('register')} className={`rounded-xl px-3 py-2.5 text-sm font-bold ${mode === 'register' ? 'bg-white text-[#023F26] shadow-sm' : 'text-slate-500'}`}>
              {km.auth.createOrganization}
            </button>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <label className="block text-sm font-bold text-slate-700">
                {km.auth.organizationName}
                <div className="relative mt-1.5">
                  <Building2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required minLength={2} maxLength={120} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-[#023F26] focus:ring-2 focus:ring-[#023F26]/10" />
                </div>
              </label>
            )}

            <label className="block text-sm font-bold text-slate-700">
              {km.auth.organizationSlug}
              <input value={orgSlug} onChange={(event) => setOrgSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} required minLength={2} maxLength={60} placeholder="your-company" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-[#023F26] focus:ring-2 focus:ring-[#023F26]/10" />
            </label>

            <label className="block text-sm font-bold text-slate-700">
              {km.auth.email}
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-[#023F26] focus:ring-2 focus:ring-[#023F26]/10" />
            </label>

            <label className="block text-sm font-bold text-slate-700">
              {km.auth.password}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-[#023F26] focus:ring-2 focus:ring-[#023F26]/10" />
              <span className="mt-1 block text-xs font-medium text-slate-400">{km.auth.passwordHint}</span>
            </label>

            <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#023F26] px-4 py-3.5 text-sm font-black text-white transition hover:bg-[#012c1b] disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? (mode === 'register' ? km.auth.creating : km.auth.signingIn) : (mode === 'register' ? km.auth.createOrganization : km.auth.signIn)}
              {!isSubmitting && <ArrowRight className="size-4" />}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
