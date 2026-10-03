'use client';

import React from 'react';

type Step = {
  step: number;
  title: string;
  detail: string;
};

const steps: Step[] = [
  {
    step: 1,
    title: 'Invite-only provisioning',
    detail: 'Platform operators and HR provision your account. Self-registration is restricted.',
  },
  {
    step: 2,
    title: 'Corporate identity verification',
    detail: 'Authenticate with your verified management credentials or single sign-on.',
  },
  {
    step: 3,
    title: 'Audited site governance',
    detail: 'Access real-time site attendance, GPS geofences, and workforce audit timelines.',
  },
];

/**
 * Tossana Brand & Instruction Rail. Presents authentication protocol in a vertical
 * stepper progress timeline with dashed connector lines.
 */
export function BrandRail() {
  return (
    <div className="relative isolate hidden overflow-hidden rounded-[28px] p-7 text-white lg:flex lg:flex-col lg:justify-center lg:gap-6 lg:p-8 bg-[#023F26] shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.4),0_20px_60px_-12px_rgba(1,43,26,0.3)]">
      {/* Ambient background lighting gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[#012919] via-[#023F26] to-[#035936]"
      />

      {/* Top headline */}
      <div>
        <h2 className="text-2xl font-bold leading-tight text-white drop-shadow-sm">
          A calmer way to run your workforce platform.
        </h2>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-white/80">
          One unified console for site attendance, geofences, assignments, and workforce governance.
        </p>
      </div>

      {/* Stepper progress timeline with dashed connector lines 1, 2, 3 */}
      <div className="mt-4">
        <p className="mb-4 text-[11px] font-bold uppercase text-[#c4d701]">
          Sign-in protocol
        </p>
        <div className="flex flex-col">
          {steps.map(({ step, title, detail }, index) => {
            const isLast = index === steps.length - 1;
            return (
              <div key={step} className="relative flex gap-4">
                {/* Vertical dashed line indicator */}
                <div className="flex flex-col items-center">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-xs font-bold text-white shadow-xs backdrop-blur-md">
                    {step}
                  </div>
                  {!isLast ? (
                    <div className="my-1 w-0 flex-1 border-l-2 border-dashed border-white/30 min-h-[34px]" />
                  ) : null}
                </div>

                {/* Step content */}
                <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                  <p className="text-xs font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-white/75">{detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
