'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import { DataCard, EmptyState, InspectorSection } from '../ui/recipes';

interface LogWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  logHistory: string[];
}

const LogWidget: React.FC<LogWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  logHistory
}) => {

  return (
    <WidgetItem
      title="Log"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="log_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {logHistory.length === 0 ? (
          <EmptyState
            title="No logs yet"
            description="Runtime traces and internal debug lines will accumulate here during execution."
            className="m-3"
          />
        ) : (
          logHistory.map((log, index) => {
            const isError = log.indexOf('ERROR') > -1;

            return (
              <DataCard
                key={index}
                tone={isError ? 'danger' : 'primary'}
                className="mb-3"
                header={
                  <div className={`text-[0.68rem] font-semibold uppercase tracking-[0.14em] ${isError ? 'text-sc-danger' : 'text-sc-primary'}`}>
                    {isError ? 'Error Log' : 'Runtime Log'}
                  </div>
                }
              >
                <InspectorSection label="Entry" tone={isError ? 'danger' : 'primary'}>
                  <p className={`whitespace-pre-wrap break-words font-mono text-xs ${isError ? 'text-sc-danger' : 'text-sc-primary'}`}>
                    {log}
                  </p>
                </InspectorSection>
              </DataCard>
            );
          })
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(LogWidget);
