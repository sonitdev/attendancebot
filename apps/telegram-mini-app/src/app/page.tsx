'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { km, type TelegramSessionResponse, type WorkerConnectedProject, type WorkerSalesDay, type WorkerSalesOutlet, type WorkerTodayResponse } from '@workforce/contracts';
import { api, ApiError, recordClientTiming } from '@/lib/api';
import { AttendanceLocation } from '@/lib/attendance-location';
import { AttendanceCamera, type CameraFacing, type CameraState } from '@/lib/attendance-camera';
import { formatStatus } from '@/lib/format';
import { hasCurrentAssignment, readWorkerCache, clearLegacyWorkerSession, writeWorkerToday } from '@/lib/worker-cache';
import { createVerifiedSession, waitForTelegram } from '@/lib/telegram-session';
import { AttendanceSubmission, applyAttendanceResult, hasSavedAttendance, isUncertainSubmission, notifyAttendanceHaptic } from '@/lib/attendance-submission';
import { ensureWatermarkFontsLoaded, renderEvidencePhoto, resolveEvidenceLocationName } from '@/lib/watermark';
import { CameraProofPreview } from './camera-proof-preview';
import { CameraProofActions } from './camera-proof-actions';

export default function WorkerHomePage() {
  const [session, setSession] = useState<TelegramSessionResponse | null>(null);
  const [todayData, setTodayData] = useState<WorkerTodayResponse | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [initSlow, setInitSlow] = useState<boolean>(false);
  const [startupStage, setStartupStage] = useState<'telegram' | 'session' | 'attendance'>('telegram');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>({ status: 'idle' });
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [cameraAction, setCameraAction] = useState<'CHECK_IN' | 'VISIT'>('CHECK_IN');
  const [visitCustomer, setVisitCustomer] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [visitOutletId, setVisitOutletId] = useState('');
  const [salesOutlets, setSalesOutlets] = useState<WorkerSalesOutlet[]>([]);
  const [salesDay, setSalesDay] = useState<WorkerSalesDay | null>(null);
  const [reportSummary, setReportSummary] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [editingVisitId, setEditingVisitId] = useState<string | null>(null);
  const [visitStatement, setVisitStatement] = useState('');
  const [visitResult, setVisitResult] = useState('');
  const [visitFollowUp, setVisitFollowUp] = useState(false);
  const [visitFollowUpAt, setVisitFollowUpAt] = useState('');
  const [visitOrderQuantity, setVisitOrderQuantity] = useState('');
  const [visitDiscountRequest, setVisitDiscountRequest] = useState('');
  const [connectedProjects, setConnectedProjects] = useState<WorkerConnectedProject[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const verifiedSession = useRef<TelegramSessionResponse | null>(null);
  const todayReadVersion = useRef(0);
  const attendanceSubmission = useRef(new AttendanceSubmission());
  const attendanceBusy = useRef(false);
  const attendanceLocation = useRef(new AttendanceLocation());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera] = useState(() => new AttendanceCamera(setCameraState));
  const cameraFacing = useRef<CameraFacing>('environment');
  const captureGeneration = useRef(0);
  const captureBusy = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const cameraReady = cameraState.status === 'ready';
  const cameraUnavailable = cameraState.status === 'error';
  const cameraErrorText = cameraState.status === 'error' ? {
    PERMISSION_DENIED: km.attendance.cameraDenied,
    UNSUPPORTED: km.attendance.cameraUnsupported,
    INSECURE: km.attendance.cameraInsecure,
    BUSY: km.attendance.cameraBusy,
    TIMEOUT: km.attendance.cameraTimedOut,
    UNAVAILABLE: km.attendance.cameraUnavailable,
    PLAYBACK: km.attendance.cameraUnavailable,
  }[cameraState.reason] : km.attendance.cameraUnavailable;

  const attachCameraVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    camera.attach(video);
  }, [camera]);

  useEffect(() => () => {
    captureGeneration.current += 1;
    camera.stop();
  }, [camera]);

  // Request GPS after the camera permission flow, so two permission prompts do not compete.
  useEffect(() => {
    if (cameraOpen && cameraReady && !proofPhoto) attendanceLocation.current.prime();
  }, [cameraOpen, cameraReady, proofPhoto]);

  function closeCamera(preserveLocation = false) {
    captureGeneration.current += 1;
    captureBusy.current = false;
    setCapturing(false);
    camera.stop();
    if (!preserveLocation) attendanceLocation.current.clear();
    setCameraOpen(false);
  }

  function switchCamera(facing: CameraFacing) {
    if (captureBusy.current) return;
    cameraFacing.current = facing;
    camera.start(facing);
  }

  function openAttendanceCamera() {
    attendanceLocation.current.clear();
    setCameraOpen(true);
    // Start from the explicit tap, not a delayed effect or file-picker callback.
    camera.start(cameraFacing.current);
    void ensureWatermarkFontsLoaded().catch(() => undefined);
  }

  function saveToday(today: WorkerTodayResponse | null) {
    const completeToday = hasCurrentAssignment(today) ? today : null;
    setTodayData(completeToday);
    writeWorkerToday(completeToday, verifiedSession.current);
  }

  // Authenticate first; cached data is only a preview for that verified worker.
  useEffect(() => {
    let activeToken: string | undefined;
    let disposed = false;
    clearLegacyWorkerSession();
    const slowTimer = setTimeout(() => {
      setInitSlow(true);
    }, 3500);

    async function initSession() {
      try {
        const webApp = await waitForTelegram();
        if (disposed) return;
        try {
          webApp.ready();
          webApp.expand();
        } catch {}
        const initData = webApp.initData;
        if (initData) {
          setStartupStage('session');
          const sess = await createVerifiedSession(initData);
          if (disposed) return;
          verifiedSession.current = sess;
          setSession(sess);
          const cached = readWorkerCache(sess);
          if (cached.today) {
            setTodayData(cached.today);
            setLoading(false);
          }
          activeToken = sess.token;
        } else if (process.env.NODE_ENV === 'development') {
          const savedToken = sessionStorage.getItem('dev_worker_token');
          if (savedToken) {
            const parsedSession = JSON.parse(sessionStorage.getItem('dev_worker_session') || '{}');
            verifiedSession.current = parsedSession;
            setSession(parsedSession);
            activeToken = savedToken;
          }
        }

        if (activeToken) {
          setStartupStage('attendance');
          void api.getConnectedProjects(activeToken).then((projects) => {
            if (!disposed) setConnectedProjects(projects);
          }).catch(() => undefined);
          await loadToday(activeToken);
        }
      } catch (err: any) {
        if (disposed) return;
        if (
          err.code === 'REGISTRATION_PENDING' ||
          err.message?.includes('REGISTRATION_PENDING')
        ) {
          setFeedback({
            type: 'info',
            text: km.attendance.registrationPending,
          });
        } else if (
          err.code === 'TELEGRAM_UNLINKED' ||
          err.message?.includes('TELEGRAM_UNLINKED')
        ) {
          setFeedback({
            type: 'info',
            text: km.attendance.telegramUnlinked,
          });
        } else {
          setFeedback({ type: 'error', text: km.attendance.authenticationFailed });
        }
      } finally {
        if (!disposed) setLoading(false);
        clearTimeout(slowTimer);
      }
    }

    initSession();
    return () => {
      disposed = true;
      attendanceLocation.current.clear();
      todayReadVersion.current += 1;
      clearTimeout(slowTimer);
    };
  }, []);

  async function loadToday(token: string, options: { preserveFeedback?: boolean } = {}) {
    const version = ++todayReadVersion.current;
    try {
      const today = await api.getToday(token);
      if (version !== todayReadVersion.current) return;
      if (!hasCurrentAssignment(today)) {
        saveToday(null);
        if (!options.preserveFeedback) setFeedback({ type: 'info', text: km.attendance.noCurrentProject });
        return;
      }
      saveToday(today);
      setLoading(false);
      if (!options.preserveFeedback) setFeedback(null);
      if (today.currentProject.workMode === 'SALES') {
        const [outlets, report] = await Promise.all([
          api.getSalesOutlets(token).catch(() => []),
          api.getSalesDay(token).catch(() => null),
        ]);
        if (version !== todayReadVersion.current) return;
        setSalesOutlets(outlets);
        setSalesDay(report);
        setReportSummary(report?.workerSummary ?? '');
        setReportNote(report?.additionalNote ?? '');
      } else {
        setSalesOutlets([]);
        setSalesDay(null);
      }
    } catch (err: any) {
      if (version !== todayReadVersion.current || options.preserveFeedback) return;
      const errorCode = err instanceof ApiError && err.code !== 'API_ERROR' ? err.code : err.message;
      if (errorCode === 'NO_VALID_ASSIGNMENT' || errorCode === 'NO_CURRENT_PROJECT') {
        saveToday(null);
        setFeedback({ type: 'info', text: errorCode === 'NO_CURRENT_PROJECT' ? km.attendance.noCurrentProject : km.attendance.noAssignment });
      } else {
        setFeedback({ type: 'error', text: km.attendance.scheduleLoadFailed });
      }
    } finally {
      if (version === todayReadVersion.current) setLoading(false);
    }
  }

  async function selectProject(projectId: string) {
    if (!session?.token || actionLoading) return;
    try {
      setActionLoading(km.attendance.changeProject);
      await api.setCurrentProject(session.token, projectId);
      setConnectedProjects(await api.getConnectedProjects(session.token));
      setShowProjectPicker(false);
      await loadToday(session.token, { preserveFeedback: true });
      setFeedback({ type: 'success', text: km.telegram.currentProjectUpdated });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setActionLoading(null);
    }
  }

  // Authoritative GPS Check-in / Check-out flow
  async function handleAttendanceAction(action: 'CHECK_IN' | 'CHECK_OUT' | 'VISIT', proofPhotoDataUrl?: string) {
    if (!session?.token || !todayData || attendanceBusy.current) return;
    const scope = [session.organization.id, session.employee.id, todayData.currentProject.id, todayData.assignment.id, todayData.date, action].join(':');
    setFeedback(null);

    if (!navigator.geolocation) {
      setFeedback({ type: 'error', text: km.attendance.geolocationUnsupported });
      return;
    }

    attendanceBusy.current = true;
    // Ignore an older dashboard response arriving while this action is in flight.
    todayReadVersion.current += 1;
    setActionLoading(km.attendance.receivingLocation);

    void attendanceLocation.current.get().then(
      async (pos) => {
        try {
          setActionLoading(km.attendance.verifyingAndSubmitting);
          const locationInput = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
            capturedAt: new Date(pos.timestamp).toISOString(),
            deviceContext: {
              platform: navigator.userAgent.slice(0, 80),
              appVersion: '1.0.0',
            },
          };

          const result = await attendanceSubmission.current.submit<Awaited<ReturnType<typeof api.checkIn | typeof api.recordVisit>>>(scope, (idempotencyKey) =>
            action === 'CHECK_IN'
              ? api.checkIn(session.token, { ...locationInput, proofPhotoDataUrl: proofPhotoDataUrl! }, idempotencyKey)
              : action === 'VISIT'
              ? api.recordVisit(session.token, { ...locationInput, proofPhotoDataUrl: proofPhotoDataUrl!, ...(visitOutletId ? { outletId: visitOutletId } : {}), ...(visitCustomer.trim() ? { customerName: visitCustomer.trim() } : {}), ...(visitNote.trim() ? { note: visitNote.trim() } : {}) }, idempotencyKey)
              : api.checkOut(session.token, locationInput, idempotencyKey));

          if ('attendanceId' in result) saveToday(applyAttendanceResult(todayData, result));
          notifyAttendanceHaptic(result.verificationResult);

          setFeedback({
            type: result.verificationResult === 'VERIFIED' ? 'success' : 'info',
            text: `${result.verificationResult === 'VERIFIED'
              ? action === 'CHECK_IN'
                ? km.attendance.checkInSuccess
                : action === 'CHECK_OUT'
                ? km.attendance.checkOutSuccess
                : km.attendance.visitSuccess
              : km.attendance.recordedWithWarning} · ${km.attendance.distanceFromSite(result.distanceMeters)}`,
          });

          // The attendance response already contains the new authoritative state.
          // Only sales/visit details need an additional read.
          if (todayData.currentProject.workMode === 'SALES') {
            void api.getSalesDay(session.token).then((report) => setSalesDay(report)).catch(() => undefined);
          }
        } catch (err: any) {
          if (isUncertainSubmission(err)) {
            setFeedback({ type: 'info', text: km.attendance.submissionUnconfirmed });
            // Read-only reconciliation: never automatically submit a second action.
            const version = ++todayReadVersion.current;
            try {
              const latest = await api.getToday(session.token);
              if (version === todayReadVersion.current && hasCurrentAssignment(latest)) {
                saveToday(latest);
                if (hasSavedAttendance(todayData, latest, action)) {
                  attendanceSubmission.current.confirm(scope);
                  setFeedback({ type: 'success', text: action === 'CHECK_IN' ? km.attendance.checkInSuccess : km.attendance.checkOutSuccess });
                }
              }
            } catch { /* Keep the honest unconfirmed state; never claim the write failed. */ }
            return;
          }
          const errorCode = err instanceof ApiError && err.code !== 'API_ERROR' ? err.code : err?.message;
          const message = errorCode === 'NO_OPEN_ATTENDANCE'
            ? km.attendance.noOpenAttendance
            : errorCode === 'NO_VALID_ASSIGNMENT'
            ? km.attendance.noAssignment
            : km.attendance.requestFailed;
          setFeedback({
            type: 'error',
            text: message,
          });
        } finally {
          attendanceLocation.current.clear();
          attendanceBusy.current = false;
          setActionLoading(null);
        }
      },
      (geoErr) => {
        attendanceBusy.current = false;
        setActionLoading(null);
        let msg: string = km.attendance.locationAccessFailed;
        if (geoErr.code === 1) msg = km.attendance.locationRequired;
        if (geoErr.code === 2) msg = km.attendance.locationUnavailable;
        if (geoErr.code === 3) msg = km.attendance.locationTimedOut;
        setFeedback({ type: 'error', text: msg });
      },
    );
  }

  async function saveVisitContext() {
    if (!session?.token || !salesDay || !editingVisitId || !visitStatement.trim()) return;
    try {
      setActionLoading(km.attendance.saveVisitResult);
      const parsedOrderQty = visitOrderQuantity.trim() ? parseInt(visitOrderQuantity.trim(), 10) : undefined;
      const parsedDiscount = visitDiscountRequest.trim() ? parseFloat(visitDiscountRequest.trim()) : undefined;
      const followUpIso = visitFollowUp && visitFollowUpAt.trim() ? new Date(`${visitFollowUpAt.trim()}T09:00:00.000Z`).toISOString() : undefined;

      await api.updateSalesVisit(session.token, salesDay.id, editingVisitId, {
        workerStatement: visitStatement.trim(),
        ...(visitResult.trim() ? { visitResult: visitResult.trim() } : {}),
        followUpRequired: visitFollowUp,
        ...(followUpIso ? { followUpAt: followUpIso } : {}),
        ...(parsedOrderQty != null && !isNaN(parsedOrderQty) ? { potentialOrderQuantity: parsedOrderQty } : {}),
        ...(parsedDiscount != null && !isNaN(parsedDiscount) ? { requestedDiscountPerItem: parsedDiscount } : {}),
      });
      setEditingVisitId(null);
      await loadToday(session.token, { preserveFeedback: true });
      setFeedback({ type: 'success', text: km.actions.saved });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || km.attendance.requestFailed });
    } finally {
      setActionLoading(null);
    }
  }

  async function saveSalesReport(submit = false) {
    if (!session?.token || !salesDay) return;
    try {
      setActionLoading(submit ? km.attendance.submitReport : km.attendance.saveReport);
      await api.updateSalesReport(session.token, salesDay.id, {
        ...(reportSummary.trim() ? { workerSummary: reportSummary.trim() } : {}),
        ...(reportNote.trim() ? { additionalNote: reportNote.trim() } : {}),
      });
      if (submit) {
        await api.submitSalesReport(session.token, salesDay.id);
      }
      // Keep the submit interaction fast; refresh the report in the background.
      void loadToday(session.token, { preserveFeedback: true }).catch(() => undefined);
      setFeedback({ type: 'success', text: submit ? km.telegram.salesReportSubmitted : km.actions.saved });
    } catch (err: any) {
      if (submit && session?.token) {
        try {
          const authoritativeReport = await api.getSalesDay(session.token);
          if (authoritativeReport.status === 'SUBMITTED') {
            setFeedback({ type: 'success', text: km.telegram.salesReportSubmitted });
            setSalesDay(authoritativeReport);
            return;
          }
        } catch {
          // Preserve the original actionable error when status recovery also fails.
        }
      }
      const message = err.message?.includes('END_WORK_REQUIRED')
        ? km.attendance.reportRequiresCheckout
        : err.message?.includes('REPORT_VISIT_CONTEXT_REQUIRED')
        ? km.attendance.reportRequiresVisitDetails
        : err.message || km.attendance.requestFailed;
      setFeedback({ type: 'error', text: message });
    } finally {
      setActionLoading(null);
    }
  }

  async function captureProofPhoto() {
    const video = videoRef.current;
    if (!cameraReady || !video || !video.videoWidth || !video.videoHeight || captureBusy.current) return;
    const generation = ++captureGeneration.current;
    captureBusy.current = true;
    setCapturing(true);
    const renderStarted = performance.now();
    try {
      const dataUrl = await renderEvidencePhoto(video, video.videoWidth, video.videoHeight, {
        workerName: session?.employee?.fullName,
        siteName: todayData?.site?.name,
        projectName: todayData?.currentProject?.name,
        timezone: todayData?.site?.timezone || 'Asia/Phnom_Penh',
      });
      if (generation !== captureGeneration.current) return;
      camera.stop();
      setProofPhoto(dataUrl);
    } catch {
      if (generation === captureGeneration.current) setFeedback({ type: 'error', text: km.attendance.invalidPhoto });
    } finally {
      recordClientTiming('renderEvidencePhoto', performance.now() - renderStarted);
      if (generation === captureGeneration.current) {
        captureBusy.current = false;
        setCapturing(false);
      }
    }
  }

  function formatSiteTime(iso: string | null, timezone: string) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  }

  async function handleSimulateDevLogin() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5131/api/v1'}/health`);
      if (!res.ok) throw new Error(km.attendance.apiOffline);

      setFeedback({
        type: 'info',
        text: km.attendance.browserTestHint,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-[80vh] flex flex-col items-center justify-center p-6 space-y-4 text-center">
        <div className="w-11 h-11 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p role="status" className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{startupStage === 'telegram' ? km.app.connectingTelegram : startupStage === 'attendance' ? km.app.loadingAttendance : km.app.loading}</p>
        {initSlow && (
          <div className="mt-4 flex flex-col items-center gap-2 animate-fade-in">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
              {km.app.startupSlow}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoading(false);
                window.location.reload();
              }}
              className="mt-1 px-4 py-2 bg-[#023F26] text-white rounded-xl text-xs font-bold shadow hover:bg-emerald-900 active:scale-95 transition"
            >
              🔄 ព្យាយាមម្តងទៀត (Reload)
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="motion-stage flex-1 flex flex-col px-4 pb-8 pt-5 max-w-md mx-auto w-full">
      {/* Top Profile Header */}
      {session ? (
        <header className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-200 mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {session.employee.avatarUrl ? (
              <img
                src={session.employee.avatarUrl}
                alt={session.employee.fullName}
                className="w-12 h-12 rounded-full object-cover border border-zinc-200"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-base shadow-sm">
                {session.employee.fullName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-sm font-bold text-zinc-900 leading-tight">
                {session.employee.fullName}
              </h1>
              <p className="text-xs text-zinc-500">{session.employee.employeeCode}</p>
            </div>
          </div>

          <div className="flex flex-col items-end space-y-1">
            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
              {session.organization.name}
            </span>
            {session.employee.currentPosition ? (
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                ⚡ {session.employee.currentPosition.name}
              </span>
            ) : (
              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
                {km.attendance.unassignedPosition}
              </span>
            )}
          </div>
        </header>
      ) : (
        <div className="premium-card rounded-[1.75rem] overflow-hidden mb-5">
          <div className="bg-[#063f2b] px-5 pb-6 pt-7 text-white">
            <p className="premium-kicker text-[#d9e86c]">TOSSANA ATTENDANCE</p>
            <h1 className="mt-2 text-[1.85rem] font-extrabold leading-[1.18] tracking-[-0.04em]">{km.attendance.telegramRequired}</h1>
            <p className="mt-3 text-sm leading-7 text-emerald-50/80">{km.attendance.telegramRequiredHint}</p>
          </div>
          <div className="p-5">
            <div className="rounded-2xl border border-dashed border-[#b6c4b9] bg-[#f6f8f3] px-4 py-5 text-center text-sm leading-7 text-[#6d7c74]">
              សូមបើកពីក្នុង Telegram របស់អ្នក ដើម្បីបន្តការផ្ទៀងផ្ទាត់។
            </div>
            <button
              onClick={handleSimulateDevLogin}
              className="mt-4 rounded-xl bg-[#d97706] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#b45309] active:scale-95"
            >
              {km.attendance.checkApiStatus}
            </button>
          </div>
        </div>
      )}


      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs font-medium mb-4 border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : feedback.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : 'bg-blue-50 text-blue-800 border-blue-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="space-y-4">
          {hasCurrentAssignment(todayData) ? (
            <>
              {/* Assignment & Site Card */}
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-200 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                  <div>
                    <span className="text-[10px] font-bold tracking-wide text-blue-600">
                      {km.attendance.currentProject}
                    </span>
                    <h2 className="text-base font-bold text-zinc-900">{todayData.currentProject.name}</h2>
                    <p className="mt-0.5 text-xs font-medium text-zinc-500">{todayData.site.name}</p>
                  </div>
                  <div className="text-right"><span className="block rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-800">{todayData.currentProject.workMode === 'SALES' ? km.attendance.salesMode : km.attendance.siteMode}</span><span className="mt-1 block text-[10px] font-semibold text-zinc-500">{km.attendance.allowedDistance} {todayData.site.allowedRadiusMeters}m</span></div>
                </div>

                {!todayData.attendance?.checkInAt && connectedProjects.length > 1 && (
                  <button onClick={() => setShowProjectPicker((open) => !open)} className="text-xs font-bold text-emerald-700 underline">
                    {km.attendance.changeProject}
                  </button>
                )}
                {showProjectPicker && !todayData.attendance?.checkInAt && (
                  <div className="space-y-1 border-t border-zinc-100 pt-2">
                    {connectedProjects.map((project) => <button key={project.id} onClick={() => void selectProject(project.id)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs hover:bg-zinc-50"><span>{project.name}</span><span>{project.isCurrent ? '✓' : ''}</span></button>)}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-400">{km.attendance.shiftSchedule}:</span>
                    <p className="font-semibold text-zinc-800">
                      {todayData.schedule.startTime} - {todayData.schedule.endTime}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400">{km.attendance.timezone}:</span>
                    <p className="font-semibold text-zinc-800">{todayData.siteTimezone}</p>
                  </div>
                </div>
              </div>

              {/* Attendance Status Card */}
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-200 space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-700">{km.attendance.todayStatus}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      todayData.attendance?.status === 'COMPLETED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : todayData.attendance?.status === 'ON_TIME'
                        ? 'bg-blue-100 text-blue-800'
                        : todayData.attendance?.status === 'LATE'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {formatStatus(todayData.attendance?.status || 'NOT_STARTED')}
                  </span>
                </div>

                {todayData.attendance && (
                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-zinc-100 pt-2.5">
                    <div>
                      <span className="text-zinc-400">{km.attendance.checkIn}:</span>
                      <p className="font-bold text-zinc-800">
                        {todayData.attendance.checkInAt
                          ? formatSiteTime(todayData.attendance.checkInAt, todayData.siteTimezone)
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">{km.attendance.checkOut}:</span>
                      <p className="font-bold text-zinc-800">
                        {todayData.attendance.checkOutAt
                          ? formatSiteTime(todayData.attendance.checkOutAt, todayData.siteTimezone)
                          : '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Primary Action Button (Min 48px height) */}
              <div className="pt-2">
                {todayData.attendance?.checkOutAt ? (
                  <div className="w-full py-4 rounded-2xl bg-zinc-100 text-zinc-500 font-bold text-center text-sm border border-zinc-200">
                    {km.attendance.completed}
                  </div>
                ) : todayData.attendance?.checkInAt ? (
                  <div className={todayData.currentProject.workMode === 'SALES' ? 'grid grid-cols-2 gap-2' : ''}>
                  {todayData.currentProject.workMode === 'SALES' && <button
                    disabled={actionLoading !== null}
                    onClick={() => { setProofPhoto(null); setVisitOutletId(''); setVisitCustomer(''); setVisitNote(''); setCameraAction('VISIT'); openAttendanceCamera(); }}
                    className="min-h-[52px] rounded-2xl bg-[#023F26] px-3 py-3 text-sm font-bold text-white shadow-md"
                  >{km.attendance.recordVisit}</button>}
                  <button
                    disabled={actionLoading !== null}
                    onClick={() => handleAttendanceAction('CHECK_OUT')}
                    className="w-full min-h-[52px] py-4 rounded-2xl bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white font-bold text-base shadow-md transition-all flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm">{actionLoading}</span>
                      </>
                    ) : (
                      <span>{todayData.currentProject.workMode === 'SALES' ? km.attendance.endWork : km.attendance.checkOut}</span>
                    )}
                  </button>
                  </div>
                ) : (
                  <button
                    disabled={actionLoading !== null}
                    onClick={() => {
                      setProofPhoto(null);
                      setCameraAction('CHECK_IN');
                      openAttendanceCamera();
                    }}
                    className="w-full min-h-[52px] py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base shadow-md transition-all flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm">{actionLoading}</span>
                      </>
                    ) : (
                      <span>{todayData.currentProject.workMode === 'SALES' ? km.attendance.startWork : km.attendance.checkIn}</span>
                    )}
                  </button>
                )}
              </div>

              {cameraOpen && (
                <section className="fixed inset-0 z-50 flex items-end bg-slate-950/75 p-3 sm:items-center sm:justify-center backdrop-blur-sm" role="dialog" aria-modal="true">
                  <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <div>
                        <p className="text-sm font-extrabold text-slate-900">{km.attendance.proofPhotoTitle}</p>
                        <p className="text-xs text-slate-500">{km.attendance.proofPhotoHint}</p>
                      </div>
                      <button onClick={() => closeCamera()} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
                        {km.attendance.close}
                      </button>
                    </div>

                    <CameraProofPreview
                      proofPhoto={proofPhoto}
                      proofPhotoAlt={km.attendance.proofPhotoAlt}
                      proofPhotoTitle={km.attendance.proofPhotoTitle}
                      cameraReady={cameraReady}
                      cameraUnavailable={cameraUnavailable}
                      cameraStarting={km.attendance.cameraStarting}
                      cameraFallbackHint={cameraErrorText}
                      timezone={todayData?.site.timezone || 'Asia/Phnom_Penh'}
                      workerName={session?.employee?.fullName}
                      locationName={resolveEvidenceLocationName({
                        siteName: todayData?.site?.name,
                        projectName: todayData?.currentProject?.name,
                      })}
                      videoRef={attachCameraVideo}
                    />

                    {/* Quick camera trigger buttons when no photo is taken yet */}
                    {!proofPhoto ? (
                      <CameraProofActions onSwitch={switchCamera} disabled={capturing} />
                    ) : null}

                    {cameraAction === 'VISIT' ? (
                      <div className="grid gap-2 px-4 pt-3">
                        <p className="text-xs font-semibold text-slate-500">{km.attendance.salesVisitHint}</p>
                        <select value={visitOutletId} onChange={(event) => setVisitOutletId(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-700">
                          <option value="">{km.attendance.selectOutlet}</option>
                          {salesOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                        </select>
                        <input value={visitCustomer} onChange={(event) => setVisitCustomer(event.target.value)} maxLength={120} placeholder={km.attendance.visitCustomer} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-700" />
                        <textarea value={visitNote} onChange={(event) => setVisitNote(event.target.value)} maxLength={500} rows={2} placeholder={km.attendance.visitNote} className="resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-700" />
                      </div>
                    ) : null}

                    <div className="flex gap-2 p-4">
                      {proofPhoto ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setProofPhoto(null);
                              camera.start(cameraFacing.current);
                            }}
                            className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.98]"
                          >
                            {km.attendance.retakePhoto}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              closeCamera(true);
                              handleAttendanceAction(cameraAction, proofPhoto);
                            }}
                            className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-3 text-sm font-extrabold text-white shadow-md active:scale-[0.98]"
                          >
                            {cameraAction === 'VISIT' ? km.attendance.recordVisitWithPhoto : km.attendance.checkInWithPhoto}
                          </button>
                        </>
                      ) : cameraReady ? (
                        <button
                          type="button"
                          onClick={captureProofPhoto}
                          disabled={capturing}
                          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white active:scale-[0.98]"
                        >
                          {capturing ? km.actions.processing : km.attendance.takePhoto}
                        </button>
                      ) : cameraUnavailable ? (
                        <button type="button" onClick={() => camera.start(cameraFacing.current)} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white">
                          {km.attendance.cameraRetry}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              )}

              {todayData.currentProject.workMode === 'SALES' && salesDay && (
                <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between"><h2 className="text-sm font-black text-zinc-900">{km.attendance.todayVisits}</h2><span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-black text-zinc-700">{salesDay.visits.length}</span></div>
                  {salesDay.visits.length === 0 ? <p className="rounded-xl bg-zinc-50 p-4 text-center text-xs text-zinc-500">{km.attendance.noVisitsYet}</p> : salesDay.visits.map((visit, index) => (
                    <article key={visit.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-extrabold text-zinc-900">{index + 1}. {visit.outlet?.name || visit.customerName || km.telegram.unknownOutlet}</p>
                          <p className="mt-1 text-[11px] text-zinc-500">{formatSiteTime(visit.visitedAt, todayData.siteTimezone)}</p>
                        </div>
                        {salesDay.status !== 'SUBMITTED' && (
                          <button
                            onClick={() => {
                              setEditingVisitId(visit.id);
                              setVisitStatement(visit.workerStatement ?? '');
                              setVisitResult(visit.visitResult ?? '');
                              setVisitFollowUp(visit.followUpRequired);
                              setVisitFollowUpAt(visit.followUpAt ? visit.followUpAt.slice(0, 10) : '');
                              setVisitOrderQuantity(visit.potentialOrderQuantity ? String(visit.potentialOrderQuantity) : '');
                              setVisitDiscountRequest(visit.requestedDiscountPerItem != null ? String(visit.requestedDiscountPerItem) : '');
                            }}
                            className={`rounded-lg px-2 py-1 text-[10px] font-black ${
                              visit.needsContext ? 'bg-amber-100 text-amber-900' : 'bg-zinc-200 text-zinc-700'
                            }`}
                          >
                            {visit.needsContext ? km.attendance.completeVisitContext : km.admin.edit}
                          </button>
                        )}
                      </div>
                      {editingVisitId === visit.id ? (
                        <div className="mt-3 grid gap-2 border-t border-zinc-200 pt-3">
                          <textarea
                            value={visitStatement}
                            onChange={(event) => setVisitStatement(event.target.value)}
                            rows={3}
                            placeholder={km.attendance.workerStatement}
                            className="rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none focus:border-[#023F26]"
                          />
                          <input
                            value={visitResult}
                            onChange={(event) => setVisitResult(event.target.value)}
                            placeholder={km.attendance.visitResult}
                            className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-[#023F26]"
                          />
                          <input
                            type="number"
                            value={visitOrderQuantity}
                            onChange={(event) => setVisitOrderQuantity(event.target.value)}
                            placeholder={km.attendance.potentialOrderQuantity}
                            className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-[#023F26]"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={visitDiscountRequest}
                            onChange={(event) => setVisitDiscountRequest(event.target.value)}
                            placeholder={km.attendance.requestedDiscountPerItem}
                            className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-[#023F26]"
                          />
                          <label className="flex items-center gap-2 text-xs font-bold text-zinc-700">
                            <input
                              type="checkbox"
                              checked={visitFollowUp}
                              onChange={(event) => setVisitFollowUp(event.target.checked)}
                            />
                            {km.attendance.followUpRequired}
                          </label>
                          {visitFollowUp && (
                            <label className="block text-xs font-bold text-zinc-700">
                              {km.attendance.followUpAt}
                              <input
                                type="date"
                                value={visitFollowUpAt}
                                onChange={(event) => setVisitFollowUpAt(event.target.value)}
                                className="mt-1 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-[#023F26]"
                              />
                            </label>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => setEditingVisitId(null)}
                              className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-xs font-bold text-zinc-600"
                            >
                              {km.attendance.close}
                            </button>
                            <button
                              onClick={() => void saveVisitContext()}
                              disabled={!visitStatement.trim()}
                              className="flex-1 rounded-xl bg-[#023F26] py-2.5 text-xs font-black text-white disabled:opacity-50"
                            >
                              {km.attendance.saveVisitResult}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 space-y-1 text-xs text-zinc-600">
                          {visit.visitResult && <p><span className="font-bold text-zinc-800">{km.attendance.visitResult}:</span> {visit.visitResult}</p>}
                          {visit.potentialOrderQuantity != null && <p><span className="font-bold text-zinc-800">{km.attendance.potentialOrderQuantity}:</span> {visit.potentialOrderQuantity}</p>}
                          {visit.requestedDiscountPerItem != null && <p><span className="font-bold text-zinc-800">{km.attendance.requestedDiscountPerItem}:</span> {visit.requestedDiscountPerItem}</p>}
                          {visit.followUpRequired && <p className="font-bold text-amber-700">{km.attendance.followUpRequired}{visit.followUpAt ? ` (${visit.followUpAt.slice(0, 10)})` : ''}</p>}
                          {visit.workerStatement && <p><span className="font-bold text-zinc-800">{km.attendance.workerStatement}:</span> {visit.workerStatement}</p>}
                        </div>
                      )}
                    </article>
                  ))}
                  <div className="border-t border-zinc-100 pt-3"><div className="flex items-center justify-between"><h2 className="text-sm font-black text-zinc-900">{km.attendance.dailyReport}</h2><span className="text-[10px] font-black text-emerald-800">{salesDay.status === 'SUBMITTED' ? km.attendance.reportSubmitted : km.attendance.reportDraft}</span></div>{salesDay.status !== 'SUBMITTED' && <div className="mt-3 grid gap-2"><textarea value={reportSummary} onChange={(event) => setReportSummary(event.target.value)} rows={3} placeholder={km.attendance.reportSummary} className="rounded-xl border border-zinc-200 p-3 text-sm"/><textarea value={reportNote} onChange={(event) => setReportNote(event.target.value)} rows={2} placeholder={km.attendance.additionalNote} className="rounded-xl border border-zinc-200 p-3 text-sm"/><div className="grid grid-cols-2 gap-2"><button onClick={() => void saveSalesReport(false)} className="rounded-xl border border-emerald-900 py-3 text-xs font-black text-emerald-900">{km.attendance.saveReport}</button><button disabled={!todayData.attendance?.checkOutAt} onClick={() => void saveSalesReport(true)} className="rounded-xl bg-[#023F26] py-3 text-xs font-black text-white disabled:bg-zinc-300">{km.attendance.submitReport}</button></div></div>}</div>
                </section>
              )}
            </>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-emerald-950/10 bg-white shadow-[0_20px_60px_-35px_rgba(2,63,38,0.45)]">
              <div className="bg-[#023F26] px-5 py-5 text-white">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c4d701]">{km.attendance.currentProject}</p>
                <h2 className="mt-1 text-xl font-black">{km.attendance.chooseProject}</h2>
                <p className="mt-1 text-xs leading-5 text-emerald-50/75">{km.attendance.chooseProjectHint}</p>
              </div>
              <div className="space-y-2 p-4">
                {connectedProjects.length > 0 ? connectedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    disabled={actionLoading !== null}
                    onClick={() => void selectProject(project.id)}
                    className="group flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-left transition hover:border-emerald-700/30 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    <span className="text-sm font-extrabold text-slate-900">{project.name}</span>
                    <span className="grid size-8 place-items-center rounded-full bg-white text-sm font-black text-emerald-800 shadow-sm">→</span>
                  </button>
                )) : (
                  <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm leading-6 text-slate-500">{km.attendance.noConnectedProjects}</p>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
