'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageSquare,
  Phone,
  Shield,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import { km } from '@workforce/contracts';
import { adminApi } from '@/lib/api';

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [employee, setEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'connections' | 'attendance' | 'activity'>('connections');

  async function loadEmployee() {
    if (!id) return;
    try {
      setLoading(true);
      const data = await adminApi.getEmployeeDetail(id);
      setEmployee(data);
    } catch (err: any) {
      setError(err.message || km.attendance.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEmployee();
  }, [id]);

  if (loading) {
    return (
      <main className="">
        <div className="rounded-3xl bg-white p-12 text-center text-sm font-medium text-slate-400 animate-pulse">
          {km.admin.loading}
        </div>
      </main>
    );
  }

  if (error || !employee) {
    return (
      <main className="space-y-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={14} /> {km.admin.back}
        </button>
        <div className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-800 border border-rose-200">
          {error || 'Employee not found'}
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/workforce?tab=employees"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> {km.admin.back}
        </Link>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            employee.status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {employee.status === 'ACTIVE' ? km.admin.active : km.admin.archived}
        </span>
      </div>

      <header className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-[var(--portal-primary)] text-white font-extrabold grid place-items-center text-xl shadow-xs overflow-hidden">
            {employee.avatarUrl ? (
              <img src={employee.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              employee.fullName?.slice(0, 2).toUpperCase() || 'W'
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-slate-950">{employee.fullName}</h1>
              <span className="rounded-md bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-600">
                {employee.employeeCode}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{employee.jobTitle || km.attendance.unassignedPosition}</p>
            {employee.phone && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 font-mono">
                <Phone size={12} className="text-slate-400" /> {employee.phone}
              </p>
            )}
          </div>
        </div>

        {/* Telegram & Current Project card */}
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[10px] font-black uppercase text-slate-400">{km.admin.workerCurrentProject}</p>
            {employee.currentProject ? (
              <Link
                href={`/projects/${employee.currentProject.id}`}
                className="mt-1 font-bold text-slate-900 hover:text-emerald-700 flex items-center gap-1"
              >
                {employee.currentProject.name} <ExternalLink size={12} className="text-slate-400" />
              </Link>
            ) : (
              <p className="mt-1 text-slate-400 italic">—</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[10px] font-black uppercase text-slate-400">Telegram</p>
            {employee.telegramAccount ? (
              <div className="mt-1 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="font-bold text-slate-900 font-mono">
                  {employee.telegramAccount.username ? `@${employee.telegramAccount.username}` : employee.telegramAccount.telegramUserId}
                </span>
              </div>
            ) : (
              <p className="mt-1 text-slate-400 italic">{km.admin.workerTelegramNotLinked}</p>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 w-fit flex-wrap">
        <button
          onClick={() => setActiveTab('connections')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'connections' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Shield size={14} /> {km.admin.workerProjectHistory} ({employee.projectConnections?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('attendance')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'attendance' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Clock size={14} /> {km.admin.workerAttendanceHistory} ({employee.attendance?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'activity' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert size={14} /> {km.admin.workerSecurityActivity} ({employee.activity?.length ?? 0})
        </button>
      </nav>

      {/* Panels */}
      {activeTab === 'connections' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!employee.projectConnections || employee.projectConnections.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {employee.projectConnections.map((conn: any) => (
                <article key={conn.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div>
                    <Link
                      href={`/projects/${conn.projectId}`}
                      className="font-extrabold text-sm text-slate-900 hover:text-emerald-700 flex items-center gap-1"
                    >
                      {conn.project?.name} <ExternalLink size={12} className="text-slate-400" />
                    </Link>
                    <p className="text-xs text-slate-500">
                      {km.admin.connectedAt}: {new Date(conn.connectedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                        conn.authorizationStatus === 'AUTHORIZED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {conn.authorizationStatus}
                    </span>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {km.admin.lastVerified}: {conn.lastVerifiedAt ? new Date(conn.lastVerifiedAt).toLocaleString() : '—'}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!employee.attendance || employee.attendance.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {employee.attendance.map((rec: any) => (
                <article key={rec.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    {rec.checkInPhotoUrl ? (
                      <a
                        href={rec.checkInPhotoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative size-14 shrink-0 overflow-hidden rounded-2xl border-2 border-emerald-500/40 bg-slate-900 shadow-xs hover:border-emerald-600 transition-all"
                        title="មើលរូបភាពភស្តុតាងវត្តមានពេញ"
                      >
                        <img
                          src={rec.checkInPhotoUrl}
                          alt="Proof"
                          className="size-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ExternalLink size={14} className="text-white" />
                        </div>
                      </a>
                    ) : (
                      <div className="size-14 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                        <Clock size={20} />
                      </div>
                    )}
                    <div>
                      <p className="font-extrabold text-sm text-slate-900">
                        {rec.project?.name || '—'} · {rec.site?.name || '—'}
                      </p>
                      <p className="text-xs text-slate-500">{rec.attendanceDate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div className="text-xs">
                      <p className="font-bold text-slate-800">
                        {rec.checkInAt ? new Date(rec.checkInAt).toLocaleTimeString() : '—'} →{' '}
                        {rec.checkOutAt ? new Date(rec.checkOutAt).toLocaleTimeString() : '—'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                        rec.status === 'ON_TIME' || rec.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : rec.status === 'LATE'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {rec.status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'activity' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!employee.activity || employee.activity.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {employee.activity.map((evt: any) => (
                <article key={evt.id} className="p-4 sm:p-5 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        evt.action.includes('DENIED') ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {evt.action}
                    </span>
                    {evt.metadata && (
                      <p className="mt-1.5 text-slate-600 font-mono text-[11px]">
                        {typeof evt.metadata === 'object' ? JSON.stringify(evt.metadata) : String(evt.metadata)}
                      </p>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
                    {new Date(evt.occurredAt).toLocaleString()}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
