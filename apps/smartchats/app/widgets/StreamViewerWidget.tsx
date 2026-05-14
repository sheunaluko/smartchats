'use client';

import React, { useEffect, useRef } from 'react';
import WidgetItem from '../WidgetItem';
import { EmptyState, InspectorSection, SurfacePanel } from '../ui/recipes';

interface StreamViewerWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  chunks: string[];
}

const StreamViewerWidget: React.FC<StreamViewerWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  chunks
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new chunks arrive
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chunks]);


  return (
    <WidgetItem
      title="Stream"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div ref={scrollContainerRef} className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {chunks.length === 0 ? (
          <EmptyState
            title="No stream data"
            description="Incremental model output chunks will be rendered here as they arrive."
            className="m-3"
          />
        ) : (
          <SurfacePanel variant="tertiary" className="m-3 p-4">
            <InspectorSection label="Live Stream">
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-sc-text-muted">
                {chunks.map((chunk, i) =>
                  chunk === '\n---\n' ? (
                    <span
                      key={i}
                      className="my-2 block border-b border-sc-border opacity-40"
                    />
                  ) : (
                    <span key={i}>{chunk}</span>
                  )
                )}
              </pre>
            </InspectorSection>
          </SurfacePanel>
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(StreamViewerWidget);
