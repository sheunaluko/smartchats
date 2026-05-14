'use client';

import React, { useMemo } from 'react';
import { ObjectInspector } from 'react-inspector';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { useDesignPack } from '../../core/DesignPackContext';
import { DataCard, EmptyState, InspectorSection, MetricRow } from '../ui/recipes';

interface VariableAssignment {
  name: string;
  value: any;
  timestamp: number;
}

interface VariableInspectorWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  variables: VariableAssignment[];
}

const VariableInspectorWidget: React.FC<VariableInspectorWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  variables = []
}) => {

  const { pack } = useDesignPack();
  const inspectorTheme = pack.mode === 'dark' ? 'chromeDark' : 'chromeLight';

  // Group by variable name and keep track of changes
  const groupedVariables = useMemo(() => {
    const grouped = new Map<string, VariableAssignment[]>();

    variables.forEach(v => {
      if (!grouped.has(v.name)) {
        grouped.set(v.name, []);
      }
      grouped.get(v.name)!.push(v);
    });

    // Sort each group by timestamp
    grouped.forEach((assignments, name) => {
      assignments.sort((a, b) => a.timestamp - b.timestamp);
    });

    return grouped;
  }, [variables]);

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

  const getValueType = (value: any): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  return (
    <WidgetItem
      title="Variable Inspector"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      <div id="variable_inspector_display" className="scrollbar-hide overflow-y-auto max-h-[95%]">
        {groupedVariables.size === 0 ? (
          <EmptyState title="No variables assigned yet" description="Values tracked during execution will show their latest state and change history here." className="m-3" />
        ) : (
          Array.from(groupedVariables.entries()).map(([varName, assignments]) => {
            const latest = assignments[assignments.length - 1];
            const hasHistory = assignments.length > 1;

            return (
              <DataCard
                key={varName}
                tone="default"
                className="mb-4"
                header={
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h4 className="truncate text-sm font-semibold font-mono text-sc-primary">
                      {varName}
                    </h4>
                    <Chip
                      label={getValueType(latest.value)}
                      size="sm"
                      variant="primary"
                    />
                    {hasHistory && (
                      <Chip
                        label={`${assignments.length} changes`}
                        size="sm"
                        variant="default"
                      />
                    )}
                  </div>
                }
              >
                <MetricRow label="Last updated" value={formatTime(latest.timestamp)} />

                <InspectorSection label="Current Value">
                  <ObjectInspector
                    theme={inspectorTheme}
                    data={latest.value}
                    expandLevel={2}
                  />
                </InspectorSection>

                {hasHistory && (
                  <InspectorSection label="History" className="pt-1">
                    {assignments.slice(0, -1).reverse().map((assignment, idx) => (
                      <div
                        key={idx}
                        className="mb-2 rounded-[14px] border border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] p-3 text-xs"
                      >
                        <span className="text-xs block text-sc-text-muted mb-1">
                          {formatTime(assignment.timestamp)}
                        </span>
                        <ObjectInspector
                          theme={inspectorTheme}
                          data={assignment.value}
                          expandLevel={1}
                        />
                      </div>
                    ))}
                  </InspectorSection>
                )}
              </DataCard>
            );
          })
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(VariableInspectorWidget);
