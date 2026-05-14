'use client';

import React from 'react';
import { ObjectInspector } from 'react-inspector';
import WidgetItem from '../WidgetItem';
import { useDesignPack } from '../../core/DesignPackContext';
import { EmptyState, InspectorSection, SurfacePanel } from '../ui/recipes';

interface WorkspaceWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  workspace: any;
}

const WorkspaceWidget: React.FC<WorkspaceWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  workspace
}) => {
  const { pack } = useDesignPack();
  const inspectorTheme = pack.mode === 'dark' ? 'chromeDark' : 'chromeLight';

  return (
    <WidgetItem
      title="Workspace"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="workspace_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {workspace && Object.keys(workspace).length > 0 ? (
          <SurfacePanel variant="tertiary" className="m-3 p-4">
            <InspectorSection label="Workspace State">
              <ObjectInspector
                style={{ width: '100%' }}
                theme={inspectorTheme}
                data={workspace}
                expandLevel={2}
              />
            </InspectorSection>
          </SurfacePanel>
        ) : (
          <EmptyState
            title="Workspace is empty"
            description="Structured values saved from tools and HTML interactions will appear here."
            className="m-3"
          />
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(WorkspaceWidget);
