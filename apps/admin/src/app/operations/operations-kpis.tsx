'use client';

import { Activity, AlertTriangle, CheckCircle2, UserCheck } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';

export function OperationsKpis({ isKm, total, present, completed, exceptions, onStatus }: {
  isKm: boolean;
  total: number;
  present: number;
  completed: number;
  exceptions: number;
  onStatus: (status: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      <KpiCard label={isKm ? 'វត្តមាន Check In ថ្ងៃនេះ' : 'Total Checked In'} value={total} tone="blue" detail={isKm ? 'កំណត់ត្រាវត្តមាន Check In ថ្ងៃនេះ' : 'Check-in records today'} icon={UserCheck} />
      <KpiCard label={isKm ? 'កំពុងបំពេញការងារ' : 'Currently On Site'} value={present} tone="green" detail={isKm ? 'វេនការងារកំពុងដំណើរការ' : 'Open active shifts'} icon={Activity} onClick={() => onStatus('PRESENT')} />
      <KpiCard label={isKm ? 'បញ្ចប់វេនការងារ' : 'Completed Shifts'} value={completed} tone="neutral" detail={isKm ? 'បាន Check Out រួចរាល់' : 'Checked out with duration'} icon={CheckCircle2} onClick={() => onStatus('COMPLETED')} />
      <KpiCard label={isKm ? 'ករណីត្រូវពិនិត្យ' : 'Exceptions / Flagged'} value={exceptions} tone={exceptions > 0 ? 'warning' : 'neutral'} detail={isKm ? 'មកយឺត ចេញមុន ឬក្រៅទីតាំង' : 'Late, Early, or Outside'} icon={AlertTriangle} onClick={() => onStatus('EXCEPTIONS')} />
    </div>
  );
}
