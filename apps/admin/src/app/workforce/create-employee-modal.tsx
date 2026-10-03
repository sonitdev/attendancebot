'use client';

import { AlertCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/ui/modal';

export function CreateEmployeeModal({ isOpen, formError, isSubmitting, empCode, empName, empPhone, empTitle, onClose, onSubmit, onEmpCode, onEmpName, onEmpPhone, onEmpTitle }: {
  isOpen: boolean; formError: string | null; isSubmitting: boolean; empCode: string; empName: string; empPhone: string; empTitle: string;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onEmpCode: (value: string) => void; onEmpName: (value: string) => void; onEmpPhone: (value: string) => void; onEmpTitle: (value: string) => void;
}) {
  return <Modal isOpen={isOpen} onClose={onClose} title="Add New Worker" subtitle="Register an employee record in the organization directory." maxWidth="md">
    {formError && <div className="mb-3 flex items-center space-x-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" /><span>{formError}</span></div>}
    <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
      <label className="block font-medium text-slate-700">Employee Code *<input required type="text" placeholder="e.g. EMP-101" value={empCode} onChange={(event) => onEmpCode(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 font-mono" /></label>
      <label className="block font-medium text-slate-700">Full Name *<input required type="text" placeholder="e.g. John Doe" value={empName} onChange={(event) => onEmpName(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" /></label>
      <label className="block font-medium text-slate-700">Phone Number (Optional)<input type="text" placeholder="e.g. +855977429389" value={empPhone} onChange={(event) => onEmpPhone(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 font-mono" /></label>
      <label className="block font-medium text-slate-700">Job Title (Optional)<input type="text" placeholder="e.g. Senior Electrician" value={empTitle} onChange={(event) => onEmpTitle(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2" /></label>
      <div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onClose} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50">Cancel</button><button type="submit" disabled={isSubmitting} className="cursor-pointer rounded-xl bg-[var(--portal-primary)] px-4 py-2 text-xs font-bold text-white shadow-2xs transition-all hover:brightness-90 active:scale-95">{isSubmitting ? 'Saving...' : 'Save Employee'}</button></div>
    </form>
  </Modal>;
}
