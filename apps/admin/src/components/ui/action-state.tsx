'use client';

import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react';
import { km } from '@workforce/contracts';
import { Modal } from './modal';

export type ActionFeedback =
  | { type: 'success' | 'error' | 'info'; message: string }
  | null;

export function NotificationToast({
  feedback,
  onDismiss,
  autoHideMs = 4500,
}: {
  feedback: ActionFeedback;
  onDismiss?: () => void;
  autoHideMs?: number;
}) {
  useEffect(() => {
    if (!feedback || !onDismiss || feedback.type === 'info') return;
    const timeout = window.setTimeout(onDismiss, autoHideMs);
    return () => window.clearTimeout(timeout);
  }, [autoHideMs, feedback, onDismiss]);

  if (!feedback) return null;
  const isError = feedback.type === 'error';
  const isSuccess = feedback.type === 'success';
  const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : Info;
  const tone = isError
    ? 'border-rose-200/80 bg-[#fff8f7] text-rose-950'
    : isSuccess
      ? 'border-emerald-200/80 bg-[#f5fbf7] text-emerald-950'
      : 'border-sky-200/80 bg-[#f5faff] text-sky-950';

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex justify-center sm:inset-x-auto sm:right-6 sm:left-auto sm:w-[min(420px,calc(100vw-2rem))]">
      <div role={isError ? 'alert' : 'status'} aria-live="polite" className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur-xl ${tone}`}>
        <span className="mt-0.5 rounded-full bg-white/80 p-1.5 shadow-sm"><Icon className="size-4" /></span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-6">{feedback.message}</p>
        {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="rounded-lg p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100"><X className="size-4" /></button>}
      </div>
    </div>
  );
}

export function ActionStatus({ feedback }: { feedback: ActionFeedback }) {
  if (!feedback) return null;
  const isError = feedback.type === 'error';
  const isSuccess = feedback.type === 'success';
  const Icon = isError ? AlertCircle : isSuccess ? CheckCircle2 : LoaderCircle;
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-bold ${
        isError
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : isSuccess
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-sky-200 bg-sky-50 text-sky-900'
      }`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${feedback.type === 'info' ? 'animate-spin' : ''}`} />
      <span>{feedback.message}</span>
    </div>
  );
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={open} onClose={pending ? () => undefined : onCancel} title={title} subtitle={description} maxWidth="md">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onCancel} disabled={pending} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-50">
          {km.actions.cancel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60 ${destructive ? 'bg-rose-700' : 'bg-[var(--portal-primary)] hover:brightness-90'}`}
        >
          {pending && <LoaderCircle className="size-4 animate-spin" />}
          {pending ? km.actions.processing : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function useUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isDirty]);
}
