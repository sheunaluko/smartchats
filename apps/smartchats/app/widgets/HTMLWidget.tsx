'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import HTML_Widget from '../HTMLWidget';
import { EmptyState, SurfacePanel } from '../ui/recipes';

interface HTMLWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  htmlDisplay: string;
}

const HTMLWidget: React.FC<HTMLWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  htmlDisplay
}) => {
  return (
    <WidgetItem
      title="HTML"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      {htmlDisplay ? (
        <SurfacePanel
          id="html_display"
          variant="tertiary"
          className="overflow-hidden"
          style={{ flexGrow: 1, minHeight: fullscreen ? '100%' : '95%' }}
        >
          <HTML_Widget to_display={htmlDisplay} />
        </SurfacePanel>
      ) : (
        <EmptyState
          title="No HTML content"
          description="Interactive HTML previews and form UIs will render here when the assistant generates them."
          className="m-3"
        />
      )}
    </WidgetItem>
  );
};

export default React.memo(HTMLWidget);
