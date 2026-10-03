'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Building,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { km } from '@workforce/contracts';
import { adminApi } from '@/lib/api';
import { ActionStatus, type ActionFeedback } from '@/components/ui/action-state';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<ActionFeedback>(null);
  const [activeTab, setActiveTab] = useState<'workers' | 'attendance' | 'events' | 'sites'>('workers');

  async function loadProject() {
    if (!id) return;
    try {
      setLoading(true);
      const data = await adminApi.getProjectDetail(id);
      setProject(data);
    } catch (err: any) {
      setError(err.message || km.attendance.requestFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProject();
  }, [id]);

  async function handleRefreshHealth() {
    if (!id || refreshing) return;
    try {
      setRefreshing(true);
      setFeedback({ type: 'info', message: km.actions.processing });
      await adminApi.refreshProjectTelegramHealth(id);
      await loadProject();
      setFeedback({ type: 'success', message: km.actions.healthRefreshed });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || km.attendance.requestFailed });
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <main className="">
        <div className="rounded-3xl bg-white p-12 text-center text-sm font-medium text-slate-400 animate-pulse">
          {km.admin.loading}
        </div>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="space-y-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={14} /> {km.admin.back}
        </button>
        <div className="rounded-2xl bg-rose-50 p-6 text-sm text-rose-800 border border-rose-200">
          {error || 'Project not found'}
        </div>
      </main>
    );
  }

  const healthStatus = project.telegramConnectionStatus || 'PENDING';
  const healthBadge =
    healthStatus === 'CONNECTED'
      ? { label: km.admin.telegramConnected, icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
      : healthStatus === 'BOT_REMOVED'
      ? { label: km.admin.telegramBotRemoved, icon: XCircle, color: 'bg-rose-100 text-rose-800 border-rose-200' }
      : healthStatus === 'PERMISSION_ERROR'
      ? { label: km.admin.telegramPermissionError, icon: ShieldAlert, color: 'bg-amber-100 text-amber-900 border-amber-200' }
      : { label: km.admin.telegramPending, icon: Clock, color: 'bg-sky-100 text-sky-800 border-sky-200' };

  const HealthIcon = healthBadge.icon;

  return (
    <main className="space-y-6">
      <ActionStatus feedback={feedback} />
      <div className="flex items-center justify-between">
        <Link
          href="/workforce?tab=projects-sites"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> {km.admin.back}
        </Link>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            project.status === 'ACTIVE'
              ? 'bg-emerald-100 text-emerald-800'
              : project.status === 'ARCHIVED'
              ? 'bg-slate-100 text-slate-600'
              : 'bg-amber-100 text-amber-900'
          }`}
        >
          {project.status === 'ACTIVE' ? km.admin.active : project.status === 'ARCHIVED' ? km.admin.archived : project.status}
        </span>
      </div>

      <header className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-slate-950">{project.name}</h1>
            <span className="rounded-md bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-600">
              {project.code}
            </span>
            <span className="rounded-md bg-[var(--portal-primary)]/10 px-2.5 py-0.5 text-xs font-bold text-[var(--portal-primary)]">
              {project.workMode === 'SALES' ? km.attendance.salesMode : km.attendance.siteMode}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">ID: {project.id}</p>
        </div>

        {/* Telegram Health Widget */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:self-start">
          <div className="grid size-10 place-items-center rounded-xl bg-white shadow-xs">
            <HealthIcon size={20} className={healthBadge.color.includes('emerald') ? 'text-emerald-700' : 'text-amber-700'} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${healthBadge.color}`}>
                {healthBadge.label}
              </span>
              {project.telegramChatId && (
                <span className="font-mono text-[10px] text-slate-400">
                  Chat: {project.telegramChatId}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {km.admin.telegramLastChecked}: {project.telegramHealthCheckedAt ? new Date(project.telegramHealthCheckedAt).toLocaleString() : '—'}
            </p>
            {project.telegramHealthError && (
              <p className="mt-0.5 text-[10px] text-rose-600 font-semibold">{project.telegramHealthError}</p>
            )}
          </div>
          <button
            onClick={() => void handleRefreshHealth()}
            disabled={refreshing || !project.telegramChatId}
            title={km.admin.telegramRefreshHealth}
            className="grid size-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-emerald-700' : ''} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 w-fit flex-wrap">
        <button
          onClick={() => setActiveTab('workers')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'workers' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users size={14} /> {km.admin.projectWorkerConnections} ({project.workerConnections?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('attendance')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'attendance' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Clock size={14} /> {km.admin.projectAttendanceHistory} ({project.attendanceRecords?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('events')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'events' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert size={14} /> {km.admin.projectAccessEvents} ({project.accessEvents?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('sites')}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-colors ${
            activeTab === 'sites' ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <MapPin size={14} /> {km.attendance.assignedSite} ({project.sites?.length ?? 0})
        </button>
      </nav>

      {/* Tab Panels */}
      {activeTab === 'workers' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!project.workerConnections || project.workerConnections.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.workerConnections.map((conn: any) => (
                <article key={conn.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-emerald-50 text-emerald-800 font-extrabold grid place-items-center text-xs">
                      {conn.employee?.fullName?.slice(0, 2).toUpperCase() || 'W'}
                    </div>
                    <div>
                      <Link
                        href={`/employees/${conn.employeeId}`}
                        className="font-extrabold text-sm text-slate-900 hover:text-emerald-700 flex items-center gap-1"
                      >
                        {conn.employee?.fullName} <ExternalLink size={12} className="text-slate-400" />
                      </Link>
                      <p className="text-xs text-slate-400">{conn.employee?.employeeCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div>
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
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!project.attendanceRecords || project.attendanceRecords.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.attendanceRecords.map((rec: any) => (
                <article key={rec.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-extrabold text-sm text-slate-900">{rec.employee?.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {rec.attendanceDate} · {rec.site?.name || '—'}
                    </p>
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

      {activeTab === 'events' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!project.accessEvents || project.accessEvents.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.accessEvents.map((evt: any) => (
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

      {activeTab === 'sites' && (
        <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
          {!project.sites || project.sites.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">{km.admin.noData}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {project.sites.map((site: any) => (
                <article key={site.id} className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-extrabold text-sm text-slate-900">{site.name}</p>
                    <p className="text-xs text-slate-500">
                      {km.attendance.allowedDistance} {site.allowedRadiusMeters}m · {site.timezone}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <MapPin size={13} /> {site.latitude?.toFixed(4)}, {site.longitude?.toFixed(4)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
