'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { DataCard } from '../ui/recipes/DataCard';
import HTML_Widget from '../HTMLWidget';

type HTMLViewerProps = {
  htmlDisplay: string;
  onDismiss: () => void;
};

export function HTMLViewer({ htmlDisplay, onDismiss }: HTMLViewerProps) {
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(onDismiss, 400);
    return () => clearTimeout(timer);
  }, [exiting, onDismiss]);

  // Don't render for app placeholder — apps render via AppContainer
  if (htmlDisplay === '__app__') return null;

  return (
    <div
      className={`relative ${exiting ? 'animate-sc-viz-out' : 'animate-sc-scale-in'}`}
      style={exiting ? { animationFillMode: 'forwards' } : undefined}
    >
      <DataCard>
        <button
          onClick={handleDismiss}
          className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full text-sc-text-muted transition-colors duration-sc-fast hover:bg-sc-surface-secondary hover:text-sc-text"
          aria-label="Dismiss HTML"
        >
          <X size={12} />
        </button>
        <div style={{ minHeight: 200 }}>
          <HTML_Widget to_display={htmlDisplay} />
        </div>
      </DataCard>
    </div>
  );
}
