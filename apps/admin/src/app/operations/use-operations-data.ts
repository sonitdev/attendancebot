'use client';

import { useEffect, useState } from 'react';
import { adminApi, getCachedApiData } from '@/lib/api';

export interface AttendanceRecordItem {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string; avatarUrl: string | null };
  site: { id: string; name: string; timezone: string; allowedRadiusMeters: number; projectId?: string; project?: { id?: string; name: string; code: string } };
  project?: { id: string; name: string; code: string; workMode?: string };
  schedule: { name: string; startTime: string; endTime: string };
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  verificationResult: string | null;
  workDurationMinutes: number | null;
  distanceMeters: number | null;
  eventsCount?: number;
}

export function useOperationsData(selectedProjectId: string, selectedSiteId: string) {
  const [records, setRecords] = useState<AttendanceRecordItem[]>(() => getCachedApiData('/attendance/today') || []);
  const [sites, setSites] = useState<any[]>(() => getCachedApiData('/sites') || []);
  const [projects, setProjects] = useState<any[]>(() => getCachedApiData('/projects') || []);
  const [workerGroups, setWorkerGroups] = useState<any[]>(() => getCachedApiData('/worker-groups') || []);
  const [isLoading, setIsLoading] = useState(() => !getCachedApiData('/attendance/today'));
  const [error, setError] = useState<string | null>(null);

  const loadData = async (showFullLoading = false) => {
    if (showFullLoading) setIsLoading(true);
    setError(null);
    try {
      const [attendanceData, sitesData, projectsData, groupsData] = await Promise.all([
        adminApi.getTodayAttendance({ siteId: selectedSiteId || undefined, projectId: selectedProjectId || undefined }, true),
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
    void loadData(records.length === 0);
    // The API cache/in-flight registry prevents duplicate metadata requests.
    // Filter changes intentionally reload only the attendance query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, selectedSiteId]);

  return { records, setRecords, sites, projects, workerGroups, isLoading, error, setError, loadData };
}
