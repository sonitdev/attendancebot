'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { adminApi, getCachedApiData } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ActionStatus, ConfirmActionDialog, type ActionFeedback } from '@/components/ui/action-state';
import { km, type SiteListItem, type TelegramReportGroupListItem, type WorkerGroupListItem } from '@workforce/contracts';

type PendingDestination = { group: TelegramReportGroupListItem; target: string } | null;

export default function TelegramReportingPage() {
  const { session } = useAuth();
  const [groups, setGroups] = useState<TelegramReportGroupListItem[]>(() => getCachedApiData('/telegram-report-groups') || []);
  const [sites, setSites] = useState<SiteListItem[]>(() => getCachedApiData('/sites') || []);
  const [workerGroups, setWorkerGroups] = useState<WorkerGroupListItem[]>(() => getCachedApiData('/worker-groups') || []);
  const [loading, setLoading] = useState(() => !getCachedApiData('/telegram-report-groups'));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDestination, setPendingDestination] = useState<PendingDestination>(null);
  const [feedback, setFeedback] = useState<ActionFeedback>(null);

  const activeOrganizationId = session?.organization.id;

  const load = useCallback(async (organizationId = activeOrganizationId) => {
    if (!organizationId) return;
    try {
      const [nextGroups, nextSites, nextWorkerGroups] = await Promise.all([
        adminApi.listTelegramReportGroups(),
        adminApi.listSites(),
        adminApi.listWorkerGroups(),
      ]);
      // Ignore a response that began under a different tenant context.
      if (organizationId !== activeOrganizationId) return;
      setGroups(nextGroups);
      setSites(nextSites);
      setWorkerGroups(nextWorkerGroups);
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    } finally {
      if (organizationId === activeOrganizationId) setLoading(false);
    }
  }, [activeOrganizationId]);

  useEffect(() => {
    const hasCachedData = Boolean(getCachedApiData('/telegram-report-groups'));
    if (!hasCachedData) {
      setGroups([]);
      setSites([]);
      setWorkerGroups([]);
    }
    setPendingDestination(null);
    setSavingId(null);
    setFeedback(null);
    setLoading(!hasCachedData);
    void load();
  }, [activeOrganizationId, load]);

  const save = async () => {
    if (!pendingDestination || savingId) return;
    const { group, target } = pendingDestination;
    const [type, id] = target.split(':');
    setSavingId(group.id);
    setFeedback({ type: 'info', message: km.actions.saving });
    try {
      await adminApi.updateTelegramReportGroup(group.id, {
        targetType: type as 'SITE' | 'WORKER_GROUP' | 'NONE',
        ...(id ? { targetId: id } : {}),
        enabled: type !== 'NONE',
      });
      await load(activeOrganizationId);
      setPendingDestination(null);
      setFeedback({ type: 'success', message: km.actions.destinationSaved });
    } catch (reason: any) {
      setFeedback({ type: 'error', message: reason.message || km.actions.saveFailed });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-xs font-bold text-[var(--portal-primary)]">{km.nav.telegramReporting}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{km.telegram.reportingTitle}</h1>
        <p className="mt-2 text-slate-600">{km.telegram.reportingDescription}</p>
      </header>
      <ActionStatus feedback={feedback} />
      {loading ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500">{km.admin.loading}</p> : (
        <section className="space-y-3">
          {groups.map((group) => (
            <article key={group.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div><h2 className="font-bold text-slate-900">{group.title || km.admin.telegramHealthTitle}</h2><p className="text-sm text-slate-500">{group.status === 'ACTIVE' ? km.telegram.reportingActive : km.telegram.reportingPending}</p></div>
                <span className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{savingId === group.id && <LoaderCircle className="size-3 animate-spin"/>}{group.status}</span>
              </div>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                {km.telegram.reportingDestination}
                <select disabled={Boolean(savingId)} className="mt-2 w-full rounded-xl border border-slate-300 p-3 disabled:cursor-wait disabled:opacity-60" value={group.targetType && group.targetId ? `${group.targetType}:${group.targetId}` : 'NONE'} onChange={(event) => setPendingDestination({ group, target: event.target.value })}>
                  <option value="NONE">{km.telegram.reportingNone}</option>
                  <optgroup label={km.telegram.reportingSites}>{sites.filter((site) => site.status === 'ACTIVE').map((site) => <option key={site.id} value={`SITE:${site.id}`}>{site.name} — {site.projectName}</option>)}</optgroup>
                  <optgroup label={km.telegram.reportingWorkerGroups}>{workerGroups.filter((workerGroup) => workerGroup.status === 'ACTIVE').map((workerGroup) => <option key={workerGroup.id} value={`WORKER_GROUP:${workerGroup.id}`}>{workerGroup.name}</option>)}</optgroup>
                </select>
              </label>
            </article>
          ))}
          {groups.length === 0 && <p className="rounded-2xl border border-dashed p-8 text-center text-slate-500">{km.telegram.reportingEmpty}</p>}
        </section>
      )}
      <ConfirmActionDialog open={Boolean(pendingDestination)} title={km.actions.confirmDestinationTitle} description={km.actions.confirmDestinationDescription} confirmLabel={km.actions.confirmChanges} pending={Boolean(savingId)} onCancel={() => setPendingDestination(null)} onConfirm={() => void save()} />
    </main>
  );
}
