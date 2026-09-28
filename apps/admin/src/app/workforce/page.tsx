'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { adminApi, getCachedApiData } from '@/lib/api';
import type {
  AssignmentListItem,
  EmployeeListItem,
  ProjectListItem,
  SiteListItem,
  WorkScheduleListItem,
  PositionListItem,
  EmployeePositionHistoryItem,
  PositionRequestListItem,
  WorkerGroupListItem,
  WorkerGroupMemberItem,
  RegistrationRequestListItem,
} from '@workforce/contracts';
import {
  Users,
  Building,
  MapPin,
  Clock,
  Calendar,
  Plus,
  Send,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  X,
  Pencil,
  Trash2,
  Briefcase,
  Layers,
  UserCheck,
  ShieldCheck,
  Check,
  Ban,
  Filter,
  ChevronDown,
} from 'lucide-react';

import { useSearchParams } from 'next/navigation';
import { Modal } from '@/components/ui/modal';

const SiteLocationPicker = dynamic(() => import('@/components/sites/site-location-picker'), { ssr: false });

type Tab = 'employees' | 'positions' | 'worker-groups' | 'position-requests' | 'projects-sites' | 'assignments';

function WorkforcePageContent() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const queryTab: Tab = requestedTab === 'projects-sites' || requestedTab === 'assignments'
    ? requestedTab
    : 'employees';
  const [activeTab, setActiveTab] = useState<Tab>(queryTab);

  useEffect(() => {
    if (['employees', 'projects-sites', 'assignments'].includes(queryTab)) {
      setActiveTab(queryTab);
    }
  }, [queryTab]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>(() => getCachedApiData<EmployeeListItem[]>('/employees') || []);
  const [projects, setProjects] = useState<ProjectListItem[]>(() => getCachedApiData<ProjectListItem[]>('/projects') || []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteListItem[]>(() => getCachedApiData<SiteListItem[]>('/sites') || []);
  const [schedules, setSchedules] = useState<WorkScheduleListItem[]>(() => getCachedApiData<WorkScheduleListItem[]>('/schedules') || []);
  const [assignments, setAssignments] = useState<AssignmentListItem[]>(() => getCachedApiData<AssignmentListItem[]>('/assignments') || []);
  const [positions, setPositions] = useState<PositionListItem[]>(() => getCachedApiData<PositionListItem[]>('/positions') || []);
  const [positionRequests, setPositionRequests] = useState<PositionRequestListItem[]>(() => getCachedApiData<PositionRequestListItem[]>('/position-requests') || []);
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequestListItem[]>(() => getCachedApiData<RegistrationRequestListItem[]>('/registration-requests') || []);
  const [workerGroups, setWorkerGroups] = useState<WorkerGroupListItem[]>(() => getCachedApiData<WorkerGroupListItem[]>('/worker-groups') || []);

  const [isLoading, setIsLoading] = useState<boolean>(() => !getCachedApiData('/employees'));
  const [error, setError] = useState<string | null>(null);

  // Directory Filters & Multi-select
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [requestsSubTab, setRequestsSubTab] = useState<'registration' | 'position'>('registration');

  // Modal states
  const [modalType, setModalType] = useState<
    | 'employee'
    | 'edit-employee'
    | 'telegram'
    | 'project'
    | 'edit-project'
    | 'site'
    | 'edit-site'
    | 'schedule'
    | 'edit-schedule'
    | 'assignment'
    | 'position'
    | 'edit-position'
    | 'assign-position'
    | 'position-history'
    | 'group'
    | 'edit-group'
    | 'group-members'
    | 'resolve-request'
    | 'resolve-registration'
    | null
  >(null);

  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeListItem | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeListItem | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(null);
  const [editingSite, setEditingSite] = useState<SiteListItem | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<WorkScheduleListItem | null>(null);
  const [editingPosition, setEditingPosition] = useState<PositionListItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<WorkerGroupListItem | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<WorkerGroupListItem | null>(null);
  const [groupMembers, setGroupMembers] = useState<WorkerGroupMemberItem[]>([]);
  const [positionHistory, setPositionHistory] = useState<EmployeePositionHistoryItem[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<PositionRequestListItem | null>(null);
  const [selectedRegRequest, setSelectedRegRequest] = useState<RegistrationRequestListItem | null>(null);

  // Forms for registration resolve
  const [regEmpCode, setRegEmpCode] = useState('');
  const [regFullName, setRegFullName] = useState('');
  const [regPositionId, setRegPositionId] = useState('');

  // Forms
  const [empCode, setEmpCode] = useState('');
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empTitle, setEmpTitle] = useState('');

  const [tgUserId, setTgUserId] = useState('');
  const [tgUsername, setTgUsername] = useState('');

  const [prjCode, setPrjCode] = useState('');
  const [prjName, setPrjName] = useState('');

  const [siteProjectId, setSiteProjectId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteLat, setSiteLat] = useState('11.5564');
  const [siteLng, setSiteLng] = useState('104.9282');
  const [siteRadius, setSiteRadius] = useState('100');
  const [siteTimezone, setSiteTimezone] = useState('Asia/Phnom_Penh');
  const [pastedMapUrl, setPastedMapUrl] = useState('');
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [mapResolveError, setMapResolveError] = useState<string | null>(null);
  const [mapResolving, setMapResolving] = useState(false);
  const mapResolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const [schName, setSchName] = useState('');
  const [schStart, setSchStart] = useState('08:00');
  const [schEnd, setSchEnd] = useState('17:00');
  const [schGrace, setSchGrace] = useState('15');
  const [schTimezone, setSchTimezone] = useState('Asia/Phnom_Penh');

  const [assignEmpId, setAssignEmpId] = useState('');
  const [assignSiteId, setAssignSiteId] = useState('');
  const [assignSchId, setAssignSchId] = useState('');
  const [assignStartsOn, setAssignStartsOn] = useState('2026-01-01');
  const [assignEndsOn, setAssignEndsOn] = useState('2026-12-31');
  const [expandedAssignmentEmployeeId, setExpandedAssignmentEmployeeId] = useState<string | null>(null);

  // Position Forms
  const [posCode, setPosCode] = useState('');
  const [posName, setPosName] = useState('');
  const [posDesc, setPosDesc] = useState('');
  const [assignPosId, setAssignPosId] = useState('');
  const [assignEffectiveFrom, setAssignEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 16));

  // Request Form
  const [reviewNote, setReviewNote] = useState('');

  // Group Form
  const [grpCode, setGrpCode] = useState('');
  const [grpName, setGrpName] = useState('');
  const [grpDesc, setGrpDesc] = useState('');
  const [grpAddEmpId, setGrpAddEmpId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadAllData = async (showFullLoading = false) => {
    if (showFullLoading) setIsLoading(true);
    setError(null);
    try {
      const [empData, prjData, siteData, schData, assignData, posData, reqData, regReqData, grpData] = await Promise.all([
        adminApi.listEmployees(),
        adminApi.listProjects(),
        adminApi.listSites(),
        adminApi.listSchedules(),
        adminApi.listAssignments(),
        adminApi.listPositions(),
        adminApi.listPositionRequests(),
        adminApi.listRegistrationRequests(),
        adminApi.listWorkerGroups(),
      ]);
      setEmployees(empData || []);
      setProjects(prjData || []);
      setSites(siteData || []);
      setSchedules(schData || []);
      setAssignments(assignData || []);
      setPositions(posData || []);
      setPositionRequests(reqData || []);
      setRegistrationRequests(regReqData || []);
      setWorkerGroups(grpData || []);

      if (prjData?.length) {
        setSelectedProjectId((prev) => prev || prjData[0].id);
        if (!siteProjectId) setSiteProjectId(prjData[0].id);
      }
      if (empData?.length && !assignEmpId) setAssignEmpId(empData[0].id);
      if (siteData?.length && !assignSiteId) {
        setAssignSiteId(siteData[0].id);
      }
      if (schData?.length && !assignSchId) {
        setAssignSchId(schData[0].id);
      }
      if (posData?.length && !assignPosId) setAssignPosId(posData[0].id);
    } catch (err: any) {
      setError(err.message || 'Failed to load workforce records');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const projectSites = selectedProject
    ? sites.filter((s) => s.projectId === selectedProject.id)
    : [];

  useEffect(() => {
    loadAllData(true);
  }, []);

  const pendingRequestsCount =
    positionRequests.filter((r) => r.status === 'PENDING').length +
    registrationRequests.filter((r) => r.status === 'PENDING').length;

  // Filtered Employees
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (emp.jobTitle && emp.jobTitle.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesPosition =
      positionFilter === 'ALL' ||
      (positionFilter === 'UNASSIGNED' && !emp.currentPosition) ||
      emp.currentPosition?.id === positionFilter;

    return matchesSearch && matchesPosition;
  });

  const assignmentGroups = assignments.reduce<Record<string, AssignmentListItem[]>>((groups, assignment) => {
    (groups[assignment.employeeId] ||= []).push(assignment);
    return groups;
  }, {});

  function parseMapsLocation(input: string): { lat?: number; lng?: number } | null {
    if (!input) return null;
    const cleaned = input.replace(/[\u2010-\u2015\u2212]/g, '-').trim();

    const atMatch = cleaned.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    }

    const queryMatch = cleaned.match(/[?&](?:q|ll|place|dir\/|loc:)=(-?\d+\.\d+)(?:,|\+|\s+)(-?\d+\.\d+)/);
    if (queryMatch) {
      return { lat: parseFloat(queryMatch[1]), lng: parseFloat(queryMatch[2]) };
    }

    const placeMatch = cleaned.match(/place\/(-?\d+\.\d+)(?:,|\+|\s+)(-?\d+\.\d+)/);
    if (placeMatch) {
      return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) };
    }

    const rawPairMatch = cleaned.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
    if (rawPairMatch) {
      const lat = parseFloat(rawPairMatch[1]);
      const lng = parseFloat(rawPairMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  const applyCoordinates = (lat: number, lng: number, source: string) => {
    setSiteLat(lat.toFixed(6));
    setSiteLng(lng.toFixed(6));
    setParseSuccessMsg(`✓ ${source}: Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)}`);
    setMapResolveError(null);
  };

  const handleMapPointChange = ({ latitude, longitude }: { latitude: number; longitude: number }) => {
    applyCoordinates(latitude, longitude, 'Pin adjusted');
  };

  const resolveMapUrl = async (url: string) => {
    setMapResolving(true);
    setMapResolveError(null);
    try {
      const location = await adminApi.resolveMapLink(url);
      applyCoordinates(location.latitude, location.longitude, 'Google Maps pin resolved');
    } catch (err: any) {
      setMapResolveError(err.message || 'Could not resolve coordinates from that Google Maps link.');
    } finally {
      setMapResolving(false);
    }
  };

  const handleMapUrlChange = (val: string) => {
    setPastedMapUrl(val);
    setParseSuccessMsg(null);
    setMapResolveError(null);
    if (mapResolveTimer.current) clearTimeout(mapResolveTimer.current);
    const parsed = parseMapsLocation(val);
    if (parsed && parsed.lat !== undefined && parsed.lng !== undefined) {
      applyCoordinates(parsed.lat, parsed.lng, 'Coordinates extracted');
    } else if (/^https:\/\//i.test(val.trim())) {
      mapResolveTimer.current = setTimeout(() => void resolveMapUrl(val), 450);
    }
  };

  const handleUseCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setFormError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setFormError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000000) / 1000000;
        const lng = Math.round(pos.coords.longitude * 1000000) / 1000000;
        applyCoordinates(lat, lng, 'Current device location detected');
        setGeoLoading(false);
      },
      (err) => {
        setGeoLoading(false);
        setFormError(`Location access error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Handlers
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createEmployee({
        employeeCode: empCode.trim(),
        fullName: empName.trim(),
        phone: empPhone.trim() || undefined,
        jobTitle: empTitle.trim() || undefined,
      });
      setModalType(null);
      setEmpCode('');
      setEmpName('');
      setEmpPhone('');
      setEmpTitle('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create employee');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.linkTelegram({
        employeeId: selectedEmployee.id,
        telegramUserId: tgUserId.trim(),
        username: tgUsername.trim() || undefined,
      });
      setModalType(null);
      setSelectedEmployee(null);
      setTgUserId('');
      setTgUsername('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to link Telegram account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createPosition({
        code: posCode.trim().toUpperCase(),
        name: posName.trim(),
        description: posDesc.trim() || undefined,
      });
      setModalType(null);
      setPosCode('');
      setPosName('');
      setPosDesc('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPosition) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.updatePosition(editingPosition.id, {
        code: posCode.trim().toUpperCase(),
        name: posName.trim(),
        description: posDesc.trim() || undefined,
      });
      setModalType(null);
      setEditingPosition(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.assignEmployeePosition(selectedEmployee.id, {
        positionId: assignPosId,
        effectiveFrom: new Date(assignEffectiveFrom).toISOString(),
      });
      setModalType(null);
      setSelectedEmployee(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to assign position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPositionHistory = async (emp: EmployeeListItem) => {
    setSelectedEmployee(emp);
    setFormError(null);
    try {
      const history = await adminApi.getEmployeePositionHistory(emp.id, true);
      setPositionHistory(history || []);
      setModalType('position-history');
    } catch (err: any) {
      alert(err.message || 'Failed to load position history');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createWorkerGroup({
        code: grpCode.trim().toUpperCase(),
        name: grpName.trim(),
        description: grpDesc.trim() || undefined,
      });
      setModalType(null);
      setGrpCode('');
      setGrpName('');
      setGrpDesc('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create worker group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.updateWorkerGroup(editingGroup.id, {
        code: grpCode.trim().toUpperCase(),
        name: grpName.trim(),
        description: grpDesc.trim() || undefined,
      });
      setModalType(null);
      setEditingGroup(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update worker group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenGroupMembers = async (group: WorkerGroupListItem) => {
    setSelectedGroup(group);
    setFormError(null);
    try {
      const members = await adminApi.getWorkerGroupMembers(group.id, true);
      setGroupMembers(members || []);
      setModalType('group-members');
    } catch (err: any) {
      alert(err.message || 'Failed to load group members');
    }
  };

  const handleAddGroupMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !grpAddEmpId) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.addWorkerGroupMembers(selectedGroup.id, [grpAddEmpId]);
      const members = await adminApi.getWorkerGroupMembers(selectedGroup.id, true);
      setGroupMembers(members || []);
      setGrpAddEmpId('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to add worker to group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveGroupMember = async (employeeId: string) => {
    if (!selectedGroup || !confirm('Remove worker from this active group?')) return;
    try {
      await adminApi.removeWorkerGroupMembers(selectedGroup.id, [employeeId]);
      const members = await adminApi.getWorkerGroupMembers(selectedGroup.id, true);
      setGroupMembers(members || []);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const handleResolvePositionRequest = async (approved: boolean) => {
    if (!selectedRequest) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.resolvePositionRequest(selectedRequest.id, {
        approved,
        reviewNote: reviewNote.trim() || undefined,
      });
      setModalType(null);
      setSelectedRequest(null);
      setReviewNote('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to resolve request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolveRegistrationRequest = async (approved: boolean) => {
    if (!selectedRegRequest) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.resolveRegistrationRequest(selectedRegRequest.id, {
        approved,
        employeeCode: approved ? regEmpCode.trim() : undefined,
        fullName: approved ? regFullName.trim() : undefined,
        positionId: approved && regPositionId ? regPositionId : undefined,
        reviewNote: reviewNote.trim() || undefined,
      });

      const [updatedRegs, updatedEmps] = await Promise.all([
        adminApi.listRegistrationRequests(undefined, true),
        adminApi.listEmployees(true),
      ]);
      setRegistrationRequests(updatedRegs || []);
      setEmployees(updatedEmps || []);
      setSelectedRegRequest(null);
      setModalType(null);
      setReviewNote('');
    } catch (err: any) {
      setFormError(err.message || 'Failed to resolve registration request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createProject({
        code: prjCode.trim().toUpperCase(),
        name: prjName.trim(),
      });
      setModalType(null);
      setPrjCode('');
      setPrjName('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.updateProject(editingProject.id, {
        code: prjCode.trim().toUpperCase(),
        name: prjName.trim(),
      });
      setModalType(null);
      setEditingProject(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await adminApi.deleteProject(projectId);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete project');
    }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      const lat = parseFloat(siteLat);
      const lng = parseFloat(siteLng);
      await adminApi.createSite({
        projectId: siteProjectId,
        name: siteName.trim(),
        latitude: lat,
        longitude: lng,
        allowedRadiusMeters: parseInt(siteRadius, 10),
        timezone: siteTimezone,
      });
      setModalType(null);
      setSiteName('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create site');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      const lat = parseFloat(siteLat);
      const lng = parseFloat(siteLng);
      await adminApi.updateSite(editingSite.id, {
        name: siteName.trim(),
        latitude: lat,
        longitude: lng,
        allowedRadiusMeters: parseInt(siteRadius, 10),
        timezone: siteTimezone,
      });
      setModalType(null);
      setEditingSite(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update site');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!confirm('Are you sure you want to delete this physical site?')) return;
    try {
      await adminApi.deleteSite(siteId);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete site');
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createSchedule({
        name: schName.trim(),
        startTime: schStart,
        endTime: schEnd,
        graceMinutes: parseInt(schGrace, 10) || 0,
        timezone: schTimezone,
      });
      setModalType(null);
      setSchName('');
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.updateSchedule(editingSchedule.id, {
        name: schName.trim(),
        startTime: schStart,
        endTime: schEnd,
        graceMinutes: parseInt(schGrace, 10) || 0,
        timezone: schTimezone,
      });
      setModalType(null);
      setEditingSchedule(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to delete this work schedule?')) return;
    try {
      await adminApi.deleteSchedule(scheduleId);
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete schedule');
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      await adminApi.createAssignment({
        employeeId: assignEmpId,
        siteId: assignSiteId,
        scheduleId: assignSchId,
        startsOn: assignStartsOn,
        endsOn: assignEndsOn || undefined,
      });
      setModalType(null);
      loadAllData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeFeatureTitle =
    activeTab === 'employees'
      ? 'Employee Directory'
      : activeTab === 'positions'
      ? 'Positions Governance'
      : activeTab === 'worker-groups'
      ? 'Worker Groups'
      : activeTab === 'position-requests'
      ? 'Worker Requests & Registration'
      : activeTab === 'projects-sites'
      ? 'Projects, Sites & Schedules'
      : 'Shift Assignments';

  return (
    <div className="space-y-6">
      {/* Page Header (No duplicate tabs - feature selected via sidebar) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-5 h-5 text-[#023F26]" />
            <span>{activeFeatureTitle}</span>
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Manage workers, work sites, schedules, and their current assignments.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => loadAllData(true)}
            disabled={isLoading}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border-2 border-white bg-[#023F26] text-white text-xs font-bold shadow-xs hover:bg-[#012919] transition-all cursor-pointer"
          >
            <Clock className={`w-3.5 h-3.5 text-[#c4d701] ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh View</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. EMPLOYEES DIRECTORY TAB */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          {/* Controls & Filter Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                placeholder="Search workers by name, code, title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-sky-500 w-full sm:w-64"
              />

              <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>Position:</span>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="ALL">All Positions</option>
                  <option value="UNASSIGNED">Unassigned Only</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => {
                  setFormError(null);
                  setModalType('employee');
                }}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#023F26] hover:bg-[#012919] text-white text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#c4d701]" />
                <span>Add Employee</span>
              </button>
            </div>
          </div>

          {/* One worker card, with assignment details revealed on demand. */}
          {Object.keys(assignmentGroups).length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200/80 text-slate-400 text-xs">
              No shift assignments found.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(assignmentGroups).map(([employeeId, workerAssignments]) => {
                const worker = workerAssignments[0];
                const employee = employees.find((item) => item.id === employeeId);
                const isExpanded = expandedAssignmentEmployeeId === employeeId;
                const activeCount = workerAssignments.filter((item) => item.status === 'ACTIVE').length;

                return (
                  <article
                    key={employeeId}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedAssignmentEmployeeId(isExpanded ? null : employeeId)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50 sm:gap-4 sm:p-5"
                    >
                      <div className="size-12 shrink-0 overflow-hidden rounded-full border-2 border-white bg-amber-300 shadow-sm sm:size-14">
                        {employee?.avatarUrl ? (
                          <img src={employee.avatarUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="flex size-full items-center justify-center text-lg font-extrabold text-white">
                            {worker.employeeName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="text-base font-extrabold text-slate-900">{worker.employeeName}</h3>
                          <span className="font-mono text-xs font-bold text-slate-400">{worker.employeeCode}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {workerAssignments.length} project{workerAssignments.length === 1 ? '' : 's'} assigned
                          {activeCount > 0 ? ' · ' + activeCount + ' active' : ''}
                        </p>
                      </div>
                      <span className="hidden rounded-full bg-[#023F26]/10 px-2.5 py-1 text-[10px] font-bold text-[#023F26] sm:inline">
                        View details
                      </span>
                      <ChevronDown
                        className={[
                          'size-5 shrink-0 text-slate-400 transition-transform',
                          isExpanded ? 'rotate-180' : '',
                        ].join(' ')}
                      />
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4">
                        <p className="mb-2 px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                          Project assignments
                        </p>
                        <div className="space-y-2">
                          {workerAssignments.map((assignment) => (
                            <div
                              key={assignment.id}
                              className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                            >
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900">{assignment.projectName}</p>
                                <p className="mt-0.5 truncate text-slate-500">{assignment.siteName} · {assignment.scheduleName}</p>
                              </div>
                              <span className="font-mono text-[11px] text-slate-500">
                                {assignment.startsOn.slice(0, 10)} — {assignment.endsOn ? assignment.endsOn.slice(0, 10) : 'Ongoing'}
                              </span>
                              <span
                                className={
                                  assignment.status === 'ACTIVE'
                                    ? 'w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200'
                                    : 'w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600'
                                }
                              >
                                {assignment.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALS - All rendered via document.body portal */}
      {/* 1. Add Employee Modal */}
      <Modal
        isOpen={modalType === 'employee'}
        onClose={() => setModalType(null)}
        title="Add New Worker"
        subtitle="Register an employee record in the organization directory."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateEmployee} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Employee Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. EMP-101"
              value={empCode}
              onChange={(e) => setEmpCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. John Doe"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Phone Number (Optional)</label>
            <input
              type="text"
              placeholder="e.g. +855977429389"
              value={empPhone}
              onChange={(e) => setEmpPhone(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Job Title (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Senior Electrician"
              value={empTitle}
              onChange={(e) => setEmpTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Saving...' : 'Save Employee'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 2. Create Project Modal */}
      <Modal
        isOpen={modalType === 'project'}
        onClose={() => setModalType(null)}
        title="Create New Project"
        subtitle="Register a major construction venture or facility development."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateProject} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Project Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. PRJ-001"
              value={prjCode}
              onChange={(e) => setPrjCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl uppercase font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Project Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Tower A Construction"
              value={prjName}
              onChange={(e) => setPrjName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 3. Create Physical Site Modal */}
      <Modal
        isOpen={modalType === 'site'}
        onClose={() => setModalType(null)}
        title="Add Physical Geofenced Site"
        subtitle="Establish official GPS geofence radius and site timezone."
        maxWidth="2xl"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateSite} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Target Project *</label>
              <select
                value={siteProjectId}
                onChange={(e) => setSiteProjectId(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-semibold"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Site Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Main Gate Entrance - Tower A"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl"
              />
            </div>
          </div>

          {/* Paste Google Maps Link Resolver */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Paste Google Maps Link / Share URL (Optional)
            </label>
            <input
              type="text"
              placeholder="https://maps.google.com/?q=11.5564,104.9282"
              value={pastedMapUrl}
              onChange={(e) => handleMapUrlChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono text-[11px]"
            />
            {mapResolving && (
              <p className="text-[10px] text-[#023F26] mt-1 font-medium animate-pulse">
                Resolving Google Maps coordinates...
              </p>
            )}
            {parseSuccessMsg && (
              <p className="text-[10px] text-emerald-600 mt-1 font-semibold">{parseSuccessMsg}</p>
            )}
            {mapResolveError && (
              <p className="text-[10px] text-rose-600 mt-1 font-semibold">{mapResolveError}</p>
            )}
          </div>

          {/* Device GPS Button */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={geoLoading}
            className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl border border-slate-300 text-xs flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 text-[#023F26]" />
            <span>{geoLoading ? 'Detecting device location...' : 'Use Current Device GPS Location'}</span>
          </button>

          {/* Real-time Leaflet Map Component */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">Real-Time Interactive Geofence Map Pin</label>
            <SiteLocationPicker
              latitude={parseFloat(siteLat) || 11.5564}
              longitude={parseFloat(siteLng) || 104.9282}
              radiusMeters={parseInt(siteRadius, 10) || 100}
              onChange={({ latitude, longitude }) => handleMapPointChange({ latitude, longitude })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Latitude</label>
              <input
                type="text"
                required
                value={siteLat}
                onChange={(e) => setSiteLat(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Longitude</label>
              <input
                type="text"
                required
                value={siteLng}
                onChange={(e) => setSiteLng(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Geofence Radius (Meters) *</label>
              <input
                type="number"
                required
                min="10"
                max="5000"
                value={siteRadius}
                onChange={(e) => setSiteRadius(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">IANA Timezone *</label>
              <select
                value={siteTimezone}
                onChange={(e) => setSiteTimezone(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-mono text-[11px]"
              >
                <option value="Asia/Phnom_Penh">Asia/Phnom_Penh (UTC+7)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Saving...' : 'Save Physical Site'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 4. Edit Site Modal */}
      <Modal
        isOpen={modalType === 'edit-site' && !!editingSite}
        onClose={() => setModalType(null)}
        title={`Edit Site: ${editingSite?.name || ''}`}
        subtitle="Update site coordinates, geofence radius, or official timezone."
        maxWidth="2xl"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleUpdateSite} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Site Name *</label>
            <input
              type="text"
              required
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Interactive Geofence Map Pin</label>
            <SiteLocationPicker
              latitude={parseFloat(siteLat) || 11.5564}
              longitude={parseFloat(siteLng) || 104.9282}
              radiusMeters={parseInt(siteRadius, 10) || 100}
              onChange={({ latitude, longitude }) => handleMapPointChange({ latitude, longitude })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Latitude</label>
              <input
                type="text"
                required
                value={siteLat}
                onChange={(e) => setSiteLat(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Longitude</label>
              <input
                type="text"
                required
                value={siteLng}
                onChange={(e) => setSiteLng(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Geofence Radius (Meters)</label>
              <input
                type="number"
                required
                min="10"
                max="5000"
                value={siteRadius}
                onChange={(e) => setSiteRadius(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">IANA Timezone</label>
              <select
                value={siteTimezone}
                onChange={(e) => setSiteTimezone(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-mono text-[11px]"
              >
                <option value="Asia/Phnom_Penh">Asia/Phnom_Penh (UTC+7)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Updating...' : 'Update Site'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 5. Create Schedule Modal */}
      <Modal
        isOpen={modalType === 'schedule'}
        onClose={() => setModalType(null)}
        title="Create Work Schedule"
        subtitle="Define official shift start, end, and grace minutes."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateSchedule} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Schedule Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Standard Day Shift"
              value={schName}
              onChange={(e) => setSchName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Start Time (HH:mm) *</label>
              <input
                type="time"
                required
                value={schStart}
                onChange={(e) => setSchStart(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">End Time (HH:mm) *</label>
              <input
                type="time"
                required
                value={schEnd}
                onChange={(e) => setSchEnd(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Grace Period (Minutes)</label>
              <input
                type="number"
                required
                min="0"
                max="120"
                value={schGrace}
                onChange={(e) => setSchGrace(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Timezone *</label>
              <select
                value={schTimezone}
                onChange={(e) => setSchTimezone(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-mono text-[11px]"
              >
                <option value="Asia/Phnom_Penh">Asia/Phnom_Penh (UTC+7)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Work Schedule Modal */}
      <Modal
        isOpen={modalType === 'edit-schedule' && !!editingSchedule}
        onClose={() => {
          setModalType(null);
          setEditingSchedule(null);
        }}
        title={`កែប្រែវេនការ៖ ${editingSchedule?.name || ''}`}
        subtitle="កែប្រែម៉ោងចូល ម៉ោងចេញ រយៈពេលអនុគ្រោះ និងតំបន់ពេលវេលា។"
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleUpdateSchedule} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">ឈ្មោះវេនការ *</label>
            <input
              type="text"
              required
              value={schName}
              onChange={(e) => setSchName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">ម៉ោងចូល *</label>
              <input
                type="time"
                required
                value={schStart}
                onChange={(e) => setSchStart(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">ម៉ោងចេញ *</label>
              <input
                type="time"
                required
                value={schEnd}
                onChange={(e) => setSchEnd(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">រយៈពេលអនុគ្រោះ (នាទី)</label>
              <input
                type="number"
                required
                min="0"
                max="120"
                value={schGrace}
                onChange={(e) => setSchGrace(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">តំបន់ពេលវេលា *</label>
              <select
                value={schTimezone}
                onChange={(e) => setSchTimezone(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-mono text-[11px]"
              >
                <option value="Asia/Phnom_Penh">Asia/Phnom_Penh (UTC+7)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => {
                setModalType(null);
                setEditingSchedule(null);
              }}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              បោះបង់
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'កំពុងរក្សាទុក…' : 'រក្សាទុកការកែប្រែ'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 6. Create Position Modal */}
      <Modal
        isOpen={modalType === 'position'}
        onClose={() => setModalType(null)}
        title="Create Job Position"
        subtitle="Define trade crafts (e.g. Electrician, Carpenter, Mason)."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreatePosition} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Position Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. ELEC"
              value={posCode}
              onChange={(e) => setPosCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono uppercase"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Position Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Journeyman Electrician"
              value={posName}
              onChange={(e) => setPosName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Description (Optional)</label>
            <textarea
              rows={3}
              placeholder="Responsibilities, trade certification requirements..."
              value={posDesc}
              onChange={(e) => setPosDesc(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create Position'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 7. Assign Official Position Modal */}
      <Modal
        isOpen={modalType === 'assign-position' && !!selectedEmployee}
        onClose={() => setModalType(null)}
        title={`Assign Position: ${selectedEmployee?.fullName || ''}`}
        subtitle="Officially assign or update this worker's craft/role."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleAssignPosition} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Target Official Position *</label>
            <select
              value={assignPosId}
              onChange={(e) => setAssignPosId(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl bg-white"
            >
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Effective From Date/Time *</label>
            <input
              type="datetime-local"
              required
              value={assignEffectiveFrom}
              onChange={(e) => setAssignEffectiveFrom(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Note: Transactionally closes previous active position interval and appends append-only history.
            </p>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Assigning...' : 'Confirm Assignment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 8. Position History Modal */}
      <Modal
        isOpen={modalType === 'position-history' && !!selectedEmployee}
        onClose={() => setModalType(null)}
        title="Position Audit History"
        subtitle={`${selectedEmployee?.fullName || ''} (${selectedEmployee?.employeeCode || ''})`}
        maxWidth="lg"
      >
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 text-xs">
          {positionHistory.length === 0 ? (
            <p className="text-slate-400 italic text-center py-4">No position history recorded yet.</p>
          ) : (
            positionHistory.map((h) => (
              <div key={h.id} className="p-3 border rounded-2xl bg-slate-50 space-y-1">
                <div className="flex items-center justify-between font-semibold text-slate-800">
                  <span>{h.positionName} ({h.positionCode})</span>
                  <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-700 rounded-full font-bold">
                    {h.source}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  <span>From: {new Date(h.effectiveFrom).toLocaleString()}</span>
                  <span className="ml-2">To: {h.effectiveTo ? new Date(h.effectiveTo).toLocaleString() : 'Present'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setModalType(null)}
            className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </Modal>

      {/* 9. Create Worker Group Modal */}
      <Modal
        isOpen={modalType === 'group'}
        onClose={() => setModalType(null)}
        title="Create Worker Group"
        subtitle="Group workers for batch site assignments and crew management."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateGroup} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Group Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. CREW-A"
              value={grpCode}
              onChange={(e) => setGrpCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono uppercase"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Group Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Concrete Framing Crew A"
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Description (Optional)</label>
            <textarea
              rows={2}
              placeholder="Crew specialty, shift details..."
              value={grpDesc}
              onChange={(e) => setGrpDesc(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 10. Manage Group Members Modal */}
      <Modal
        isOpen={modalType === 'group-members' && !!selectedGroup}
        onClose={() => setModalType(null)}
        title={`Group Members: ${selectedGroup?.name || ''}`}
        subtitle="Add or remove workers from this active crew."
        maxWidth="lg"
      >
        <form onSubmit={handleAddGroupMember} className="flex gap-2 mb-4 text-xs">
          <select
            value={grpAddEmpId}
            onChange={(e) => setGrpAddEmpId(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-xl bg-white"
          >
            <option value="">-- Select Worker to Add --</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.employeeCode})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!grpAddEmpId || isSubmitting}
            className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            Add Worker
          </button>
        </form>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
          {groupMembers.length === 0 ? (
            <p className="text-slate-400 italic text-center py-4">No active members in this group.</p>
          ) : (
            groupMembers.map((m) => (
              <div key={m.id} className="p-3 border rounded-2xl bg-white flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-900">{m.employeeName}</span>
                  <span className="text-slate-500 ml-1 font-mono">({m.employeeCode})</span>
                  <span className="text-[10px] text-slate-400 block">Joined: {new Date(m.joinedAt).toLocaleDateString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveGroupMember(m.employeeId)}
                  className="text-rose-600 hover:text-rose-800 text-[11px] font-semibold cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* 11. Resolve Request Modal */}
      <Modal
        isOpen={modalType === 'resolve-request' && !!selectedRequest}
        onClose={() => setModalType(null)}
        title="Review Position Request"
        subtitle="Approve or decline a worker's craft/role change request."
        maxWidth="md"
      >
        <div className="text-xs space-y-2 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 mb-3">
          <div><span className="text-slate-500">Worker:</span> <span className="font-semibold">{selectedRequest?.employeeName}</span></div>
          <div><span className="text-slate-500">Requested Position:</span> <span className="font-bold text-[#023F26]">{selectedRequest?.requestedPositionName}</span></div>
        </div>

        <div>
          <label className="block font-medium text-slate-700 text-xs mb-1">Review Note (Optional)</label>
          <textarea
            rows={2}
            placeholder="Manager note or decision rationale..."
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl text-xs"
          />
        </div>

        <div className="pt-3 flex justify-end space-x-2 text-xs">
          <button
            type="button"
            onClick={() => handleResolvePositionRequest(false)}
            disabled={isSubmitting}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold cursor-pointer"
          >
            Reject Request
          </button>
          <button
            type="button"
            onClick={() => handleResolvePositionRequest(true)}
            disabled={isSubmitting}
            className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl font-bold cursor-pointer"
          >
            Approve & Assign Position
          </button>
        </div>
      </Modal>

      {/* 12. Resolve Worker Registration Request Modal */}
      <Modal
        isOpen={modalType === 'resolve-registration' && !!selectedRegRequest}
        onClose={() => setModalType(null)}
        title="Review Worker Registration Request"
        subtitle="Provision an employee code and craft for a verified Telegram user."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="text-xs space-y-1.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200 mb-3">
          <div>
            <span className="text-slate-500">Phone Contact:</span>{' '}
            <span className="font-mono font-bold text-slate-900">{selectedRegRequest?.phone}</span>
          </div>
          <div>
            <span className="text-slate-500">Telegram Name:</span>{' '}
            <span className="font-semibold text-slate-900">
              {[selectedRegRequest?.telegramFirstName, selectedRegRequest?.telegramLastName].filter(Boolean).join(' ') || '—'}
            </span>
            {selectedRegRequest?.telegramUsername && (
              <span className="text-slate-500 ml-1">(@{selectedRegRequest.telegramUsername})</span>
            )}
          </div>
          <div>
            <span className="text-slate-500">Telegram ID:</span>{' '}
            <span className="font-mono text-slate-700">{selectedRegRequest?.telegramUserId}</span>
          </div>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Assign Employee Code *</label>
            <input
              type="text"
              required
              placeholder="e.g. EMP-101"
              value={regEmpCode}
              onChange={(e) => setRegEmpCode(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              required
              placeholder="Official Worker Full Name"
              value={regFullName}
              onChange={(e) => setRegFullName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Assign Craft / Job Position (Optional)</label>
            <select
              value={regPositionId}
              onChange={(e) => setRegPositionId(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl bg-white"
            >
              <option value="">— Unassigned Craft —</option>
              {positions.map((pos) => (
                <option key={pos.id} value={pos.id}>
                  {pos.name} ({pos.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Review / Approval Note (Optional)</label>
            <textarea
              rows={2}
              placeholder="Approval note or rejection reason..."
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>
        </div>

        <div className="pt-3 flex justify-end space-x-2 text-xs">
          <button
            type="button"
            onClick={() => handleResolveRegistrationRequest(false)}
            disabled={isSubmitting}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold cursor-pointer"
          >
            Reject Request
          </button>
          <button
            type="button"
            onClick={() => handleResolveRegistrationRequest(true)}
            disabled={isSubmitting || !regEmpCode || !regFullName}
            className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
          >
            Approve & Provision Employee
          </button>
        </div>
      </Modal>

      {/* 14. Single Assignment Modal */}
      <Modal
        isOpen={modalType === 'assignment'}
        onClose={() => setModalType(null)}
        title="Single Shift Assignment"
        subtitle="Assign an individual worker to a specific project site and schedule."
        maxWidth="lg"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateAssignment} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Target Worker *</label>
            <select
              required
              value={assignEmpId}
              onChange={(e) => setAssignEmpId(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl bg-white font-medium"
            >
              <option value="">Select a worker...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Target Site *</label>
              <select
                required
                value={assignSiteId}
                onChange={(e) => setAssignSiteId(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-medium"
              >
                <option value="">Select a site...</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.timezone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Work Schedule *</label>
              <select
                required
                value={assignSchId}
                onChange={(e) => setAssignSchId(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-medium"
              >
                <option value="">Select a schedule...</option>
                {schedules.map((sch) => (
                  <option key={sch.id} value={sch.id}>
                    {sch.name} ({sch.startTime} - {sch.endTime})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Starts On (YYYY-MM-DD) *</label>
              <input
                type="date"
                required
                value={assignStartsOn}
                onChange={(e) => setAssignStartsOn(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Ends On (Optional)</label>
              <input
                type="date"
                value={assignEndsOn}
                onChange={(e) => setAssignEndsOn(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !assignEmpId || !assignSiteId || !assignSchId || !assignStartsOn}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Assigning...' : 'Assign Worker'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 15. Link Telegram Modal */}
      <Modal
        isOpen={modalType === 'telegram' && !!selectedEmployee}
        onClose={() => setModalType(null)}
        title={`Link Telegram: ${selectedEmployee?.fullName || ''}`}
        subtitle="Associate an official Telegram User ID with this employee record."
        maxWidth="md"
      >
        {formError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs mb-3 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleLinkTelegram} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Telegram User ID (Numeric) *</label>
            <input
              type="text"
              required
              placeholder="e.g. 123456789"
              value={tgUserId}
              onChange={(e) => setTgUserId(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Telegram Username (Optional)</label>
            <input
              type="text"
              placeholder="e.g. john_doe"
              value={tgUsername}
              onChange={(e) => setTgUsername(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !tgUserId}
              className="px-4 py-2 bg-[#023F26] hover:bg-[#012919] text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Linking...' : 'Link Telegram'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function WorkforcePage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-6 text-slate-500 text-xs font-bold animate-pulse">
          Loading workforce view...
        </div>
      }
    >
      <WorkforcePageContent />
    </React.Suspense>
  );
}
