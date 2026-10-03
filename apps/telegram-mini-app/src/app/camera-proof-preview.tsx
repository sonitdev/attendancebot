'use client';

import type { RefCallback } from 'react';
import { CameraLiveClock } from './camera-live-clock';

type CameraProofPreviewProps = {
  proofPhoto: string | null;
  proofPhotoAlt: string;
  proofPhotoTitle: string;
  cameraReady: boolean;
  cameraUnavailable: boolean;
  cameraStarting: string;
  cameraFallbackHint: string;
  timezone: string;
  workerName?: string | null;
  locationName?: string | null;
  videoRef: RefCallback<HTMLVideoElement>;
};

export function CameraProofPreview({
  proofPhoto,
  proofPhotoAlt,
  proofPhotoTitle,
  cameraReady,
  cameraUnavailable,
  cameraStarting,
  cameraFallbackHint,
  timezone,
  workerName,
  locationName,
  videoRef,
}: CameraProofPreviewProps) {
  return (
    <div className="relative mx-4 mt-4 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-inner">
      {proofPhoto ? (
        <div className="relative size-full">
          <img src={proofPhoto} alt={proofPhotoAlt} className="size-full object-cover" />
        </div>
      ) : (
        <div className="relative size-full">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="size-full object-cover"
          />
          {cameraReady && (
            <div className="absolute inset-x-0 bottom-0 bg-[#121619]/80 px-4 py-2.5 text-left text-white backdrop-blur-[2px]">
              <div className="space-y-0.5 font-['Roboto_Flex','Kantumruy_Pro',sans-serif] text-[11px] font-medium leading-tight text-white/95">
                {workerName && <p className="truncate">{workerName}</p>}
                <CameraLiveClock timezone={timezone} />
                {locationName && <p className="truncate">{locationName}</p>}
              </div>
            </div>
          )}
          {!cameraReady && !cameraUnavailable && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950 text-sm font-medium text-white">
              <div className="space-y-2 text-center">
                <div className="mx-auto size-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                <p className="text-xs text-slate-300">{cameraStarting}</p>
              </div>
            </div>
          )}
          {cameraUnavailable && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-white">
              <svg
                className="mb-2 size-8 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              <p className="text-sm font-semibold">{proofPhotoTitle}</p>
              <p className="mt-1 text-xs text-slate-400">{cameraFallbackHint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
