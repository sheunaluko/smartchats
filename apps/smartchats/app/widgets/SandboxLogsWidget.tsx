'use client';

import React from 'react';
import { ObjectInspector } from 'react-inspector';
import { AlertCircle, AlertTriangle, Info, Terminal } from 'lucide-react';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { useDesignPack } from '../../core/DesignPackContext';
import { DataCard, EmptyState, InspectorSection } from '../ui/recipes';

interface SandboxLog {
  level: 'log' | 'error' | 'warn' | 'info';
  args: any[];
  timestamp: number;
}

interface SandboxLogsWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  logs: SandboxLog[];
}

const SandboxLogsWidget: React.FC<SandboxLogsWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  logs = []
}) => {

  const { pack } = useDesignPack();
  const inspectorTheme = pack.mode === 'dark' ? 'chromeDark' : 'chromeLight';

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'error': return { bg: 'bg-sc-danger/15', text: 'text-sc-danger', chipVariant: 'danger' as const, Icon: AlertCircle };
      case 'warn': return { bg: 'bg-sc-warning/15', text: 'text-sc-warning', chipVariant: 'warning' as const, Icon: AlertTriangle };
      case 'info': return { bg: 'bg-sc-primary/15', text: 'text-sc-primary', chipVariant: 'primary' as const, Icon: Info };
      default: return { bg: 'bg-sc-surface-alt', text: 'text-sc-text', chipVariant: 'default' as const, Icon: Terminal };
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

  const formatLogArg = (arg: any) => {
    // If it's a simple string or number, display directly
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
      return String(arg);
    }

    // For objects, use ObjectInspector
    return null;
  };

  return (
    <WidgetItem
      title="Sandbox Logs"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="sandbox_logs_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {logs.length === 0 ? (
          <EmptyState title="No logs yet" description="Sandbox stdout, stderr, and structured values will stream into this panel during execution." className="m-3" />
        ) : (
          logs.map((log, index) => {
            const style = getLevelStyle(log.level);

            return (
              <DataCard
                key={index}
                tone={style.chipVariant}
                className="mb-3 font-mono text-sm"
                header={
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <style.Icon size={14} className={style.text} />
                    <Chip
                      label={log.level.toUpperCase()}
                      size="sm"
                      variant={style.chipVariant}
                      className="font-bold text-[0.65rem]"
                    />
                    <span className="text-xs text-sc-text-muted">
                      {formatTime(log.timestamp)}
                    </span>
                  </div>
                }
              >
                <InspectorSection label="Payload" tone={style.chipVariant}>
                  {log.args.map((arg, argIndex) => {
                    const simpleValue = formatLogArg(arg);

                    return (
                      <div key={argIndex} className={argIndex < log.args.length - 1 ? 'mb-1' : ''}>
                        {simpleValue !== null ? (
                          <span className="font-mono text-sm">
                            {simpleValue}
                            {argIndex < log.args.length - 1 && ' '}
                          </span>
                        ) : (
                          <div className="mt-1">
                            <ObjectInspector
                              theme={inspectorTheme}
                              data={arg}
                              expandLevel={1}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </InspectorSection>
              </DataCard>
            );
          })
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(SandboxLogsWidget);
