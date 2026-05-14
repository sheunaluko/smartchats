'use client';

import React, { useId } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

type ModalSize = 'sm' | 'md' | 'lg';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  children: React.ReactNode;
};

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, title, description, size = 'md', children }: ModalProps) {
  const titleId = useId();
  const descriptionId = description ? `${titleId}-description` : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--sc-overlay)] backdrop-blur-[2px] animate-sc-fade-in" />
        <Dialog.Content
          aria-describedby={descriptionId}
          className={`surface-panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] ${sizeClasses[size]}
            -translate-x-1/2 -translate-y-1/2 rounded-[24px]
            shadow-[var(--sc-shadow-xl),var(--sc-surface-inset-highlight)] outline-none animate-sc-scale-in`}
        >
          {(title || description) && (
            <div className="surface-header flex items-start justify-between gap-4 px-6 py-5">
              <div className="min-w-0">
                {title && (
                  <Dialog.Title id={titleId} className="text-lg font-semibold tracking-tight text-sc-text">
                    {title}
                  </Dialog.Title>
                )}
                {description && (
                  <Dialog.Description id={descriptionId} className="mt-1 text-sm text-sc-text-muted">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close
                className="status-focused rounded-[10px] p-1.5 text-sc-text-muted transition-colors duration-sc-fast hover:bg-[var(--sc-default-hover)] hover:text-sc-text"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Dialog.Close>
            </div>
          )}
          <div className="px-6 py-5">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
