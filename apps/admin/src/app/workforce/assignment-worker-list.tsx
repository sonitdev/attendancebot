'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { AssignmentListItem, EmployeeListItem } from '@workforce/contracts';

export function AssignmentWorkerList({
  assignmentGroups, employees, expandedEmployeeId, onToggle, detailsLabel,
}: {
  assignmentGroups: Record<string, AssignmentListItem[]>;
  employees: EmployeeListItem[];
  expandedEmployeeId: string | null;
  onToggle: (employeeId: string) => void;
  detailsLabel: string;
}) {
  if (Object.keys(assignmentGroups).length === 0) {
    return <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-xs text-slate-400">No shift assignments found.</div>;
  }
  return (
    <div className="space-y-3">
      {Object.entries(assignmentGroups).map(([employeeId, workerAssignments]) => {
        const worker = workerAssignments[0];
        const employee = employees.find((item) => item.id === employeeId);
        const isExpanded = expandedEmployeeId === employeeId;
        const activeCount = workerAssignments.filter((item) => item.status === 'ACTIVE').length;
        return (
          <article key={employeeId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            <button type="button" onClick={() => onToggle(employeeId)} aria-expanded={isExpanded} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50 sm:gap-4 sm:p-5">
              <div className="size-12 shrink-0 overflow-hidden rounded-full border-2 border-white bg-amber-300 shadow-sm sm:size-14">
                {employee?.avatarUrl ? <img src={employee.avatarUrl} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-lg font-extrabold text-white">{worker.employeeName.slice(0, 2).toUpperCase()}</span>}
              </div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-base font-extrabold text-slate-900">{worker.employeeName}</h3><span className="font-mono text-xs font-bold text-slate-400">{worker.employeeCode}</span></div><p className="mt-1 text-xs text-slate-500">{workerAssignments.length} project{workerAssignments.length === 1 ? '' : 's'} assigned{activeCount > 0 ? ` · ${activeCount} active` : ''}</p></div>
              <Link href={`/employees/${employeeId}`} onClick={(event) => event.stopPropagation()} className="rounded-full bg-[var(--portal-primary)]/10 px-2.5 py-1 text-[10px] font-bold text-[var(--portal-primary)] transition-colors hover:bg-[var(--portal-primary)] hover:text-white">{detailsLabel}</Link>
              <ChevronDown className={`size-5 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isExpanded && <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4"><p className="mb-2 px-1 text-[10px] font-extrabold uppercase text-slate-400">Project assignments</p><div className="space-y-2">{workerAssignments.map((assignment) => <div key={assignment.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"><div className="min-w-0"><p className="font-bold text-slate-900">{assignment.projectName}</p><p className="mt-0.5 truncate text-slate-500">{assignment.siteName} · {assignment.scheduleName}</p></div><span className="font-mono text-[11px] text-slate-500">{assignment.startsOn.slice(0, 10)} — {assignment.endsOn ? assignment.endsOn.slice(0, 10) : 'Ongoing'}</span><span className={assignment.status === 'ACTIVE' ? 'w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200' : 'w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600'}>{assignment.status}</span></div>)}</div></div>}
          </article>
        );
      })}
    </div>
  );
}
