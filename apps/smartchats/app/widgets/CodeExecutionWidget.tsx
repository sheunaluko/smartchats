'use client';

import React from 'react';
import { ObjectInspector } from 'react-inspector';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { useDesignPack } from '../../core/DesignPackContext';
import { DataCard, EmptyState, InspectorSection, MetricRow, SurfacePanel } from '../ui/recipes';
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/theme-kuroir";
import "ace-builds/src-noconflict/theme-solarized_dark";
import "ace-builds/src-noconflict/theme-solarized_light";

interface CodeExecutionWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  currentCode?: string;
  executionId?: string;
  status?: 'idle' | 'running' | 'success' | 'error';
  error?: string;
  duration?: number;
  result?: any;
}

const CodeExecutionWidget: React.FC<CodeExecutionWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  currentCode = '',
  executionId = '',
  status = 'idle',
  error = '',
  duration = 0,
  result
}) => {

  const { pack } = useDesignPack();
  const inspectorTheme = pack.mode === 'dark' ? 'chromeDark' : 'chromeLight';
  const aceTheme = pack.mode === 'dark' ? 'solarized_dark' : 'solarized_light';

  const getStatusVariant = (): 'default' | 'primary' | 'success' | 'danger' => {
    switch (status) {
      case 'running': return 'primary';
      case 'success': return 'success';
      case 'error': return 'danger';
      default: return 'default';
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'running': return 'Running...';
      case 'success': return `Success (${duration}ms)`;
      case 'error': return 'Error';
      default: return 'Idle';
    }
  };

  return (
    <WidgetItem
      title="Code Execution"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="code_execution_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        <DataCard
          tone={status === 'error' ? 'danger' : status === 'success' ? 'success' : status === 'running' ? 'primary' : 'default'}
          className="mb-3"
          header={
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                label={getStatusLabel()}
                variant={getStatusVariant()}
                size="sm"
              />
              {executionId && (
                <Chip
                  label={`ID: ${executionId.slice(-8)}`}
                  size="sm"
                  variant="default"
                />
              )}
            </div>
          }
        >
          <MetricRow label="Execution" value={status} tone={status === 'error' ? 'danger' : status === 'success' ? 'success' : status === 'running' ? 'primary' : 'default'} />
          {duration > 0 && <MetricRow label="Duration" value={`${duration}ms`} />}

          <InspectorSection label="Result">
            {result !== undefined ? (
              <ObjectInspector
                data={result}
                expandLevel={0}
                theme={inspectorTheme}
              />
            ) : (
              <span className="text-xs text-sc-text-muted">No result yet</span>
            )}
          </InspectorSection>
        </DataCard>

        {currentCode ? (
          <SurfacePanel variant="tertiary" className="overflow-hidden">
            <AceEditor
              mode="javascript"
              theme={aceTheme}
              value={currentCode}
              readOnly={true}
              width="100%"
              height="400px"
              fontSize={16}
              showPrintMargin={false}
              showGutter={true}
              highlightActiveLine={false}
              setOptions={{
                useWorker: false,
                wrap: true,
                showLineNumbers: true,
                tabSize: 2,
              }}
            />
          </SurfacePanel>
        ) : (
          <EmptyState title="No code executing" description="When the assistant runs generated code, the active source and output will appear here." className="m-1" />
        )}

        {error && (
          <DataCard tone="danger" className="mt-4">
            <InspectorSection label="Execution Error" tone="danger">
              <div className="font-mono text-sm text-sc-danger">
                {error}
              </div>
            </InspectorSection>
          </DataCard>
        )}

      </div>
    </WidgetItem>
  );
};

export default React.memo(CodeExecutionWidget);
