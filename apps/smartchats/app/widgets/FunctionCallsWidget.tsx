'use client';

import React, { useRef, useEffect } from 'react';
import { ObjectInspector } from 'react-inspector';
import { CheckCircle, AlertCircle } from 'lucide-react';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { useDesignPack } from '../../core/DesignPackContext';
import { DataCard, EmptyState, InspectorSection, MetricRow } from '../ui/recipes';

interface FunctionCallEvent {
  name: string;
  args: any[];
  result?: any;
  duration?: number;
  error?: string;
  timestamp: number;
  callId: string;
  status?: 'running' | 'success' | 'error';
}

interface FunctionCallsWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  calls: FunctionCallEvent[];
}

const FunctionCallsWidget: React.FC<FunctionCallsWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  calls = []
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { pack } = useDesignPack();
  const inspectorTheme = pack.mode === 'dark' ? 'chromeDark' : 'chromeLight';

  // Auto-scroll to bottom when calls change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [calls]);


  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'running':
        return (
          <div className="w-4 h-4 border-2 border-sc-primary border-t-transparent rounded-full animate-spin" />
        );
      case 'success':
        return <CheckCircle size={16} className="text-sc-success" />;
      case 'error':
        return <AlertCircle size={16} className="text-sc-danger" />;
      default:
        return null;
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <WidgetItem
      title="Function Calls"
      fullscreen={fullscreen}
      onFocus={onFocus}
        onClose={onClose}
    >
      <div id="function_calls_display" ref={scrollContainerRef} className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {calls.length === 0 ? (
          <EmptyState title="No function calls yet" description="Tool invocations will appear here once the assistant starts executing actions." className="m-3" />
        ) : (
          calls.map((call, index) => (
            <DataCard
              key={call.callId}
              tone={call.status === 'error' ? 'danger' : call.status === 'success' ? 'success' : call.status === 'running' ? 'primary' : 'default'}
              className="mb-4"
              header={
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <div className="mt-0.5 shrink-0">{getStatusIcon(call.status)}</div>
                  <div className="min-w-0">
                    <h4
                      className={`truncate text-sm font-semibold font-mono
                        ${call.status === 'error' ? 'text-sc-danger' : 'text-sc-primary'}`}
                    >
                      {call.name}
                    </h4>
                    <p className="mt-1 text-xs text-sc-text-muted">
                      {formatTime(call.timestamp)}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  label={`#${index + 1}`}
                  size="sm"
                  variant="default"
                />
                {call.duration !== undefined && (
                  <Chip
                    label={`${call.duration}ms`}
                    size="sm"
                    variant="success"
                  />
                )}
              </div>

              <div className="space-y-2">
                <MetricRow label="Status" value={call.status || 'queued'} tone={call.status === 'error' ? 'danger' : call.status === 'success' ? 'success' : call.status === 'running' ? 'primary' : 'default'} />
                <MetricRow label="Arguments" value={call.args.length} />
              </div>

              <InspectorSection label="Parameters">
                <ObjectInspector
                  theme={inspectorTheme}
                  data={call.args.length <= 1 ? (call.args[0] || {}) : call.args}
                  expandLevel={1}
                />
              </InspectorSection>

              {call.result !== undefined && !call.error && (
                <InspectorSection label="Result" tone="success">
                  <ObjectInspector
                    theme={inspectorTheme}
                    data={call.result}
                    expandLevel={1}
                  />
                </InspectorSection>
              )}

              {call.error && (
                <InspectorSection label="Error" tone="danger">
                  <div className="rounded-[12px] border border-sc-danger/30 bg-sc-danger/10 p-3 font-mono text-xs text-sc-danger">
                    {call.error}
                  </div>
                </InspectorSection>
              )}
            </DataCard>
          ))
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(FunctionCallsWidget);
