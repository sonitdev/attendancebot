'use client';

import { useEffect, useState } from 'react';
import { formatCaptureTimestamp } from '@/lib/watermark';

/** Tick only this leaf, not the entire attendance page. */
export function CameraLiveClock({ timezone }: { timezone: string }) {
  const [time, setTime] = useState(() => formatCaptureTimestamp(new Date(), timezone));

  useEffect(() => {
    const update = () => setTime(formatCaptureTimestamp(new Date(), timezone));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  return <p className="data-font text-[11px] font-medium leading-tight text-white/95">{time}</p>;
}

