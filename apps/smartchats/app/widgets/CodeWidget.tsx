'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import Code_Widget from '../CodeWidget';
import { EmptyState, SurfacePanel } from '../ui/recipes';

interface CodeWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  codeParams: any;
  onChange: (params: any) => void;
}

const CodeWidget: React.FC<CodeWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  codeParams,
  onChange
}) => {
  return (
    <WidgetItem
      title="Code Display"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      {codeParams?.code ? (
        <SurfacePanel
          id="code_display"
          variant="tertiary"
          className="h-[95%] overflow-hidden"
        >
          <Code_Widget code_params={codeParams} onChange={onChange} />
        </SurfacePanel>
      ) : (
        <EmptyState
          title="No code loaded"
          description="Generated or edited source will appear here once the assistant prepares a code block."
          className="m-3"
        />
      )}
    </WidgetItem>
  );
};

export default React.memo(CodeWidget);
