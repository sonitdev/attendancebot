'use client';

import { AlertCircle, Clock, Users } from 'lucide-react';
import type { ReactNode } from 'react';

type WorkforcePageHeaderProps = {
  title: string;
  subtitle: string;
  refreshLabel: string;
  isLoading: boolean;
  onRefresh: () => void;
  error: string | null;
  children?: ReactNode;
};

export function WorkforcePageHeader({
  title,
  subtitle,
  refreshLabel,
  isLoading,
  onRefresh,
  error,
  children,
}: WorkforcePageHeaderProps) {
  return (
    <>
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center space-x-2 text-xl font-extrabold text-slate-900">
            <Users className="h-5 w-5 text-[var(--portal-primary)]" />
            <span>{title}</span>
          </h1>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex cursor-pointer items-center space-x-1.5 rounded-xl border-2 border-white bg-[var(--portal-primary)] px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-all hover:brightness-90"
          >
            <Clock className={`h-3.5 w-3.5 text-[var(--portal-accent)] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{refreshLabel}</span>
          </button>
          {children}
        </div>
      </div>
      {error && (
        <div className="flex items-center space-x-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}
