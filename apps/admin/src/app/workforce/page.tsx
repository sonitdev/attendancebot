'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { adminApi } from '@/lib/api';
import { km } from '@workforce/contracts';
import { useLocale } from '@/lib/locale-context';
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
} from 'lucide-react';

import { useSearchParams } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { ActionStatus, ConfirmActionDialog, type ActionFeedback } from '@/components/ui/action-state';
import { useWorkforceData } from './use-workforce-data';
import { WorkforcePageHeader } from './workforce-page-header';
import { EmployeeDirectoryControls } from './employee-directory-controls';
import { AssignmentWorkerList } from './assignment-worker-list';
import { ProjectSiteControls } from './project-site-controls';
import { WorkforceSectionHeading } from './workforce-section-heading';
import { AssignmentTable } from './assignment-table';
import { CreateEmployeeModal } from './create-employee-modal';

const SiteLocationPicker = dynamic(() => import('@/components/sites/site-location-picker'), { ssr: false });

type Tab = 'employees' | 'positions' | 'worker-groups' | 'position-requests' | 'projects-sites' | 'assignments';

function WorkforcePageContent() {
  const { locale, t, isKm } = useLocale();
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
  const {
    employees, setEmployees, projects, setProjects, sites, setSites, schedules, setSchedules,
    assignments, setAssignments, positions, setPositions, positionRequests, setPositionRequests,
    registrationRequests, setRegistrationRequests, workerGroups, setWorkerGroups,
    isLoading, error, setError, loadAllData, lastSuccessMessage,
  } = useWorkforceData(activeTab);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ run: () => Promise<void> } | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const projectSites = selectedProject
    ? sites.filter((s) => s.projectId === selectedProject.id)
    : [];

  useEffect(() => {
    if (lastSuccessMessage) setActionFeedback({ type: 'success', message: lastSuccessMessage });
  }, [lastSuccessMessage]);

  useEffect(() => {
    if (projects.length) {
      setSelectedProjectId((prev) => prev || projects[0].id);
      if (!siteProjectId) setSiteProjectId(projects[0].id);
    }
    if (employees.length && !assignEmpId) setAssignEmpId(employees[0].id);
    if (sites.length && !assignSiteId) setAssignSiteId(sites[0].id);
    if (schedules.length && !assignSchId) setAssignSchId(schedules[0].id);
    if (positions.length && !assignPosId) setAssignPosId(positions[0].id);
  }, [projects, employees, sites, schedules, positions, siteProjectId, assignEmpId, assignSiteId, assignSchId, assignPosId]);

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
    let decoded = input.trim();
    try {
      decoded = decodeURIComponent(input).replace(/[\u2010-\u2015\u2212]/g, '-').trim();
    } catch {
      decoded = input.replace(/[\u2010-\u2015\u2212]/g, '-').trim();
    }

    // 1. Google Maps data parameters: !3d11.5564!4d104.9282
    const data3dMatch = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (data3dMatch) {
      return { lat: parseFloat(data3dMatch[1]), lng: parseFloat(data3dMatch[2]) };
    }

    // 2. Center coordinates: @11.5564,104.9282
    const atMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) {
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    }

    // 3. Query string coordinates: ?q=11.5564,104.9282, ll=..., loc:..., query=...
    const queryMatch = decoded.match(/[?&](?:q|ll|place|dir\/|loc:|query)=(-?\d+\.\d+)(?:,|\+|%2C|\s+)(-?\d+\.\d+)/i);
    if (queryMatch) {
      return { lat: parseFloat(queryMatch[1]), lng: parseFloat(queryMatch[2]) };
    }

    // 4. Place URL path: /place/11.5564,104.9282
    const placeMatch = decoded.match(/(?:\/place\/|place\/)(-?\d+\.\d+)(?:,|\+|%2C|\s+)(-?\d+\.\d+)/i);
    if (placeMatch) {
      return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) };
    }

    // 5. Raw coordinate pair: 11.5564, 104.9282 or 11.5564 104.9282
    const rawPairMatch = decoded.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
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
    setPastedMapUrl(`https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`);
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
    } else {
      const trimmed = val.trim();
      const isHttp = /^https?:\/\//i.test(trimmed);
      const isGoogleShort = /^(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.com)/i.test(trimmed);
      if (isHttp || isGoogleShort) {
        const fullUrl = isHttp ? trimmed : `https://${trimmed}`;
        mapResolveTimer.current = setTimeout(() => void resolveMapUrl(fullUrl), 450);
      }
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
        setPastedMapUrl(`https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`);
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
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
      setActionFeedback({ type: 'error', message: err.message || 'Failed to load position history' });
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
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
      setActionFeedback({ type: 'error', message: err.message || 'Failed to load group members' });
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
      await loadAllData(false, km.actions.saved);
    } catch (err: any) {
      setFormError(err.message || 'Failed to add worker to group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveGroupMember = async (employeeId: string) => {
    if (!selectedGroup) return;
    setPendingRemoval({ run: async () => {
      await adminApi.removeWorkerGroupMembers(selectedGroup.id, [employeeId]);
      const members = await adminApi.getWorkerGroupMembers(selectedGroup.id, true);
      setGroupMembers(members || []);
    } });
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
      await loadAllData(false, km.actions.saved);
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
        workMode: 'SITE',
      });
      setModalType(null);
      setPrjCode('');
      setPrjName('');
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setPendingRemoval({ run: () => adminApi.deleteProject(projectId).then(() => undefined) });
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update site');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    setPendingRemoval({ run: () => adminApi.deleteSite(siteId).then(() => undefined) });
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
      await loadAllData(false, km.actions.saved);
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
      await loadAllData(false, km.actions.saved);
    } catch (err: any) {
      setFormError(err.message || 'Failed to update schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    setPendingRemoval({ run: () => adminApi.deleteSchedule(scheduleId).then(() => undefined) });
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval || isSubmitting) return;
    setIsSubmitting(true);
    setActionFeedback({ type: 'info', message: km.actions.processing });
    try {
      await pendingRemoval.run();
      await loadAllData();
      setPendingRemoval(null);
      setActionFeedback({ type: 'success', message: km.actions.removed });
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || km.actions.saveFailed });
    } finally {
      setIsSubmitting(false);
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
      await loadAllData(false, km.actions.saved);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    setPendingRemoval({ run: () => adminApi.deleteAssignment(assignmentId).then(() => undefined) });
  };

  const openEditSite = (site: SiteListItem) => {
    setEditingSite(site);
    setSiteName(site.name);
    setSiteProjectId(site.projectId);
    setSiteLat(String(site.latitude));
    setSiteLng(String(site.longitude));
    setSiteRadius(String(site.allowedRadiusMeters));
    setSiteTimezone(site.timezone || 'Asia/Phnom_Penh');
    setPastedMapUrl(`https://maps.google.com/?q=${site.latitude},${site.longitude}`);
    setParseSuccessMsg(null);
    setMapResolveError(null);
    setFormError(null);
    setModalType('edit-site');
  };

  const openAddSite = (defaultProjectId?: string) => {
    setEditingSite(null);
    setSiteName('');
    setSiteProjectId(defaultProjectId || selectedProjectId || projects[0]?.id || '');
    setSiteLat('11.5564');
    setSiteLng('104.9282');
    setSiteRadius('500');
    setSiteTimezone('Asia/Phnom_Penh');
    setPastedMapUrl('');
    setParseSuccessMsg(null);
    setMapResolveError(null);
    setFormError(null);
    setModalType('site');
  };

  const openEditSchedule = (sch: WorkScheduleListItem) => {
    setEditingSchedule(sch);
    setSchName(sch.name);
    setSchStart(sch.startTime);
    setSchEnd(sch.endTime);
    setSchGrace(String(sch.graceMinutes ?? 0));
    setSchTimezone(sch.timezone || 'Asia/Phnom_Penh');
    setFormError(null);
    setModalType('edit-schedule');
  };

  const openAddSchedule = () => {
    setEditingSchedule(null);
    setSchName('');
    setSchStart('08:00');
    setSchEnd('17:00');
    setSchGrace('15');
    setSchTimezone('Asia/Phnom_Penh');
    setFormError(null);
    setModalType('schedule');
  };

  const openAddProject = () => {
    setEditingProject(null);
    setPrjCode(`PRJ-${Date.now().toString().slice(-4)}`);
    setPrjName('');
    setFormError(null);
    setModalType('project');
  };

  const openAddAssignment = () => {
    setAssignEmpId(employees[0]?.id || '');
    setAssignSiteId(sites[0]?.id || '');
    setAssignSchId(schedules[0]?.id || '');
    setAssignStartsOn(new Date().toISOString().slice(0, 10));
    setAssignEndsOn(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
    setFormError(null);
    setModalType('assignment');
  };

  const activeFeatureTitle =
    activeTab === 'employees'
      ? t.workforce.titleEmployees
      : activeTab === 'projects-sites'
      ? t.workforce.titleProjectsSites
      : t.workforce.titleAssignments;

  const activeFeatureSubtitle =
    activeTab === 'employees'
      ? t.workforce.subtitleEmployees
      : activeTab === 'projects-sites'
      ? t.workforce.subtitleProjectsSites
      : t.workforce.subtitleAssignments;

  return (
    <div className="space-y-6">
      <WorkforcePageHeader
        title={activeFeatureTitle}
        subtitle={activeFeatureSubtitle}
        refreshLabel={t.workforce.refreshView}
        isLoading={isLoading}
        onRefresh={() => loadAllData(true)}
        error={error}
      />
      <ActionStatus feedback={actionFeedback} />

      {/* 1. EMPLOYEES DIRECTORY TAB */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <EmployeeDirectoryControls
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            positionFilter={positionFilter}
            onPositionChange={setPositionFilter}
            positions={positions}
            searchLabel={t.workforce.searchEmployees}
            addLabel={t.workforce.addEmployee}
            onAdd={() => { setFormError(null); setModalType('employee'); }}
          />

          <AssignmentWorkerList assignmentGroups={assignmentGroups} employees={employees} expandedEmployeeId={expandedAssignmentEmployeeId} onToggle={(employeeId) => setExpandedAssignmentEmployeeId((current) => current === employeeId ? null : employeeId)} detailsLabel={km.admin.details} />
        </div>
      )}

      {/* 2. PROJECTS, SITES & SCHEDULES TAB */}
      {activeTab === 'projects-sites' && (
        <div className="space-y-6">
          <ProjectSiteControls
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            allProjectsLabel={t.workforce.allProjects}
            projectsLabel={t.workforce.projectsLabel}
            addSiteLabel={t.workforce.addSite}
            addScheduleLabel={t.workforce.addSchedule}
            createProjectLabel={t.workforce.createProject}
            onAddSite={openAddSite}
            onAddSchedule={openAddSchedule}
            onAddProject={openAddProject}
          />

          {/* Section A: Physical Sites & GPS Geofence Boundaries */}
          <div className="space-y-3">
            <WorkforceSectionHeading icon={<MapPin className="size-4 text-emerald-600" />} title={t.workforce.sitesSectionTitle} subtitle={t.workforce.sitesSectionSubtitle} count={`${sites.filter((s) => !selectedProjectId || s.projectId === selectedProjectId).length} Sites`} />

            {sites.filter((s) => !selectedProjectId || s.projectId === selectedProjectId).length === 0 ? (
              <div className="py-10 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                <MapPin className="size-8 text-slate-300 mx-auto mb-2" />
                {t.workforce.noSites}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sites
                  .filter((s) => !selectedProjectId || s.projectId === selectedProjectId)
                  .map((site) => {
                    const prj = projects.find((p) => p.id === site.projectId);
                    return (
                      <div
                        key={site.id}
                        className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3 flex flex-col justify-between hover:border-emerald-300 transition-colors"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                                {site.name}
                              </h3>
                              <span className="inline-block mt-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                {prj?.name || 'Project'}
                              </span>
                            </div>
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 shrink-0">
                              {isKm ? `ទីតាំងកំណត់ ${site.allowedRadiusMeters} ម៉ែត្រ` : `${site.allowedRadiusMeters}m Perimeter`}
                            </span>
                          </div>

                          {/* Coordinates & Map Link */}
                          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-slate-500 font-mono">
                                📍 {Number(site.latitude).toFixed(4)}, {Number(site.longitude).toFixed(4)}
                              </span>
                              <a
                                href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:text-sky-700 hover:underline"
                              >
                                <span>{isKm ? 'ផែនទី' : 'Map'}</span>
                                <ExternalLink size={10} />
                              </a>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1 border-t border-slate-200/50">
                              <span>{isKm ? 'ទីតាំងកំណត់:' : 'Allowed Radius:'}</span>
                              <span className="font-bold text-emerald-700">{site.allowedRadiusMeters} ម៉ែត្រ</span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => openEditSite(site)}
                            className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Pencil size={12} />
                            <span>{t.workforce.editLocation}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSite(site.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                            title="លុបការដ្ឋាន"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Section B: Work Schedules & Flexible Grace Period */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <WorkforceSectionHeading icon={<Clock className="size-4 text-amber-600" />} title={t.workforce.schedulesSectionTitle} subtitle={t.workforce.schedulesSectionSubtitle} count={`${schedules.length} Schedules`} />

            {schedules.length === 0 ? (
              <div className="py-10 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
                <Clock className="size-8 text-slate-300 mx-auto mb-2" />
                {t.workforce.noSchedules}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {schedules.map((sch) => (
                  <div
                    key={sch.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3 flex flex-col justify-between hover:border-amber-300 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-extrabold text-slate-900">{sch.name}</h3>
                          <span className="text-[10px] text-slate-400 font-mono">{sch.timezone}</span>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-900 shrink-0">
                          +{sch.graceMinutes ?? 0}mn Grace
                        </span>
                      </div>

                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 font-medium">ម៉ោងធ្វើការ:</span>
                          <span className="font-mono font-extrabold text-slate-800">
                            {sch.startTime} → {sch.endTime}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/50">
                          <span className="text-slate-500 font-medium">អនុគ្រោះយឺត:</span>
                          <span className="font-bold text-amber-700">
                            {sch.graceMinutes ? `${sch.graceMinutes} នាទី` : '0 នាទី (គ្មាន)'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight">
                          ចូលយឺតមិនលើសពី {sch.graceMinutes ?? 0} នាទី នឹងនៅតែចាត់ទុកជា ON_TIME (ទាន់ពេល)
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openEditSchedule(sch)}
                        className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Pencil size={12} />
                        <span>{t.workforce.editSchedule}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(sch.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                        title="លុបវេនការ"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section C: Projects Overview */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Building className="size-4 text-slate-700" />
                  <span>បញ្ជីគម្រោងទាំងអស់ (Projects Directory)</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  គម្រោងដែលបានភ្ជាប់ជាមួយ Telegram Group និងការគ្រប់គ្រងទីតាំងការងារ។
                </p>
              </div>
              <span className="text-xs font-bold text-slate-400">{projects.length} Projects</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((p) => {
                const projectSites = sites.filter((s) => s.projectId === p.id);
                return (
                  <div
                    key={p.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-extrabold text-slate-900">{p.name}</h3>
                          <span className="text-[10px] text-slate-400 font-mono">{p.code}</span>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                            p.telegramConnectionStatus === 'CONNECTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {p.telegramConnectionStatus === 'CONNECTED' ? 'Telegram Linked' : 'Unlinked'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-50 p-2 rounded-xl">
                          <p className="text-[10px] text-slate-400 uppercase font-semibold">Mode</p>
                          <p className="font-bold text-slate-800 mt-0.5">{p.workMode}</p>
                        </div>
                        <div className="bg-slate-50 p-2 rounded-xl">
                          <p className="text-[10px] text-slate-400 uppercase font-semibold">Sites</p>
                          <p className="font-bold text-slate-800 mt-0.5">{projectSites.length} ការដ្ឋាន</p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => openAddSite(p.id)}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer flex items-center gap-1"
                      >
                        <Plus size={12} />
                        <span>បន្ថែមការដ្ឋានថ្មី</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(p.id)}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. ASSIGNMENTS TAB */}
      {activeTab === 'assignments' && <AssignmentTable assignments={assignments} employees={employees} sites={sites} schedules={schedules} projects={projects} title={t.workforce.assignmentsSectionTitle} subtitle={t.workforce.assignmentsSectionSubtitle} addLabel={t.workforce.assignWorker} onAdd={openAddAssignment} onDelete={handleDeleteAssignment} />}
      <CreateEmployeeModal isOpen={modalType === 'employee'} formError={formError} isSubmitting={isSubmitting} empCode={empCode} empName={empName} empPhone={empPhone} empTitle={empTitle} onClose={() => setModalType(null)} onSubmit={handleCreateEmployee} onEmpCode={setEmpCode} onEmpName={setEmpName} onEmpPhone={setEmpPhone} onEmpTitle={setEmpTitle} />

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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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
        title={isKm ? 'បន្ថែមការដ្ឋានថ្មី' : 'Add Physical Site'}
        subtitle={isKm ? 'កំណត់កូអរដោនេលើផែនទី និងទីតាំងកំណត់សម្រាប់ការ Check-in' : 'Establish official GPS coordinates and allowed site radius.'}
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
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ជ្រើសរើសគម្រោង *' : 'Target Project *'}</label>
              <select
                value={siteProjectId}
                onChange={(e) => setSiteProjectId(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl bg-white font-semibold"
              >
                {projects.filter((p) => p.status === 'ACTIVE').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ឈ្មោះការដ្ឋាន *' : 'Site Name *'}</label>
              <input
                type="text"
                required
                placeholder={isKm ? 'ឧ. ច្រកចូលធំ ឬ អាគារ A' : 'e.g. Main Gate Entrance - Tower A'}
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl"
              />
            </div>
          </div>

          {/* Paste Map Link Resolver */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              {isKm ? 'បិទភ្ជាប់តំណភ្ជាប់ផែនទី (ស្រេចចិត្ត)' : 'Paste Map Link / Share URL (Optional)'}
            </label>
            <input
              type="text"
              placeholder={isKm ? 'ឧ. https://maps.app.goo.gl/... ឬ https://maps.google.com/?q=11.5564,104.9282' : 'https://maps.google.com/?q=11.5564,104.9282 or https://maps.app.goo.gl/...'}
              value={pastedMapUrl}
              onChange={(e) => handleMapUrlChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono text-[11px] bg-white focus:ring-2 focus:ring-[var(--portal-primary)] focus:outline-hidden"
            />
            {mapResolving && (
              <p className="text-[10px] text-[var(--portal-primary)] mt-1 font-medium animate-pulse">
                {isKm ? 'កំពុងទាញយកទីតាំងពីផែនទី...' : 'Resolving map coordinates...'}
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
            <MapPin className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
            <span>{geoLoading ? (isKm ? 'កំពុងស្វែងរកទីតាំង GPS...' : 'Detecting device location...') : (isKm ? 'ប្រើទីតាំង GPS ឧបករណ៍បច្ចុប្បន្ន' : 'Use Current Device GPS Location')}</span>
          </button>

          {/* Real-time Leaflet Map Component */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ម្ជុលទីតាំងកំណត់លើផែនទីជាក់ស្តែង' : 'Real-Time Interactive Map Pin'}</label>
            <SiteLocationPicker
              latitude={parseFloat(siteLat) || 11.5564}
              longitude={parseFloat(siteLng) || 104.9282}
              radiusMeters={parseInt(siteRadius, 10) || 100}
              onChange={({ latitude, longitude }) => handleMapPointChange({ latitude, longitude })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'រយៈទទឹង (Latitude) *' : 'Latitude *'}</label>
              <input
                type="text"
                required
                value={siteLat}
                onChange={(e) => setSiteLat(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'រយៈបណ្តោយ (Longitude) *' : 'Longitude *'}</label>
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
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ទីតាំងកំណត់ (គិតជាម៉ែត្រ) *' : 'Allowed Location Radius (Meters) *'}</label>
              <input
                type="number"
                required
                min="10"
                max="5000"
                value={siteRadius}
                onChange={(e) => setSiteRadius(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                {isKm ? 'ចម្ងាយជុំវិញការដ្ឋានដែលអនុញ្ញាតឱ្យបុគ្គលិកអាច Check In បាន (ឧ. ១០០ ទៅ ៥០០ ម៉ែត្រ)' : 'Distance perimeter around the site where employees are allowed to check in.'}
              </p>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'តំបន់ម៉ោងផ្លូវការ *' : 'IANA Timezone *'}</label>
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
              {isKm ? 'បោះបង់' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? (isKm ? 'កំពុងរក្សាទុក...' : 'Saving...') : (isKm ? 'រក្សាទុកការដ្ឋាន' : 'Save Physical Site')}
            </button>
          </div>
        </form>
      </Modal>

      {/* 4. Edit Site Modal */}
      <Modal
        isOpen={modalType === 'edit-site' && !!editingSite}
        onClose={() => setModalType(null)}
        title={isKm ? `កែសម្រួលការដ្ឋាន៖ ${editingSite?.name || ''}` : `Edit Site: ${editingSite?.name || ''}`}
        subtitle={isKm ? 'កែប្រែកូអរដោនេលើផែនទី ទីតាំងកំណត់ ឬតំបន់ម៉ោងផ្លូវការ' : 'Update site coordinates, location radius, or official timezone.'}
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
            <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ឈ្មោះការដ្ឋាន *' : 'Site Name *'}</label>
            <input
              type="text"
              required
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl"
            />
          </div>

          {/* Paste Map Link Resolver */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              {isKm ? 'បិទភ្ជាប់តំណភ្ជាប់ផែនទី (ស្រេចចិត្ត)' : 'Paste Map Link / Share URL (Optional)'}
            </label>
            <input
              type="text"
              placeholder={isKm ? 'ឧ. https://maps.app.goo.gl/... ឬ https://maps.google.com/?q=11.5564,104.9282' : 'https://maps.google.com/?q=11.5564,104.9282 or https://maps.app.goo.gl/...'}
              value={pastedMapUrl}
              onChange={(e) => handleMapUrlChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl font-mono text-[11px] bg-white focus:ring-2 focus:ring-[var(--portal-primary)] focus:outline-hidden"
            />
            {mapResolving && (
              <p className="text-[10px] text-[var(--portal-primary)] mt-1 font-medium animate-pulse">
                {isKm ? 'កំពុងទាញយកទីតាំងពីផែនទី...' : 'Resolving map coordinates...'}
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
            <MapPin className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
            <span>{geoLoading ? (isKm ? 'កំពុងស្វែងរកទីតាំង GPS...' : 'Detecting device location...') : (isKm ? 'ប្រើទីតាំង GPS ឧបករណ៍បច្ចុប្បន្ន' : 'Use Current Device GPS Location')}</span>
          </button>

          <div>
            <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ម្ជុលទីតាំងកំណត់លើផែនទីជាក់ស្តែង' : 'Real-Time Interactive Map Pin'}</label>
            <SiteLocationPicker
              latitude={parseFloat(siteLat) || 11.5564}
              longitude={parseFloat(siteLng) || 104.9282}
              radiusMeters={parseInt(siteRadius, 10) || 100}
              onChange={({ latitude, longitude }) => handleMapPointChange({ latitude, longitude })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'រយៈទទឹង (Latitude) *' : 'Latitude *'}</label>
              <input
                type="text"
                required
                value={siteLat}
                onChange={(e) => setSiteLat(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'រយៈបណ្តោយ (Longitude) *' : 'Longitude *'}</label>
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
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'ទីតាំងកំណត់ (គិតជាម៉ែត្រ) *' : 'Allowed Location Radius (Meters) *'}</label>
              <input
                type="number"
                required
                min="10"
                max="5000"
                value={siteRadius}
                onChange={(e) => setSiteRadius(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                {isKm ? 'ចម្ងាយជុំវិញការដ្ឋានដែលអនុញ្ញាតឱ្យបុគ្គលិកអាច Check In បាន (ឧ. ១០០ ទៅ ៥០០ ម៉ែត្រ)' : 'Distance perimeter around the site where employees are allowed to check in.'}
              </p>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">{isKm ? 'តំបន់ម៉ោងផ្លូវការ' : 'IANA Timezone'}</label>
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
              {isKm ? 'បោះបង់' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? (isKm ? 'កំពុងកែប្រែ...' : 'Updating...') : (isKm ? 'កែប្រែការដ្ឋាន' : 'Update Site')}
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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
        title={km.schedules.editTitle.replace('{name}', editingSchedule?.name || '')}
        subtitle={km.schedules.editSubtitle}
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
            <label className="block font-medium text-slate-700 mb-1">{km.schedules.name}</label>
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
              <label className="block font-medium text-slate-700 mb-1">{km.schedules.startTime}</label>
              <input
                type="time"
                required
                value={schStart}
                onChange={(e) => setSchStart(e.target.value)}
                className="w-full px-3 py-2 border rounded-xl font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">{km.schedules.endTime}</label>
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
              <label className="block font-medium text-slate-700 mb-1">{km.schedules.gracePeriod}</label>
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
              <label className="block font-medium text-slate-700 mb-1">{km.schedules.timezone}</label>
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
              {km.schedules.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              {isSubmitting ? km.schedules.saving : km.schedules.saveChanges}
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer"
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
            {employees.filter((emp) => emp.status === 'ACTIVE').map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.employeeCode})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!grpAddEmpId || isSubmitting}
            className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
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
          <div><span className="text-slate-500">Requested Position:</span> <span className="font-bold text-[var(--portal-primary)]">{selectedRequest?.requestedPositionName}</span></div>
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
            className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl font-bold cursor-pointer"
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
            className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
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
              {employees.filter((emp) => emp.status === 'ACTIVE').map((emp) => (
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
                {sites.filter((s) => s.status === 'ACTIVE').map((s) => (
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
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
              className="px-4 py-2 bg-[var(--portal-primary)] hover:brightness-90 text-white rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Linking...' : 'Link Telegram'}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmActionDialog open={Boolean(pendingRemoval)} title={km.actions.confirmRemovalTitle} description={km.actions.confirmRemovalDescription} confirmLabel={km.actions.remove} destructive pending={isSubmitting} onCancel={() => setPendingRemoval(null)} onConfirm={() => void confirmRemoval()} />
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
