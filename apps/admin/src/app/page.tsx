'use client';

import React, { useState, useTransition } from 'react';
import { adminApi } from '@/lib/api';
import { km } from '@workforce/contracts';
import { useLocale } from '@/lib/locale-context';
import {
  Activity,
  Clock,
  AlertTriangle,
  MapPin,
  RefreshCw,
  X,
  Building,
  Shield,
  ExternalLink,
  HardHat,
  FolderKanban,
  Layers,
  Users,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useOperationsData, type AttendanceRecordItem } from './operations/use-operations-data';
import { OperationsKpis } from './operations/operations-kpis';

export default function OperationsPage() {
  const { isKm } = useLocale();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { records, sites, projects, workerGroups, isLoading, error, setError, loadData } = useOperationsData(selectedProjectId, selectedSiteId);

  const handleOpenDetail = async (id: string) => {
    setSelectedRecordId(id);
    setIsDetailLoading(true);
    try {
      const detail = await adminApi.getAttendanceDetail(id);
      setDetailRecord(detail);
    } catch (err: any) {
      console.error('Failed to load detail', err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedRecordId(null);
    setDetailRecord(null);
  };

  // Format time in site timezone (Asia/Phnom_Penh default)
  const formatTime = (isoString: string | null, timezone = 'Asia/Phnom_Penh') => {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(isoString));
    } catch {
      return isoString.slice(11, 19);
    }
  };

  // Format date in site timezone
  const formatDate = (isoString: string | null, timezone = 'Asia/Phnom_Penh') => {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }).format(new Date(isoString));
    } catch {
      return isoString.slice(0, 10);
    }
  };

  // KPI calculations
  const totalRecords = records.length;
  const presentCount = records.filter(
    (r) => r.checkInAt && !r.checkOutAt && r.status !== 'EARLY_CHECKOUT' && r.status !== 'COMPLETED',
  ).length;
  const completedCount = records.filter((r) => r.status === 'COMPLETED').length;
  const exceptionCount = records.filter(
    (r) =>
      r.status === 'LATE' ||
      r.status === 'EARLY_CHECKOUT' ||
      r.verificationResult === 'OUTSIDE_GEOFENCE' ||
      r.verificationResult === 'LOW_ACCURACY',
  ).length;

  // Visible sites for the selected project
  const visibleSites = selectedProjectId
    ? sites.filter(
        (s) =>
          s.projectId === selectedProjectId ||
          s.project?.id === selectedProjectId ||
          s.project?.code === selectedProjectId,
      )
    : sites;

  const filteredRecords = records.filter((r) => {
    // Project filter
    if (selectedProjectId) {
      const pId = r.project?.id || r.site?.project?.id || r.site?.projectId;
      const matchesSiteInProject = visibleSites.some((s) => s.id === r.site?.id);
      if (pId && pId !== selectedProjectId && !matchesSiteInProject) return false;
      if (!pId && !matchesSiteInProject) return false;
    }

    // Site / Building filter
    if (selectedSiteId && r.site?.id !== selectedSiteId) {
      return false;
    }

    // Workforce Group filter
    if (selectedGroupId) {
      const group = workerGroups.find((g) => g.id === selectedGroupId);
      if (group?.members && Array.isArray(group.members)) {
        const isMember = group.members.some(
          (m: any) => m.employeeId === r.employee?.id || m.id === r.employee?.id,
        );
        if (!isMember) return false;
      }
    }

    // Status filter
    if (selectedStatus === 'PRESENT') return r.checkInAt && !r.checkOutAt;
    if (selectedStatus === 'EXCEPTIONS') {
      return (
        r.status === 'LATE' ||
        r.status === 'EARLY_CHECKOUT' ||
        r.verificationResult === 'OUTSIDE_GEOFENCE' ||
        r.verificationResult === 'LOW_ACCURACY'
      );
    }
    if (selectedStatus && r.status !== selectedStatus) return false;

    return true;
  });

  return (
    <div className="space-y-4 sm:space-y-5 max-w-full overflow-x-hidden">
      {/* Top Header & Compact Refresh Button */}
      <div className="flex items-start justify-between gap-3 pb-0.5">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-[var(--portal-primary)] shrink-0" />
            <span className="truncate">{isKm ? 'ប្រតិបត្តិការវត្តមានថ្ងៃនេះ' : "Today's Site Operations"}</span>
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            {isKm ? 'កំណត់ត្រាវត្តមានជាក់ស្តែងពីការដ្ឋានដែលបាន Check-in ក្នុងថ្ងៃនេះ' : 'Real-time authoritative attendance records for active physical job sites.'}
          </p>
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={isLoading}
          className="shrink-0 inline-flex items-center justify-center size-8 sm:size-auto sm:px-3.5 sm:py-2 rounded-xl bg-[var(--portal-primary)] text-white text-xs font-bold hover:brightness-90 shadow-2xs transition-all active:scale-95 cursor-pointer"
          title="Refresh Live Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[var(--portal-accent)] ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline ml-1.5">{isKm ? 'ផ្ទុកឡើងវិញ' : 'Refresh Live'}</span>
        </button>
      </div>

      <OperationsKpis isKm={isKm} total={totalRecords} present={presentCount} completed={completedCount} exceptions={exceptionCount} onStatus={setSelectedStatus} />

      {/* Multi-Project Category Tabs - Sleek Compact Apple Filter Pills */}
      <div className="space-y-1.5">
        <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-500 px-0.5">
          <FolderKanban className="size-3.5 text-slate-400 shrink-0" />
          <span>{isKm ? 'គម្រោងការងារ' : 'Projects'}</span>
        </div>

        {/* Compact Horizontal Scrollable Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => {
              setSelectedProjectId('');
              setSelectedSiteId('');
            }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
              !selectedProjectId
                ? 'bg-[var(--portal-primary)] text-white shadow-2xs'
                : 'bg-slate-100 hover:bg-slate-200/70 text-slate-600 border border-slate-200/70'
            }`}
          >
            <span>{isKm ? 'គម្រោងទាំងអស់' : 'All Projects'}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                !selectedProjectId ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
              }`}
            >
              {records.length}
            </span>
          </button>

          {projects.map((prj) => {
            const isSelected = selectedProjectId === prj.id;
            const projectRecordsCount = records.filter(
              (r) =>
                r.project?.id === prj.id ||
                r.site?.project?.id === prj.id ||
                r.site?.projectId === prj.id ||
                sites.some((s) => s.projectId === prj.id && s.id === r.site?.id),
            ).length;

            return (
              <button
                key={prj.id}
                type="button"
                onClick={() => {
                  setSelectedProjectId(prj.id);
                  setSelectedSiteId('');
                }}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--portal-primary)] text-white shadow-2xs'
                    : 'bg-slate-100 hover:bg-slate-200/70 text-slate-600 border border-slate-200/70'
                }`}
              >
                <span className="truncate max-w-[140px] sm:max-w-none">{prj.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
                  }`}
                >
                  {projectRecordsCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-Filters: Building/Site within Project, Workforce Group, and Status */}
      <div className="bg-white/90 p-3 sm:p-3.5 rounded-2xl border border-slate-200/80 shadow-xs backdrop-blur-md grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Building / Site Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
            <Building className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
            <span>Building / Site Zone</span>
          </label>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]"
          >
            <option value="">
              {selectedProjectId ? 'All Buildings in this Project' : 'All Buildings & Sites'}
            </option>
            {visibleSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} {site.projectName ? `(${site.projectName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Workforce Group Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
            <span>Workforce Group / Trade</span>
          </label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]"
          >
            <option value="">All Workforce Groups</option>
            {workerGroups.map((grp) => (
              <option key={grp.id} value={grp.id}>
                {grp.name} ({grp.membersCount ?? 0} workers)
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
            <span>Attendance Status</span>
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--portal-primary)]"
          >
            <option value="">All Statuses</option>
            <option value="PRESENT">Currently On Site</option>
            <option value="ON_TIME">On Time</option>
            <option value="LATE">Late</option>
            <option value="COMPLETED">Completed Shift</option>
            <option value="EARLY_CHECKOUT">Early Checkout</option>
            <option value="EXCEPTIONS">Exceptions / Flagged</option>
          </select>
        </div>
      </div>

      {/* Mobile Attendance Cards View (md:hidden) - ZERO horizontal overflow */}
      <div className="md:hidden space-y-2.5">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
            <div className="w-6 h-6 border-2 border-[var(--portal-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading attendance records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
            <HardHat className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            No attendance records match the selected project or filters.
          </div>
        ) : (
          filteredRecords.map((r) => {
            const isOnTime = r.status === 'ON_TIME' || r.status === 'COMPLETED';
            const isLate = r.status === 'LATE';
            const isVerified = r.verificationResult === 'VERIFIED';
            const isOutside = r.verificationResult === 'OUTSIDE_GEOFENCE';

            return (
              <div
                key={r.id}
                onClick={() => handleOpenDetail(r.id)}
                className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-2xs space-y-3 active:scale-[0.99] transition-all cursor-pointer"
              >
                <div className="flex items-start space-x-3.5">
                  {/* Large circular avatar matching exact user mockup (media_1789958242761.png) */}
                  <div className="size-14 sm:size-16 rounded-full overflow-hidden shrink-0 border-2 border-white shadow-xs bg-slate-100 flex items-center justify-center">
                    {r.employee.avatarUrl ? (
                      <img
                        src={r.employee.avatarUrl}
                        alt={r.employee.fullName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-base font-extrabold text-[var(--portal-primary)]">
                        {r.employee.fullName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Top row: Worker Code (Heading 4) + Status Badge matching mockup */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-400 font-mono">
                        {r.employee.employeeCode}
                      </span>
                      <span
                        className={`px-3 py-0.5 rounded-full text-xs font-bold shrink-0 ${
                          isOutside
                            ? 'bg-rose-100 text-rose-800'
                            : isLate
                            ? 'bg-[#962d00] text-white'
                            : isOnTime
                            ? 'bg-[var(--portal-primary)] text-white'
                            : r.status === 'PRESENT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {isOutside
                          ? (isKm ? 'ខាងក្រៅការដ្ឋាន' : 'Outside Site')
                          : isLate
                          ? (isKm ? 'ចូលយឺត' : 'Late')
                          : isOnTime
                          ? (isKm ? 'ចូលទាន់ពេល' : 'On-Time')
                          : r.status.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Bold Worker Full Name */}
                    <h3 className="text-base font-extrabold text-slate-900 leading-tight mt-0.5">
                      {r.employee.fullName}
                    </h3>

                    {/* Project / Site Subtitle */}
                    <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                      Project: {r.site?.project?.name || r.site?.name} • {r.site?.name}
                    </p>
                  </div>
                </div>

                {/* Bottom row stats: Checkin & Checkout matching mockup */}
                <div className="pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1">
                      Checkin
                    </span>
                    <div
                      className={`inline-block font-mono font-bold px-3 py-1 rounded-full text-xs ${
                        isLate
                          ? 'bg-[#962d00] text-white'
                          : 'bg-[var(--portal-primary)] text-white'
                      }`}
                    >
                      {formatTime(r.checkInAt, r.site?.timezone)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 block mb-1">
                      Checkout
                    </span>
                    <div
                      className={`inline-block font-mono font-bold px-3 py-1 rounded-full text-xs ${
                        r.checkOutAt
                          ? 'bg-[var(--portal-primary)] text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {r.checkOutAt ? formatTime(r.checkOutAt, r.site?.timezone) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop attendance list: keep identity, location and decision data together. */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-[var(--portal-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading attendance records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            <HardHat className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            No attendance records match the selected filters today.
          </div>
        ) : (
          <div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-bold uppercase text-slate-500">
                <tr>
                  <th className="w-[38%] px-5 py-3.5">{km.operations.employeeAndSite}</th>
                  <th className="w-[15%] px-4 py-3.5">{km.operations.checkIn}</th>
                  <th className="w-[15%] px-4 py-3.5">{km.operations.checkOut}</th>
                  <th className="w-[18%] px-4 py-3.5">{km.operations.status}</th>
                  <th className="w-[14%] px-5 py-3.5 text-right">{km.operations.details}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredRecords.map((r) => {
                  const isOnTime = r.status === 'ON_TIME' || r.status === 'COMPLETED';
                  const isLate = r.status === 'LATE';
                  const isVerified = r.verificationResult === 'VERIFIED';
                  const isOutside = r.verificationResult === 'OUTSIDE_GEOFENCE';

                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer transition-colors hover:bg-emerald-50/35"
                      onClick={() => handleOpenDetail(r.id)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-xs font-bold text-[var(--portal-primary)]">
                            {r.employee.avatarUrl ? (
                              <img
                                src={r.employee.avatarUrl}
                                alt={r.employee.fullName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span>{r.employee.fullName.slice(0, 2).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-bold text-slate-900">{r.employee.fullName}</div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-500">{r.site.name} <span className="text-slate-300">·</span> {r.site.project?.name || 'Project'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {formatTime(r.checkInAt, r.site.timezone)}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {r.checkOutAt ? formatTime(r.checkOutAt, r.site.timezone) : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {isOutside ? (
                          <span className="inline-flex items-center space-x-1 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>{isKm ? 'ខាងក្រៅការដ្ឋាន' : 'Outside Site'}</span>
                          </span>
                        ) : isVerified ? (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${isLate ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {isLate ? (isKm ? 'ចូលយឺត (Late)' : 'Late') : r.checkOutAt ? (isKm ? 'បានបញ្ចប់' : 'Completed') : (isKm ? 'ចូលទាន់ពេល' : 'On-Time')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-white badge-white-border">
                            {isKm ? 'ធម្មតា' : 'Standard'}
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(r.id);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--portal-primary)] hover:underline"
                        >
                          <span>{isKm ? 'មើលលម្អិត' : 'Timeline'}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal - Portal-based with natural Apple Liquid Glass blur */}
      <Modal
        isOpen={!!selectedRecordId}
        onClose={handleCloseDetail}
        title={
          <div className="flex items-center space-x-2">
            <Shield className="size-4 text-[var(--portal-primary)] shrink-0" />
            <span>{isKm ? 'ភស្តុតាងវត្តមាន & កាលប្បវត្តិផ្លូវការ' : 'Attendance Evidence & Timeline'}</span>
          </div>
        }
        subtitle={selectedRecordId ? `ID: ${selectedRecordId}` : undefined}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          {isDetailLoading || !detailRecord ? (
            <div className="py-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-[var(--portal-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              {isKm ? 'កំពុងទាញយកទិន្នន័យភស្តុតាង...' : 'Retrieving immutable audit events...'}
            </div>
          ) : (
            <>
              {/* Worker & Site Card */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70">
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">{isKm ? 'បុគ្គលិក' : 'Worker'}</div>
                  <div className="font-bold text-slate-900 text-xs mt-0.5 truncate">
                    {detailRecord.employee?.fullName}
                  </div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">
                    {isKm ? 'លេខកូដ:' : 'Code:'} {detailRecord.employee?.employeeCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">{isKm ? 'ការដ្ឋាន' : 'Physical Site'}</div>
                  <div className="font-bold text-slate-900 text-xs mt-0.5 truncate">
                    {detailRecord.site?.name}
                  </div>
                  <div className="text-slate-500 text-[10px] truncate">
                    {isKm ? 'ទីតាំងកំណត់:' : 'Radius:'} {detailRecord.site?.allowedRadiusMeters}m
                  </div>
                </div>
              </div>

              {/* Status & Verification Highlight */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-2xl border border-slate-200/80 bg-slate-50/70">
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">{isKm ? 'ស្ថានភាពវត្តមាន' : 'Attendance Status'}</div>
                  <div className="mt-1">
                    {detailRecord.status === 'LATE' || detailRecord.events?.some((e: any) => e.eventType === 'CHECK_IN_LATE') ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                        <span>⚠️</span> {isKm ? 'ចូលយឺត (Late)' : 'Late Arrival'}
                      </span>
                    ) : detailRecord.status === 'OUTSIDE_GEOFENCE' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                        <span>⚠️</span> {isKm ? 'ខាងក្រៅការដ្ឋាន' : 'Outside Site'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                        <span>✅</span> {isKm ? 'ចូលទាន់ពេល (On Time)' : 'On-Time Arrival'}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">{isKm ? 'ការផ្ទៀងផ្ទាត់ទីតាំង' : 'Location Verification'}</div>
                  <div className="mt-1">
                    {detailRecord.verification === 'OUTSIDE_GEOFENCE' || (detailRecord.distanceMeters != null && detailRecord.site?.allowedRadiusMeters != null && detailRecord.distanceMeters > detailRecord.site.allowedRadiusMeters) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                        <span>⚠️</span> {isKm ? 'ខាងក្រៅការដ្ឋាន' : 'Outside Site'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                        <span>📍</span> {isKm ? 'ក្នុងបរិវេណការដ្ឋាន' : 'Inside Verified Site'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Evidence Specs */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  {isKm ? 'កំណត់ត្រាភស្តុតាងផ្លូវការ' : 'Authoritative Evidence Log'}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">{isKm ? 'ចម្ងាយ' : 'Distance'}</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5">
                      {detailRecord.distanceMeters != null
                        ? `${Math.round(detailRecord.distanceMeters)}m`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">{isKm ? 'ម៉ោងចូល' : 'Arrival'}</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5 truncate">
                      {formatTime(detailRecord.checkInAt, detailRecord.site?.timezone)}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">{isKm ? 'រយៈពេល' : 'Duration'}</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5 truncate">
                      {detailRecord.workDurationMinutes != null
                        ? `${detailRecord.workDurationMinutes}m`
                        : (isKm ? 'កំពុងដំណើរការ' : 'Active')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Proof Photo Evidence */}
              {detailRecord.checkInPhotoUrl && (
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="flex items-center gap-1.5">
                      <span>📸</span> {isKm ? 'រូបភាពភស្តុតាងវត្តមាន (ផ្ទាល់ពីកាមេរ៉ា)' : 'Proof Photo Evidence (Live Camera)'}
                    </span>
                    <a
                      href={detailRecord.checkInPhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                    >
                      {isKm ? 'បើកមើលរូបពេញ ↗' : 'View Full Image ↗'}
                    </a>
                  </div>
                  <div className="relative aspect-[4/3] w-full max-h-60 overflow-hidden rounded-xl bg-slate-900 border border-slate-200 shadow-inner">
                    <img
                      src={detailRecord.checkInPhotoUrl}
                      alt="Attendance Proof"
                      className="size-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Immutable Event Timeline */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-800 flex items-center justify-between">
                  <span>{isKm ? 'ប្រវត្តិកំណត់ត្រាព្រឹត្តិការណ៍' : 'Immutable Event Timeline'}</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {detailRecord.events?.length || 0} {isKm ? 'ព្រឹត្តិការណ៍' : 'events'}
                  </span>
                </div>

                <div className="relative border-l-2 border-slate-200 ml-2.5 space-y-3.5 py-1">
                  {detailRecord.events?.map((ev: any, idx: number) => (
                    <div key={ev.id || idx} className="relative pl-5">
                      {/* Dot */}
                      <div className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-white border-2 border-[var(--portal-primary)] flex items-center justify-center">
                        <div className="w-1 h-1 bg-[var(--portal-primary)] rounded-full" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 font-mono text-xs">
                            {ev.eventType}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatTime(ev.occurredAt, detailRecord.site?.timezone)}
                          </span>
                        </div>
                        {ev.message && (
                          <p className="text-slate-600 text-[11px] mt-0.5">{ev.message}</p>
                        )}
                        {ev.locationEvidence && (
                          <div className="mt-1 p-2 bg-slate-50 rounded-lg border border-slate-200/70 font-mono text-[10px] text-slate-600 break-all">
                            Lat: {Number(ev.locationEvidence.latitude).toFixed(6)}, Lng:{' '}
                            {Number(ev.locationEvidence.longitude).toFixed(6)}, Acc:{' '}
                            {ev.locationEvidence.accuracyMeters}m
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleCloseDetail}
                  className="px-5 py-2.5 rounded-xl bg-[var(--portal-primary)] hover:brightness-90 text-xs font-bold text-white shadow-2xs transition-all active:scale-95 cursor-pointer"
                >
                  {isKm ? 'បិទផ្ទាំង' : 'Close Timeline'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
