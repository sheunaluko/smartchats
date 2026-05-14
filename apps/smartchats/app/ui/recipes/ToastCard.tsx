'use client';

import React from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastStatus = 'success' | 'error' | 'info' | 'warning';

type ToastCardProps = {
  status: ToastStatus;
  title?: string;
  description?: string;
  onClose?: () => void;
  closable?: boolean;
};

const statusIcon: Record<ToastStatus, React.ReactNode> = {
  success: <CheckCircle size={16} />,
  error: <AlertCircle size={16} />,
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
};

const statusClasses: Record<ToastStatus, string> = {
  success: 'border-sc-success/30 text-sc-success',
  error: 'border-sc-danger/30 text-sc-danger',
  info: 'border-sc-primary/30 text-sc-primary',
  warning: 'border-sc-warning/30 text-sc-warning',
};

export function ToastCard({ status, title, description, onClose, closable = true }: ToastCardProps) {
  return (
    <div
      className={`animate-sc-slide-in-right flex items-start gap-3 rounded-sc border bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sc-surface)_96%,white_4%),var(--sc-surface))]
        px-4 py-3 shadow-sc-lg backdrop-blur-sm ${statusClasses[status]}`}
    >
      <span className="mt-0.5 shrink-0">{statusIcon[status]}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-medium text-sc-text">{title}</p>}
        {description && <p className="mt-0.5 text-xs text-sc-text-muted">{description}</p>}
      </div>
      {closable && onClose && (
        <button
          onClick={onClose}
          className="rounded-sc-sm p-1 text-sc-text-muted transition-colors duration-sc-fast hover:bg-sc-surface-alt hover:text-sc-text"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
