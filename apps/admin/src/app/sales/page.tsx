'use client';

import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MapPin,
  MapPinned,
  Pencil,
  Plus,
  ShoppingBag,
  Store,
  UsersRound,
  X,
} from 'lucide-react';
import { km } from '@workforce/contracts';
import { adminApi } from '@/lib/api';
import { ActionStatus, ConfirmActionDialog, type ActionFeedback } from '@/components/ui/action-state';

export default function SalesOperationsPage() {
  const [data, setData] = useState<any>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<ActionFeedback>(null);
  const [tab, setTab] = useState<'overview' | 'outlets' | 'reports'>('overview');
  const [outletForm, setOutletForm] = useState<any>(null);
  const [outletSaving, setOutletSaving] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function loadData() {
    try {
      const [overview, projectList] = await Promise.all([
        adminApi.getSalesOverview(),
        adminApi.listProjects(),
      ]);
      setData(overview);
      setProjects(projectList.filter((p: any) => p.workMode === 'SALES' && p.status === 'ACTIVE'));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function loadOutlets(projectId?: string) {
    try {
      const list = await adminApi.listOutlets(projectId);
      setOutlets(list);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function loadReports(projectId?: string) {
    try {
      const overview = await adminApi.getSalesOverview({ projectId });
      setReports(overview.reports ?? []);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    if (tab === 'outlets') void loadOutlets();
    if (tab === 'reports') void loadReports();
  }, [tab]);

  async function saveOutlet() {
    if (!outletForm?.name?.trim()) return;
    setOutletSaving(true);
    setError('');
    setFeedback({ type: 'info', message: km.actions.saving });
    try {
      if (outletForm.id) {
        await adminApi.updateOutlet(outletForm.id, { name: outletForm.name, code: outletForm.code, address: outletForm.address });
      } else {
        await adminApi.createOutlet({ name: outletForm.name, code: outletForm.code, address: outletForm.address, projectId: outletForm.projectId });
      }
      setOutletForm(null);
      await loadOutlets();
      setFeedback({ type: 'success', message: km.actions.saved });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || km.actions.saveFailed });
    } finally {
      setOutletSaving(false);
    }
  }

  async function archiveOutlet(id: string) {
    if (archiving) return;
    setArchiving(true);
    setFeedback({ type: 'info', message: km.actions.processing });
    try {
      await adminApi.archiveOutlet(id);
      await loadOutlets();
      setArchiveTargetId(null);
      setFeedback({ type: 'success', message: km.actions.archived });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || km.actions.saveFailed });
    } finally {
      setArchiving(false);
    }
  }

  async function openReport(id: string) {
    try {
      const detail = await adminApi.getSalesReportDetail(id);
      setSelectedReport(detail);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const metrics = data ? [
    [km.admin.assigned, data.summary.assigned, UsersRound],
    [km.admin.started, data.summary.started, Clock3],
    [km.admin.visits, data.summary.visits, MapPinned],
    [km.admin.submittedReports, data.summary.submittedReports, CheckCircle2],
    [km.admin.missingReports, data.summary.missingReports, ShoppingBag],
    [km.admin.followUps, data.summary.followUps, ArrowUpRight],
  ] as const : [];

  return (
    <main className="space-y-6">
      <header>
        <p className="text-[11px] font-black uppercase text-[var(--portal-primary)]">{km.admin.fieldSales}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{km.admin.salesTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">{km.admin.salesSubtitle}</p>
      </header>

      <nav className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 w-fit">
        {(['overview', 'outlets', 'reports'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-xs font-black transition-colors ${tab === t ? 'bg-[var(--portal-primary)] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t === 'overview' ? km.attendance.todayStatus : t === 'outlets' ? km.admin.outletManagement : km.admin.reportDetailTitle}
          </button>
        ))}
      </nav>

      {error && <p className="rounded-2xl bg-rose-50 p-4 text-rose-800">{error}</p>}
      <ActionStatus feedback={feedback} />

      {tab === 'overview' && (!data ? (
        <p className="rounded-3xl bg-white p-10 text-center text-slate-500">{km.admin.loading}</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map(([label, value, Icon]) => (
              <article key={label} className="rounded-[24px] border border-white bg-white/85 p-5 shadow-[0_18px_45px_-35px_rgba(2,63,38,.5)]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-slate-500">{label}</p>
                  <Icon size={18} className="text-emerald-700" />
                </div>
                <p className="mt-5 text-4xl font-black text-slate-950">{value}</p>
              </article>
            ))}
          </section>
          <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
            <article className="rounded-[28px] border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">{km.admin.visits}</h2>
              <div className="mt-4 space-y-2">
                {data.visits.length ? data.visits.map((visit: any) => (
                  <div key={visit.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                    <div>
                      <p className="font-black">{visit.outlet?.name || visit.customerName || km.telegram.unknownOutlet}</p>
                      <p className="text-xs text-slate-500">{visit.employee.fullName} · {new Date(visit.visitedAt).toLocaleTimeString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {visit.followUpRequired && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-900">{km.admin.followUps}</span>}
                      <MapPin size={14} className="text-slate-400" />
                    </div>
                  </div>
                )) : <p className="py-10 text-center text-sm text-slate-500">{km.admin.noData}</p>}
              </div>
            </article>
            <article className="rounded-[28px] bg-[var(--portal-primary)] p-6 text-white">
              <h2 className="text-lg font-black">{km.admin.notStarted}</h2>
              <p className="mt-1 text-sm text-white/65">{data.summary.notStarted}</p>
              <div className="mt-5 space-y-2">
                {data.notStarted.map((worker: any) => (
                  <div key={worker.id} className="rounded-2xl bg-white/10 p-3">
                    <p className="font-bold">{worker.fullName}</p>
                    <p className="text-xs text-white/60">{worker.employeeCode}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ))}

      {tab === 'outlets' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-950">{km.admin.outletManagement}</h2>
              <p className="text-sm text-slate-500">{km.admin.outletManagementSubtitle}</p>
            </div>
            <button
              onClick={() => setOutletForm({ name: '', code: '', address: '', projectId: projects[0]?.id ?? '' })}
              className="flex items-center gap-2 rounded-xl bg-[var(--portal-primary)] px-4 py-2.5 text-xs font-black text-white"
            >
              <Plus size={14} /> {km.admin.addOutlet}
            </button>
          </div>
          {projects.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void loadOutlets()} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">{km.admin.allAttendance}</button>
              {projects.map((p) => (
                <button key={p.id} onClick={() => void loadOutlets(p.id)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">{p.name}</button>
              ))}
            </div>
          )}
          <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden">
            {outlets.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-500">{km.admin.noOutlets}</p>
            ) : outlets.map((outlet) => (
              <article key={outlet.id} className="flex items-center justify-between gap-4 border-b border-slate-100 p-5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Store size={18} /></div>
                  <div>
                    <p className="font-black text-slate-950">{outlet.name}</p>
                    <p className="text-xs text-slate-500">{outlet.project?.name ?? '—'}{outlet.code ? ` · ${outlet.code}` : ''}</p>
                    {outlet.address && <p className="text-xs text-slate-400">{outlet.address}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${outlet.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {outlet.status === 'ACTIVE' ? km.admin.outletActive : km.admin.outletArchived}
                  </span>
                  {outlet.status === 'ACTIVE' && (
                    <>
                      <button onClick={() => setOutletForm({ id: outlet.id, name: outlet.name, code: outlet.code ?? '', address: outlet.address ?? '', projectId: outlet.projectId })} className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><Pencil size={14} /></button>
                      <button disabled={archiving} onClick={() => setArchiveTargetId(outlet.id)} className="grid size-9 place-items-center rounded-xl border border-slate-200 text-rose-500 hover:bg-rose-50 disabled:opacity-50"><Archive size={14} /></button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {tab === 'reports' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-950">{km.admin.reportDetailTitle}</h2>
              <p className="text-sm text-slate-500">{km.admin.salesSubtitle}</p>
            </div>
          </div>
          {projects.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void loadReports()} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">{km.admin.allAttendance}</button>
              {projects.map((p) => (
                <button key={p.id} onClick={() => void loadReports(p.id)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">{p.name}</button>
              ))}
            </div>
          )}
          <section className="rounded-[28px] border border-slate-200 bg-white overflow-hidden">
            {reports.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-500">{km.admin.noData}</p>
            ) : reports.map((report: any) => (
              <article key={report.id} className="flex items-center justify-between gap-4 border-b border-slate-100 p-5 last:border-0">
                <div>
                  <p className="font-black text-slate-950">{report.employee?.fullName ?? '—'}{report.employee?.employeeCode ? ` (${report.employee.employeeCode})` : ''}</p>
                  <p className="text-xs text-slate-500">{report.project?.name ?? '—'} · {String(report.reportDate ?? '').slice(0, 10)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${report.status === 'SUBMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                    {report.status === 'SUBMITTED' ? km.attendance.reportSubmitted : km.admin.draft}
                  </span>
                  <button onClick={() => void openReport(report.id)} className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight size={16} /></button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {outletForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-[30px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">{outletForm.id ? km.admin.editOutlet : km.admin.addOutlet}</h2>
              <button onClick={() => setOutletForm(null)}><X size={20} /></button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="block text-xs font-black text-slate-700">{km.admin.project}
                <select value={outletForm.projectId} onChange={(e) => setOutletForm({ ...outletForm, projectId: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm" disabled={!!outletForm.id}>
                  <option value="">—</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-black text-slate-700">{km.admin.outletName}
                <input value={outletForm.name} onChange={(e) => setOutletForm({ ...outletForm, name: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm" />
              </label>
              <label className="block text-xs font-black text-slate-700">{km.admin.outletCode}
                <input value={outletForm.code} onChange={(e) => setOutletForm({ ...outletForm, code: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm" />
              </label>
              <label className="block text-xs font-black text-slate-700">{km.admin.outletAddress}
                <input value={outletForm.address} onChange={(e) => setOutletForm({ ...outletForm, address: e.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm" />
              </label>
            </div>
            <button onClick={() => void saveOutlet()} disabled={outletSaving || !outletForm.name?.trim()} className="mt-5 w-full rounded-xl bg-[var(--portal-primary)] py-3 font-black text-white disabled:opacity-60">
              {outletSaving ? km.admin.loading : km.admin.saveOutlet}
            </button>
          </section>
        </div>
      )}

      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-4 backdrop-blur-sm sm:items-center">
          <section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-[30px] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-black">{selectedReport.employee?.fullName}</h2>
                  {selectedReport.employee?.employeeCode && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {selectedReport.employee.employeeCode}
                    </span>
                  )}
                  {selectedReport.employee?.jobTitle && (
                    <span className="text-xs text-slate-500">· {selectedReport.employee.jobTitle}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{selectedReport.project?.name} · {selectedReport.reportDate}</p>
              </div>
              <button onClick={() => setSelectedReport(null)} className="mt-0.5 rounded-full bg-slate-100 p-1.5"><X size={18} /></button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-500">{km.attendance.checkIn}</p>
                <p className="mt-1 font-black text-slate-900">{selectedReport.attendance?.checkInAt ? new Date(selectedReport.attendance.checkInAt).toLocaleTimeString() : '—'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-500">{km.attendance.checkOut}</p>
                <p className="mt-1 font-black text-slate-900">{selectedReport.attendance?.checkOutAt ? new Date(selectedReport.attendance.checkOutAt).toLocaleTimeString() : '—'}</p>
              </div>
            </div>
            <h3 className="mt-6 text-base font-black text-slate-950">{km.admin.reportVisits} ({selectedReport.visits?.length ?? 0})</h3>
            <div className="mt-3 space-y-4">
              {selectedReport.visits?.map((visit: any, i: number) => (
                <article key={visit.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-900">{i + 1}. {visit.outlet?.name ?? visit.customerName ?? km.telegram.unknownOutlet}</p>
                      <p className="text-xs text-slate-500">{new Date(visit.visitedAt).toLocaleTimeString()}</p>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {visit.followUpRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">{km.admin.visitFollowUp}</span>}
                      {visit.needsContext && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">{km.attendance.completeVisitContext}</span>}
                    </div>
                  </div>
                  {visit.proofPhotoUrl ? (
                    <img src={visit.proofPhotoUrl} alt={km.admin.visitProofPhoto} className="mt-3 aspect-video w-full rounded-xl object-cover" />
                  ) : (
                    <div className="mt-3 flex h-24 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Camera size={24} /></div>
                  )}
                  <div className="mt-3 grid gap-1.5 text-xs">
                    {visit.visitResult && <p><span className="font-black text-slate-600">{km.admin.result}:</span> {visit.visitResult}</p>}
                    {visit.workerStatement && <p><span className="font-black text-slate-600">{km.admin.workerStatement}:</span> {visit.workerStatement}</p>}
                    {visit.note && <p><span className="font-black text-slate-600">{km.attendance.visitNote}:</span> {visit.note}</p>}
                    {visit.potentialOrderQuantity != null && <p><span className="font-black text-slate-600">{km.admin.visitPotentialOrder}:</span> {visit.potentialOrderQuantity}</p>}
                    {visit.requestedDiscountPerItem != null && <p><span className="font-black text-slate-600">{km.admin.visitDiscountRequest}:</span> {visit.requestedDiscountPerItem}</p>}
                    {visit.followUpAt && <p><span className="font-black text-slate-600">{km.admin.visitFollowUp}:</span> {new Date(visit.followUpAt).toLocaleDateString()}</p>}
                    <p className="flex items-center gap-1 text-slate-400"><MapPin size={11} />{Number(visit.latitude).toFixed(5)}, {Number(visit.longitude).toFixed(5)}</p>
                  </div>
                </article>
              ))}
            </div>
            {(selectedReport.workerSummary || selectedReport.additionalNote) && (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-700">{km.attendance.reportSummary}</p>
                {selectedReport.workerSummary && <p className="mt-1 text-sm text-slate-900">{selectedReport.workerSummary}</p>}
                {selectedReport.additionalNote && <p className="mt-2 text-xs text-slate-500">{selectedReport.additionalNote}</p>}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-black ${selectedReport.status === 'SUBMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                {selectedReport.status === 'SUBMITTED' ? km.attendance.reportSubmitted : km.admin.draft}
              </span>
              {selectedReport.submittedAt && <p className="text-xs text-slate-500">{km.admin.reportSubmittedAt}: {new Date(selectedReport.submittedAt).toLocaleString()}</p>}
            </div>
          </section>
        </div>
      )}
      <ConfirmActionDialog open={Boolean(archiveTargetId)} title={km.actions.confirmArchiveTitle} description={km.actions.confirmArchiveDescription} confirmLabel={km.admin.archiveOutlet} destructive pending={archiving} onCancel={() => setArchiveTargetId(null)} onConfirm={() => archiveTargetId && void archiveOutlet(archiveTargetId)} />
    </main>
  );
}
