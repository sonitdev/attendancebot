'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { km, type TelegramSessionResponse, type WorkerTodayResponse } from '@workforce/contracts';
import { api, ApiError } from '@/lib/api';
import { formatStatus } from '@/lib/format';

export default function WorkerHomePage() {
  const [session, setSession] = useState<TelegramSessionResponse | null>(null);
  const [todayData, setTodayData] = useState<WorkerTodayResponse | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!cameraOpen || proofPhoto) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        cameraStream.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setFeedback({ type: 'error', text: 'សូមអនុញ្ញាតកាមេរ៉ា ដើម្បីថតរូបភស្តុតាង។' }));
    return () => {
      cameraStream.current?.getTracks().forEach((track) => track.stop());
      cameraStream.current = null;
    };
  }, [cameraOpen, proofPhoto]);

  useLayoutEffect(() => {
    if (loading || !stageRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(stageRef.current?.children ?? [], { autoAlpha: 0, y: 14 }, {
        autoAlpha: 1, y: 0, duration: 0.42, ease: 'power3.out', stagger: 0.05,
        clearProps: 'transform,opacity,visibility',
      });
    }, stageRef);
    return () => context.revert();
  }, [loading]);

  function saveSession(sess: TelegramSessionResponse) {
    setSession(sess);
    try {
      localStorage.setItem('workforce_worker_session', JSON.stringify(sess));
    } catch {}
  }

  function saveToday(today: WorkerTodayResponse | null) {
    setTodayData(today);
    if (today) {
      try {
        localStorage.setItem('workforce_worker_today', JSON.stringify(today));
      } catch {}
    }
  }

  // Initialize Telegram WebApp with zero-latency caching and SSR hydration safety
  useEffect(() => {
    let activeToken: string | undefined;

    // 1. Synchronously restore cached session & shift data on mount (prevents SSR hydration mismatch)
    try {
      const cachedSess = localStorage.getItem('workforce_worker_session');
      if (cachedSess) {
        const parsedSess = JSON.parse(cachedSess);
        setSession(parsedSess);
        activeToken = parsedSess.token;
        setLoading(false);
      }
      const cachedToday = localStorage.getItem('workforce_worker_today');
      if (cachedToday) {
        setTodayData(JSON.parse(cachedToday));
      }
    } catch {}

    async function initSession() {
      const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
      if (webApp) {
        try {
          webApp.ready();
          webApp.expand();
        } catch {}
      }

      const initData = webApp?.initData;

      try {
        if (initData) {
          const sess = await api.createSession(initData);
          saveSession(sess);
          activeToken = sess.token;
        } else {
          const savedToken = sessionStorage.getItem('dev_worker_token');
          if (savedToken) {
            const parsedSession = JSON.parse(sessionStorage.getItem('dev_worker_session') || '{}');
            setSession(parsedSession);
            activeToken = savedToken;
          }
        }

        if (activeToken) {
          await loadToday(activeToken);
        } else if (!session) {
          setLoading(false);
        }
      } catch (err: any) {
        if (
          err.code === 'REGISTRATION_PENDING' ||
          err.message?.includes('REGISTRATION_PENDING')
        ) {
          setFeedback({
            type: 'info',
            text: '⏳ Your account is under review by the admin site or your manager. Please wait for an administrator to approve your registration request.',
          });
        } else if (
          err.code === 'TELEGRAM_UNLINKED' ||
          err.message?.includes('TELEGRAM_UNLINKED')
        ) {
          setFeedback({
            type: 'info',
            text: '📱 Your Telegram account is not linked to a worker profile yet. Please send /start or share your phone number in the bot chat (@site_attendantbot) to register!',
          });
        } else if (!session) {
          setFeedback({ type: 'error', text: err.message || 'Authentication failed.' });
        }
        setLoading(false);
      }
    }

    initSession();
  }, []);

  async function loadToday(token: string) {
    try {
      const today = await api.getToday(token).catch(() => null);
      if (today) saveToday(today);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'NO_VALID_ASSIGNMENT') {
        setFeedback({ type: 'info', text: 'You have no scheduled work assignment for today.' });
      } else if (!session) {
        setFeedback({ type: 'error', text: err.message || 'Failed to retrieve schedule.' });
      }
    } finally {
      setLoading(false);
    }
  }

  // Authoritative GPS Check-in / Check-out flow
  async function handleAttendanceAction(action: 'CHECK_IN' | 'CHECK_OUT', proofPhotoDataUrl?: string) {
    if (!session?.token) return;
    setFeedback(null);

    if (!navigator.geolocation) {
      setFeedback({ type: 'error', text: 'Geolocation is not supported by your device.' });
      return;
    }

    setActionLoading('កំពុងទទួលទីតាំង GPS…');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setActionLoading('កំពុងផ្ទៀងផ្ទាត់ និងបញ្ជូនវត្តមាន…');
          const idempotencyKey = crypto.randomUUID();

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

          const result =
            action === 'CHECK_IN'
              ? await api.checkIn(session.token, { ...locationInput, proofPhotoDataUrl: proofPhotoDataUrl! }, idempotencyKey)
              : await api.checkOut(session.token, locationInput, idempotencyKey);

          // Trigger Telegram Haptic Feedback if available
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred(
              result.verificationResult === 'VERIFIED' ? 'success' : 'warning',
            );
          }

          setFeedback({
            type: result.verificationResult === 'VERIFIED' ? 'success' : 'info',
            text: `${result.message} (${result.distanceMeters}m from site)`,
          });

          // Refresh today's attendance record
          await loadToday(session.token);
        } catch (err: any) {
          setFeedback({
            type: 'error',
            text: err.message || 'Attendance request failed. Please try again.',
          });
        } finally {
          setActionLoading(null);
        }
      },
      (geoErr) => {
        setActionLoading(null);
        let msg = 'Could not access location.';
        if (geoErr.code === 1) msg = km.attendance.locationRequired;
        if (geoErr.code === 2) msg = 'មិនអាចរកទីតាំងបានទេ។ សូមបើក GPS រួចសាកល្បងម្ដងទៀត។';
        if (geoErr.code === 3) msg = 'ការស្នើទីតាំងអស់ពេល។ សូមសាកល្បងម្ដងទៀត។';
        setFeedback({ type: 'error', text: msg });
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      },
    );
  }

  function captureProofPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setProofPhoto(canvas.toDataURL('image/jpeg', 0.82));
  }

  async function handleSimulateDevLogin() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5131/api/v1'}/health`);
      if (!res.ok) throw new Error('API server is offline.');

      setFeedback({
        type: 'info',
        text: 'To test in browser: Open this WebApp inside Telegram (@site_attendantbot) or configure valid initData.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-zinc-600">{km.app.loading}</p>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="motion-stage flex-1 flex flex-col p-4 max-w-md mx-auto w-full">
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
                Unassigned Position
              </span>
            )}
          </div>
        </header>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 mb-4 space-y-2">
          <p className="font-semibold">Telegram WebApp Not Detected</p>
          <p>This application is designed to be opened from inside Telegram (@site_attendantbot).</p>
          <button
            onClick={handleSimulateDevLogin}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-medium text-xs shadow-sm hover:bg-amber-700"
          >
            Check API Status
          </button>
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
          {todayData ? (
            <>
              {/* Assignment & Site Card */}
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-200 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                  <div>
                    <span className="text-[10px] font-bold tracking-wide text-blue-600">
                      ការដ្ឋានដែលបានចាត់តាំង
                    </span>
                    <h2 className="text-base font-bold text-zinc-900">{todayData.site.name}</h2>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700">
                    ចម្ងាយអនុញ្ញាត៖ {todayData.site.allowedRadiusMeters}m
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-400">Shift Schedule:</span>
                    <p className="font-semibold text-zinc-800">
                      {todayData.schedule.startTime} - {todayData.schedule.endTime}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Timezone:</span>
                    <p className="font-semibold text-zinc-800">{todayData.siteTimezone}</p>
                  </div>
                </div>
              </div>

              {/* Attendance Status Card */}
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-zinc-200 space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-700">ស្ថានភាពវត្តមានថ្ងៃនេះ</span>
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
                      <span className="text-zinc-400">{km.attendance.checkIn}៖</span>
                      <p className="font-bold text-zinc-800">
                        {todayData.attendance.checkInAt
                          ? new Date(todayData.attendance.checkInAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">{km.attendance.checkOut}៖</span>
                      <p className="font-bold text-zinc-800">
                        {todayData.attendance.checkOutAt
                          ? new Date(todayData.attendance.checkOutAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
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
                      <span>{km.attendance.checkOut}</span>
                    )}
                  </button>
                ) : (
                  <button
                    disabled={actionLoading !== null}
                    onClick={() => {
                      setProofPhoto(null);
                      setCameraOpen(true);
                    }}
                    className="w-full min-h-[52px] py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base shadow-md transition-all flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm">{actionLoading}</span>
                      </>
                    ) : (
                      <span>{km.attendance.checkIn}</span>
                    )}
                  </button>
                )}
              </div>

              {cameraOpen && (
                <section className="fixed inset-0 z-50 flex items-end bg-slate-950/70 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true">
                  <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between p-4">
                      <div><p className="text-sm font-extrabold text-slate-900">ថតរូបភស្តុតាង</p><p className="text-xs text-slate-500">សូមបង្ហាញមុខ និងការដ្ឋានឱ្យច្បាស់</p></div>
                      <button onClick={() => setCameraOpen(false)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">បិទ</button>
                    </div>
                    <div className="mx-4 aspect-[4/3] overflow-hidden rounded-2xl bg-slate-900">
                      {proofPhoto ? <img src={proofPhoto} alt="រូបភស្តុតាង" className="size-full object-cover" /> : <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />}
                    </div>
                    <div className="flex gap-2 p-4">
                      {proofPhoto ? <button onClick={() => setProofPhoto(null)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700">ថតម្ដងទៀត</button> : <button onClick={captureProofPhoto} className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white">ថតរូប</button>}
                      {proofPhoto && <button onClick={() => { setCameraOpen(false); handleAttendanceAction('CHECK_IN', proofPhoto); }} className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white">ចូលការជាមួយរូប</button>}
                    </div>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl p-6 text-center border border-zinc-200 text-zinc-500 text-sm space-y-2">
              <p>{km.attendance.noAssignment}</p>
              <p className="text-xs text-zinc-400">សូមទាក់ទងអ្នកគ្រប់គ្រងការដ្ឋាន ឬផ្នែកធនធានមនុស្ស។</p>
            </div>
          )}
      </div>
    </div>
  );
}
