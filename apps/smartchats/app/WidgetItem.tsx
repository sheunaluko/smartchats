'use client';

import React from 'react';
import { X, Maximize2, GripVertical } from 'lucide-react';
import { PanelHeader, SurfacePanel } from './ui/recipes';

interface WidgetItemProps {
  title: string;
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  children: React.ReactNode;
  sx?: any;
  controls?: React.ReactNode;
}

const WidgetItem: React.FC<WidgetItemProps> = ({
  title,
  fullscreen = false,
  onFocus,
  onClose,
  children,
  controls,
}) => {
  return (
    <SurfacePanel className="h-full w-full overflow-hidden flex flex-col" interactive style={{ minHeight: '100%', flexGrow: 1 }}>
      <PanelHeader
        title={title}
        leading={<GripVertical size={13} className="widget-drag-handle cursor-move text-sc-text-muted/38" />}
        controls={controls}
        action={fullscreen ? (
          <button
            onClick={onClose}
            aria-label="Close fullscreen"
            className="status-focused rounded-[10px] p-1.5 text-sc-text-muted transition-colors duration-sc-fast hover:bg-[var(--sc-default-hover)] hover:text-sc-text"
          >
            <X size={15} />
          </button>
        ) : (
          <button
            onClick={onFocus}
            aria-label="Expand widget"
            className="status-focused rounded-[10px] p-1.5 text-sc-text-muted/55 transition-colors duration-sc-fast hover:bg-[var(--sc-default-hover)] hover:text-sc-text-muted"
          >
            <Maximize2 size={14} />
          </button>
        )}
      />

      <div className="min-h-0 flex-grow flex flex-col overflow-y-auto px-4 pb-4 pt-3.5 scrollbar-thin">{children}</div>
    </SurfacePanel>
  );
};

export default WidgetItem;
