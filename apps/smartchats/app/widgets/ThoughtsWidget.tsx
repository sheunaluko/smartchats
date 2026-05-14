'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import { DataCard, EmptyState, InspectorSection } from '../ui/recipes';

interface ThoughtsWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  thoughtHistory: string[];
}

const ThoughtsWidget: React.FC<ThoughtsWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  thoughtHistory
}) => {

  return (
    <WidgetItem
      title="Thoughts"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="thought_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {thoughtHistory.length === 0 ? (
          <EmptyState
            title="No thoughts yet"
            description="Reasoning traces and intermediate planning notes will appear here when available."
            className="m-3"
          />
        ) : (
          thoughtHistory.map((thought, index) => (
            <DataCard
              key={index}
              tone="success"
              className="mb-3"
              header={
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-sc-success">
                  Thought {index + 1}
                </div>
              }
            >
              <InspectorSection label="Reasoning" tone="success">
                <p className="whitespace-pre-wrap break-words text-sm text-sc-success">
                  {thought}
                </p>
              </InspectorSection>
            </DataCard>
          ))
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(ThoughtsWidget);
