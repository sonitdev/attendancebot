'use client';

import type { ReactNode } from 'react';

export function WorkforceSectionHeading({ icon, title, subtitle, count }: { icon: ReactNode; title: string; subtitle: string; count?: ReactNode }) {
  return <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">{icon}<span>{title}</span></h2><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div>{count ? <span className="text-xs font-bold text-slate-400">{count}</span> : null}</div>;
}
