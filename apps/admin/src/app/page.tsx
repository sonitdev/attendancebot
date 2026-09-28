'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { adminApi, getCachedApiData } from '@/lib/api';
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MapPin,
  RefreshCw,
  X,
  UserCheck,
  Building,
  Shield,
  ExternalLink,
  HardHat,
  FolderKanban,
  Layers,
  Users,
} from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';
import { Modal } from '@/components/ui/modal';

interface AttendanceRecordItem {
  id: string;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    avatarUrl: string | null;
  };
  site: {
    id: string;
    name: string;
    timezone: string;
    allowedRadiusMeters: number;
    projectId?: string;
    project?: {
      id?: string;
      name: string;
      code: string;
    };
  };
  schedule: {
    name: string;
    startTime: string;
    endTime: string;
  };
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  verificationResult: string | null;
  workDurationMinutes: number | null;
  distanceMeters: number | null;
  eventsCount?: number;
}

export default function OperationsPage() {
  const [records, setRecords] = useState<AttendanceRecordItem[]>(() => getCachedApiData('/attendance/today') || []);
  const [sites, setSites] = useState<any[]>(() => getCachedApiData('/sites') || []);
  const [projects, setProjects] = useState<any[]>(() => getCachedApiData('/projects') || []);
  const [workerGroups, setWorkerGroups] = useState<any[]>(() => getCachedApiData('/worker-groups') || []);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !getCachedApiData('/attendance/today'));
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadData = async (showFullLoading = false) => {
    if (showFullLoading) setIsLoading(true);
    setError(null);
    try {
      const [attendanceData, sitesData, projectsData, groupsData] = await Promise.all([
        adminApi.getTodayAttendance({
          siteId: selectedSiteId || undefined,
          projectId: selectedProjectId || undefined,
        }, true),
        adminApi.listSites(),
        adminApi.listProjects(),
        adminApi.listWorkerGroups().catch(() => []),
      ]);
      setRecords(attendanceData || []);
      setSites(sitesData || []);
      setProjects(projectsData || []);
      setWorkerGroups(groupsData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance records');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(records.length === 0);
  }, [selectedProjectId, selectedSiteId]);

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
      const pId = r.site?.project?.id || r.site?.projectId;
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
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#023F26] shrink-0" />
            <span className="truncate">Today's Site Operations</span>
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Real-time authoritative attendance records for active physical job sites.
          </p>
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={isLoading}
          className="shrink-0 inline-flex items-center justify-center size-8 sm:size-auto sm:px-3.5 sm:py-2 rounded-xl bg-[#023F26] text-white text-xs font-bold hover:bg-[#012919] shadow-2xs transition-all active:scale-95 cursor-pointer"
          title="Refresh Live Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#c4d701] ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline ml-1.5">Refresh Live</span>
        </button>
      </div>

      {/* KPI Stat Cards (2-column on mobile, 4-column on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <KpiCard
          label="Total Checked In"
          value={totalRecords}
          tone="blue"
          detail="Assigned workers today"
          icon={UserCheck}
        />
        <KpiCard
          label="Currently On Site"
          value={presentCount}
          tone="green"
          detail="Open active shifts"
          icon={Activity}
          onClick={() => setSelectedStatus('PRESENT')}
        />
        <KpiCard
          label="Completed Shifts"
          value={completedCount}
          tone="neutral"
          detail="Checked out with duration"
          icon={CheckCircle2}
          onClick={() => setSelectedStatus('COMPLETED')}
        />
        <KpiCard
          label="Exceptions / Flagged"
          value={exceptionCount}
          tone={exceptionCount > 0 ? 'warning' : 'neutral'}
          detail="Late, Early, or Outside"
          icon={AlertTriangle}
          onClick={() => setSelectedStatus('EXCEPTIONS')}
        />
      </div>

      {/* Multi-Project Category Tabs - Sleek Compact Apple Filter Pills */}
      <div className="space-y-1.5">
        <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-500 px-0.5">
          <FolderKanban className="size-3.5 text-slate-400 shrink-0" />
          <span>Projects</span>
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
                ? 'bg-[#023F26] text-white shadow-2xs'
                : 'bg-slate-100 hover:bg-slate-200/70 text-slate-600 border border-slate-200/70'
            }`}
          >
            <span>All Projects</span>
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
                    ? 'bg-[#023F26] text-white shadow-2xs'
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
            <Building className="w-3.5 h-3.5 text-[#023F26]" />
            <span>Building / Site Zone</span>
          </label>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#023F26]"
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
            <Layers className="w-3.5 h-3.5 text-[#023F26]" />
            <span>Workforce Group / Trade</span>
          </label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#023F26]"
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
            <Clock className="w-3.5 h-3.5 text-[#023F26]" />
            <span>Attendance Status</span>
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#023F26]"
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
            <div className="w-6 h-6 border-2 border-[#023F26] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
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
                      <span className="text-base font-extrabold text-[#023F26]">
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
                          isLate
                            ? 'bg-[#962d00] text-white'
                            : isOnTime
                            ? 'bg-[#023F26] text-white'
                            : r.status === 'PRESENT'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {isLate ? 'Late' : r.status.replace('_', ' ')}
                      </span>
                    </div>

                    {/* Bold Worker Full Name */}
                    <h3 className="text-base font-extrabold text-slate-900 tracking-tight leading-tight mt-0.5">
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
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                      Checkin
                    </span>
                    <div
                      className={`inline-block font-mono font-bold px-3 py-1 rounded-full text-xs ${
                        isLate
                          ? 'bg-[#962d00] text-white'
                          : 'bg-[#023F26] text-white'
                      }`}
                    >
                      {formatTime(r.checkInAt, r.site?.timezone)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                      Checkout
                    </span>
                    <div
                      className={`inline-block font-mono font-bold px-3 py-1 rounded-full text-xs ${
                        r.checkOutAt
                          ? 'bg-[#023F26] text-white'
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

      {/* Desktop Main Table (hidden md:block) */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-[#023F26] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading attendance records...
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            <HardHat className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            No attendance records match the selected filters today.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Site / Project</th>
                  <th className="py-3 px-4">Shift Schedule</th>
                  <th className="py-3 px-4">Arrival</th>
                  <th className="py-3 px-4">Departure</th>
                  <th className="py-3 px-4">Verification</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Details</th>
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
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      onClick={() => handleOpenDetail(r.id)}
                    >
                      {/* Employee */}
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center shrink-0 text-slate-600 font-medium">
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
                          <div>
                            <div className="font-semibold text-slate-900">{r.employee.fullName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {r.employee.employeeCode}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Site / Project */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{r.site.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {r.site.project?.code || 'PRJ'} • {r.site.project?.name || ''}
                        </div>
                      </td>

                      {/* Shift Schedule */}
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                        {r.schedule.startTime} – {r.schedule.endTime}
                      </td>

                      {/* Arrival */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-medium text-slate-900">
                          {formatTime(r.checkInAt, r.site.timezone)}
                        </div>
                        <div className="mt-0.5">
                          {isLate ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#a16207] text-white badge-white-border">
                              Late
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#023F26] text-white badge-white-border">
                              On time
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Departure */}
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {r.checkOutAt ? formatTime(r.checkOutAt, r.site.timezone) : '—'}
                        </div>
                        <div className="mt-0.5">
                          {r.status === 'COMPLETED' && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#023F26] text-white badge-white-border">
                              Completed
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Verification */}
                      <td className="py-3 px-4">
                        {isOutside ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#9f1239] text-white badge-white-border">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>Outside Geofence</span>
                          </span>
                        ) : isVerified ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#047857] text-white badge-white-border">
                            <Shield className="w-3 h-3 shrink-0 text-[#c4d701]" />
                            <span>Verified</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-white badge-white-border">
                            Standard
                          </span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700">
                        {r.workDurationMinutes != null
                          ? `${Math.floor(r.workDurationMinutes / 60)}h ${r.workDurationMinutes % 60}m`
                          : '—'}
                      </td>

                      {/* Detail CTA */}
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(r.id);
                          }}
                          className="text-[#023F26] hover:underline font-bold text-[11px] inline-flex items-center space-x-1 cursor-pointer"
                        >
                          <span>Timeline</span>
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
            <Shield className="size-4 text-[#023F26] shrink-0" />
            <span>Attendance Evidence & Timeline</span>
          </div>
        }
        subtitle={selectedRecordId ? `ID: ${selectedRecordId}` : undefined}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          {isDetailLoading || !detailRecord ? (
            <div className="py-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-[#023F26] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Retrieving immutable audit events...
            </div>
          ) : (
            <>
              {/* Worker & Site Card */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/70">
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Worker</div>
                  <div className="font-bold text-slate-900 text-xs mt-0.5 truncate">
                    {detailRecord.employee?.fullName}
                  </div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">
                    Code: {detailRecord.employee?.employeeCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono uppercase">Physical Site</div>
                  <div className="font-bold text-slate-900 text-xs mt-0.5 truncate">
                    {detailRecord.site?.name}
                  </div>
                  <div className="text-slate-500 text-[10px] truncate">
                    Radius: {detailRecord.site?.allowedRadiusMeters}m
                  </div>
                </div>
              </div>

              {/* Evidence Specs */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-800">
                  Authoritative Evidence Log
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Distance</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5">
                      {detailRecord.distanceMeters != null
                        ? `${Math.round(detailRecord.distanceMeters)}m`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Arrival</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5 truncate">
                      {formatTime(detailRecord.checkInAt, detailRecord.site?.timezone)}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Duration</div>
                    <div className="text-xs font-bold font-mono text-slate-800 mt-0.5 truncate">
                      {detailRecord.workDurationMinutes != null
                        ? `${detailRecord.workDurationMinutes}m`
                        : 'Active'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Immutable Event Timeline */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-800 flex items-center justify-between">
                  <span>Immutable Event Timeline</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {detailRecord.events?.length || 0} events
                  </span>
                </div>

                <div className="relative border-l-2 border-slate-200 ml-2.5 space-y-3.5 py-1">
                  {detailRecord.events?.map((ev: any, idx: number) => (
                    <div key={ev.id || idx} className="relative pl-5">
                      {/* Dot */}
                      <div className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-white border-2 border-[#023F26] flex items-center justify-center">
                        <div className="w-1 h-1 bg-[#023F26] rounded-full" />
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
                  className="px-5 py-2.5 rounded-xl bg-[#023F26] hover:bg-[#012919] text-xs font-bold text-white shadow-2xs transition-all active:scale-95 cursor-pointer"
                >
                  Close Timeline
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
