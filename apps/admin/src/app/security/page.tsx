'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { km } from '@workforce/contracts';
import { adminApi } from '@/lib/api';

export default function SecurityEventsPage() {
  const [events, setEvents] = useState<any[]>([]); const [error, setError] = useState('');
  useEffect(() => { adminApi.listSecurityEvents().then(setEvents).catch((reason) => setError(reason.message)); }, []);
  return <main className="space-y-6"><header className="flex items-end justify-between"><div><p className="text-[11px] font-black uppercase text-[var(--portal-primary)]">{km.admin.interfaceSecurity}</p><h1 className="mt-2 text-3xl font-black">{km.admin.securityTitle}</h1><p className="mt-2 text-sm text-slate-600">{km.admin.securitySubtitle}</p></div><ShieldCheck className="text-emerald-800" size={32}/></header>{error && <p className="rounded-2xl bg-rose-50 p-4 text-rose-800">{error}</p>}<section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white">{events.length ? events.map((event) => <article key={event.id} className="grid gap-3 border-b border-slate-100 p-5 last:border-0 md:grid-cols-[1fr_1fr_1fr_2fr]"><p className="font-black text-slate-900">{event.action}</p><p className="text-sm text-slate-600">{event.targetType} · {event.targetId}</p><p className="text-sm text-slate-500">{new Date(event.occurredAt).toLocaleString()}</p><pre className="overflow-auto whitespace-pre-wrap text-xs text-slate-500">{JSON.stringify(event.metadata, null, 2)}</pre></article>) : <p className="p-10 text-center text-slate-500">{km.admin.noData}</p>}</section></main>;
}
