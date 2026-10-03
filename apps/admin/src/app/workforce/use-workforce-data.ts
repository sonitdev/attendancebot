import { useCallback, useEffect, useState } from 'react';
import { adminApi, getCachedApiData } from '@/lib/api';
import type {
  AssignmentListItem,
  EmployeeListItem,
  PositionListItem,
  PositionRequestListItem,
  ProjectListItem,
  RegistrationRequestListItem,
  SiteListItem,
  WorkScheduleListItem,
  WorkerGroupListItem,
} from '@workforce/contracts';

type WorkforceTab = 'employees' | 'positions' | 'worker-groups' | 'position-requests' | 'projects-sites' | 'assignments';

export function useWorkforceData(activeTab: WorkforceTab) {
  const [employees, setEmployees] = useState<EmployeeListItem[]>(() => getCachedApiData<EmployeeListItem[]>('/employees') || []);
  const [projects, setProjects] = useState<ProjectListItem[]>(() => getCachedApiData<ProjectListItem[]>('/projects') || []);
  const [sites, setSites] = useState<SiteListItem[]>(() => getCachedApiData<SiteListItem[]>('/sites') || []);
  const [schedules, setSchedules] = useState<WorkScheduleListItem[]>(() => getCachedApiData<WorkScheduleListItem[]>('/schedules') || []);
  const [assignments, setAssignments] = useState<AssignmentListItem[]>(() => getCachedApiData<AssignmentListItem[]>('/assignments') || []);
  const [positions, setPositions] = useState<PositionListItem[]>(() => getCachedApiData<PositionListItem[]>('/positions') || []);
  const [positionRequests, setPositionRequests] = useState<PositionRequestListItem[]>(() => getCachedApiData<PositionRequestListItem[]>('/position-requests') || []);
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequestListItem[]>(() => getCachedApiData<RegistrationRequestListItem[]>('/registration-requests') || []);
  const [workerGroups, setWorkerGroups] = useState<WorkerGroupListItem[]>(() => getCachedApiData<WorkerGroupListItem[]>('/worker-groups') || []);
  const [isLoading, setIsLoading] = useState(() => !getCachedApiData('/employees'));
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessMessage, setLastSuccessMessage] = useState<string | null>(null);

  const loadAllData = useCallback(async (showFullLoading = false, successMessage?: string) => {
    if (showFullLoading) setIsLoading(true);
    setError(null);
    if (successMessage) setLastSuccessMessage(successMessage);
    try {
      const needsDirectory = activeTab === 'employees' || activeTab === 'positions' || activeTab === 'worker-groups' || activeTab === 'position-requests';
      const needsProjects = activeTab === 'projects-sites' || activeTab === 'assignments';
      const needsAssignments = activeTab === 'employees' || activeTab === 'assignments';
      const [empData, prjData, siteData, schData, assignData, posData, reqData, regReqData, grpData] = await Promise.all([
        needsDirectory || needsAssignments ? adminApi.listEmployees() : Promise.resolve(null),
        needsProjects || needsAssignments ? adminApi.listProjects() : Promise.resolve(null),
        needsProjects || needsAssignments ? adminApi.listSites() : Promise.resolve(null),
        needsProjects || needsAssignments ? adminApi.listSchedules() : Promise.resolve(null),
        needsAssignments ? adminApi.listAssignments() : Promise.resolve(null),
        needsDirectory ? adminApi.listPositions() : Promise.resolve(null),
        activeTab === 'position-requests' || activeTab === 'employees' ? adminApi.listPositionRequests() : Promise.resolve(null),
        activeTab === 'employees' ? adminApi.listRegistrationRequests() : Promise.resolve(null),
        activeTab === 'worker-groups' || activeTab === 'employees' ? adminApi.listWorkerGroups() : Promise.resolve(null),
      ]);
      if (empData) setEmployees(empData);
      if (prjData) setProjects(prjData);
      if (siteData) setSites(siteData);
      if (schData) setSchedules(schData);
      if (assignData) setAssignments(assignData);
      if (posData) setPositions(posData);
      if (reqData) setPositionRequests(reqData);
      if (regReqData) setRegistrationRequests(regReqData);
      if (grpData) setWorkerGroups(grpData);
    } catch (reason: any) {
      setError(reason?.message || 'Failed to load workforce records');
      throw reason;
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { void loadAllData(); }, [loadAllData]);

  return {
    employees, setEmployees,
    projects, setProjects,
    sites, setSites,
    schedules, setSchedules,
    assignments, setAssignments,
    positions, setPositions,
    positionRequests, setPositionRequests,
    registrationRequests, setRegistrationRequests,
    workerGroups, setWorkerGroups,
    isLoading, error, setError,
    loadAllData, lastSuccessMessage,
  };
}
