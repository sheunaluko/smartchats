'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { logger } from 'smartchats-common';
import { ToastCard, type ToastStatus } from '../../app/ui/recipes/ToastCard';

const log = logger.get_logger({ id: "toast" });

type ToastArgs = {
  title?: string;
  description?: string;
  duration?: number;
  status?: ToastStatus;
  isClosable?: boolean;
};

declare var window: any;

export function toast_toast(args: ToastArgs) {
  if (typeof window != 'undefined') {
    let evt = new window.CustomEvent('toast', { detail: args });
    window.dispatchEvent(evt);
  }
}

type ToastItem = ToastArgs & { id: number };

let toastId = 0;

export default function Component() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    function do_toast(e: any) {
      const args = e.detail as ToastArgs;
      const id = ++toastId;
      setToasts(prev => [...prev, { ...args, id }]);

      if (args.duration !== 0) {
        setTimeout(() => removeToast(id), args.duration || 3000);
      }
    }

    if (typeof window != 'undefined') {
      window.addEventListener('toast', do_toast);
      log("Added toast event handler to window");
    }

    return () => {
      if (typeof window != 'undefined') {
        window.removeEventListener('toast', do_toast);
      }
    };
  }, [removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[9999] mx-auto flex max-w-sm flex-col gap-2" aria-live="polite" aria-atomic="true">
      {toasts.map(t => {
        const status = t.status || 'info';
        return (
          <ToastCard
            key={t.id}
            status={status}
            title={t.title}
            description={t.description}
            closable={t.isClosable !== false}
            onClose={() => removeToast(t.id)}
          />
        );
      })}
    </div>
  );
}
