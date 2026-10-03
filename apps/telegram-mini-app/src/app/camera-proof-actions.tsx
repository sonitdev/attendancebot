'use client';

import { km } from '@workforce/contracts';
import type { CameraFacing } from '../lib/attendance-camera';

type CameraProofActionsProps = {
  onSwitch: (facing: CameraFacing) => void;
  disabled?: boolean;
};

export function CameraProofActions({ onSwitch, disabled }: CameraProofActionsProps) {

  return (
    <>
      <div>
        <div className="grid grid-cols-2 gap-2 px-4 pt-3">
          <button type="button" disabled={disabled} onClick={() => onSwitch('user')} className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-600 bg-emerald-50 py-3 text-xs font-black text-emerald-800 active:scale-[0.98]">
            <span>🤳</span> {km.attendance.selfieCamera}
          </button>
          <button type="button" disabled={disabled} onClick={() => onSwitch('environment')} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 py-3 text-xs font-black text-slate-800 active:scale-[0.98]">
            <span>🏢</span> {km.attendance.rearCamera}
          </button>
        </div>
        <p className="px-4 pt-1.5 text-center text-[10px] font-medium text-slate-400">{km.attendance.liveCameraOnly}</p>
      </div>
    </>
  );
}
