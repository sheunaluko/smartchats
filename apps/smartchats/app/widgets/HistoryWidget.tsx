'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Pin, Columns, PanelLeft, CheckCircle, AlertCircle, ChevronDown, ChevronUp, LayoutGrid, Check } from 'lucide-react';
import WidgetItem from '../WidgetItem';
import { Chip } from '../ui/Chip';
import { Tooltip } from '../ui/Tooltip';
import { ExecutionSnapshot } from '../types/execution';
import { DataCard, EmptyState, InspectorSection, MetricRow } from '../ui/recipes';

interface HistoryWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  executions: ExecutionSnapshot[];
  selectedIndex: number; // -1 means latest, >= 0 means specific index
  isPinned: boolean;
  onSelectExecution: (index: number) => void;
  onTogglePin: () => void;
}

const SIZE_PRESETS = [
  { label: 'Small', value: 100 },
  { label: 'Medium', value: 200 },
  { label: 'Large', value: 300 },
  { label: 'XL', value: 400 }
];

const HistoryWidget: React.FC<HistoryWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  executions,
  selectedIndex,
  isPinned,
  onSelectExecution,
  onTogglePin
}) => {
  const [layout, setLayout] = useState<'vertical' | 'horizontal'>('horizontal');

  // Load itemSize from localStorage on mount
  const [itemSize, setItemSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('historyWidget_itemSize');
      return saved ? parseInt(saved, 10) : 200;
    }
    return 200;
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Save itemSize to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('historyWidget_itemSize', itemSize.toString());
    }
  }, [itemSize]);

  // Close size menu on outside click
  useEffect(() => {
    if (!sizeMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (sizeMenuRef.current && !sizeMenuRef.current.contains(e.target as Node)) {
        setSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sizeMenuOpen]);

  // Determine which execution is selected
  const getSelectedExecutionIndex = () => {
    if (executions.length === 0) return -1;
    if (selectedIndex === -1) return executions.length - 1;
    return Math.min(selectedIndex, executions.length - 1);
  };

  const isExecutionSelected = (index: number) => {
    return index === getSelectedExecutionIndex();
  };

  // Auto-scroll to selected item within widget only (don't scroll the page)
  useEffect(() => {
    if (scrollContainerRef.current && executions.length > 0) {
      const container = scrollContainerRef.current;
      const selectedIdx = getSelectedExecutionIndex();
      const selectedElement = container.children[selectedIdx] as HTMLElement;

      if (selectedElement) {
        // Manually scroll within the container to avoid scrolling the whole page
        if (layout === 'vertical') {
          const containerRect = container.getBoundingClientRect();
          const elementRect = selectedElement.getBoundingClientRect();
          const relativeTop = elementRect.top - containerRect.top + container.scrollTop;

          // Only scroll if element is not fully visible
          if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
            container.scrollTo({
              top: relativeTop - containerRect.height / 2 + elementRect.height / 2,
              behavior: 'smooth'
            });
          }
        } else {
          const containerRect = container.getBoundingClientRect();
          const elementRect = selectedElement.getBoundingClientRect();
          const relativeLeft = elementRect.left - containerRect.left + container.scrollLeft;

          // Only scroll if element is not fully visible
          if (elementRect.left < containerRect.left || elementRect.right > containerRect.right) {
            container.scrollTo({
              left: relativeLeft - containerRect.width / 2 + elementRect.width / 2,
              behavior: 'smooth'
            });
          }
        }
      }
    }
  }, [selectedIndex, executions.length, layout]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  const formatCode = (code: string, maxLines: number = 3) => {
    const lines = code.split('\n');
    if (lines.length <= maxLines) return code;
    return lines.slice(0, maxLines).join('\n') + '\n...';
  };

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  const handleSizeSelect = (size: number) => {
    setItemSize(size);
    setSizeMenuOpen(false);
  };

  return (
    <WidgetItem
      title="Execution History"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
      controls={
        <div className="flex gap-2 items-center">
          {/* Size Preset Menu */}
          <div ref={sizeMenuRef} className="relative">
            <Tooltip content="Card size">
              <button
                className="status-focused p-1.5 rounded-full hover:bg-[var(--sc-default-hover)] transition-colors"
                onClick={() => setSizeMenuOpen(!sizeMenuOpen)}
              >
                <LayoutGrid size={16} />
              </button>
            </Tooltip>
            {sizeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-[14px] border border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] py-1 shadow-lg">
                {SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => handleSizeSelect(preset.value)}
                    className={`status-focused w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-[var(--sc-default-hover)] transition-colors
                      ${itemSize === preset.value ? 'text-sc-primary' : 'text-sc-text'}`}
                  >
                    <span className="w-4">
                      {itemSize === preset.value && <Check size={14} />}
                    </span>
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pin Toggle */}
          <Tooltip content={isPinned ? "Unpin (auto-advance to latest)" : "Pin to selected execution"}>
            <button
              className={`status-focused p-1.5 rounded-full hover:bg-[var(--sc-default-hover)] transition-colors
                ${isPinned ? 'text-sc-primary' : 'text-sc-text-muted'}`}
              onClick={onTogglePin}
            >
              <Pin size={16} className={isPinned ? 'fill-current' : ''} />
            </button>
          </Tooltip>

          {/* Layout Toggle */}
          <Tooltip content={layout === 'vertical' ? "Switch to horizontal layout" : "Switch to vertical layout"}>
            <button
              className="status-focused p-1.5 rounded-full hover:bg-[var(--sc-default-hover)] transition-colors"
              onClick={() => setLayout(layout === 'vertical' ? 'horizontal' : 'vertical')}
            >
              {layout === 'vertical' ? <PanelLeft size={16} /> : <Columns size={16} />}
            </button>
          </Tooltip>
        </div>
      }
    >
      <div className="h-full flex flex-col">
        {/* Execution List */}
        {executions.length === 0 ? (
          <EmptyState title="No executions yet" description="Completed runs will be captured here so you can inspect prior code, results, and errors." className="m-3" />
        ) : (
          <div
            ref={scrollContainerRef}
            className={`flex-1 flex gap-2 p-2 max-h-full
              ${layout === 'vertical'
                ? 'flex-col overflow-y-auto overflow-x-hidden'
                : 'flex-row overflow-x-auto overflow-y-hidden'}
              scrollbar-thin`}
            style={{
              scrollbarColor: '#555 #1e1e1e',
            }}
          >
            {executions.map((execution, index) => {
              const isSelected = isExecutionSelected(index);
              const isExpanded = expandedId === execution.executionId;

              return (
                <DataCard
                  key={execution.executionId}
                  onClick={() => onSelectExecution(index)}
                  tone={isSelected ? 'primary' : execution.status === 'error' ? 'danger' : 'default'}
                  interactive
                  className={`cursor-pointer transition-all duration-200 flex flex-col shrink-0
                    ${isSelected
                      ? 'shadow-lg'
                      : ''}`}
                  style={{
                    minWidth: layout === 'horizontal' ? `${itemSize}px` : 'auto',
                    minHeight: layout === 'vertical' ? `${itemSize}px` : 'auto',
                    height: layout === 'vertical' ? (isExpanded ? 'auto' : `${itemSize}px`) : 'auto',
                    width: layout === 'horizontal' ? `${itemSize}px` : 'auto',
                  }}
                  header={
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {execution.status === 'success' ? (
                          <CheckCircle size={18} className="text-sc-success shrink-0" />
                        ) : (
                          <AlertCircle size={18} className="text-sc-danger shrink-0" />
                        )}
                        <div className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-sc-text">
                            #{execution.executionId.slice(-8)}
                          </span>
                          <span className="block text-xs text-sc-text-muted">
                            {formatTimestamp(execution.timestamp)}
                          </span>
                        </div>
                      </div>
                      <button
                        className="status-focused shrink-0 rounded-full p-1 hover:bg-[var(--sc-default-hover)] transition-colors"
                        onClick={(e) => toggleExpanded(execution.executionId, e)}
                        aria-label={isExpanded ? 'Collapse execution details' : 'Expand execution details'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <Chip
                      label={`${execution.duration}ms`}
                      size="sm"
                      className="w-fit text-[0.7rem]"
                    />
                    <Chip
                      label={execution.status}
                      size="sm"
                      variant={execution.status === 'success' ? 'success' : 'danger'}
                    />
                  </div>

                  <div className="space-y-2">
                    <MetricRow label="Function calls" value={execution.functionCalls.length} />
                    <MetricRow label="Variables" value={execution.variableAssignments.length} />
                    <MetricRow label="Logs" value={execution.sandboxLogs.length} />
                  </div>

                  {isExpanded && (
                    <div className="pt-1">
                      <InspectorSection label="Code">
                        <div className="max-h-[100px] overflow-auto rounded-[12px] border border-[var(--sc-separator)] bg-[var(--sc-surface-secondary)] p-3 font-mono text-[0.7rem] whitespace-pre-wrap break-words">
                          {formatCode(execution.code)}
                        </div>
                      </InspectorSection>

                      {execution.error && (
                        <InspectorSection label="Error" tone="danger">
                          <div className="rounded-[12px] border border-sc-danger/30 bg-sc-danger/10 p-3">
                            <span className="font-mono text-[0.7rem] text-sc-danger">
                              {execution.error}
                            </span>
                          </div>
                        </InspectorSection>
                      )}
                    </div>
                  )}
                </DataCard>
              );
            })}
          </div>
        )}
      </div>
    </WidgetItem>
  );
};

export default React.memo(HistoryWidget);
