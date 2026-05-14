'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  anchor?: 'left' | 'right';
  width?: number;
  title?: string;
  children: React.ReactNode;
};

export function Drawer({
  open,
  onClose,
  anchor = 'right',
  width = 350,
  title = 'Panel',
  children,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--sc-overlay)] backdrop-blur-[2px] animate-sc-fade-in" />
        <Dialog.Content
          className={`surface-panel fixed top-0 z-50 h-full overflow-y-auto rounded-none p-6
            shadow-[var(--sc-shadow-xl),var(--sc-surface-inset-highlight)] outline-none animate-sc-fade-in
            ${anchor === 'right' ? 'right-0 rounded-l-[24px] border-l' : 'left-0 rounded-r-[24px] border-r'}`}
          style={{ width, overscrollBehavior: 'contain' }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
