'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { WidgetGridConfig } from '../components/DraggableWidgetGrid';

export interface WidgetConfig {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'chat', name: 'Chat', visible: true, order: 0 },
  { id: 'chatInput', name: 'Text Input', visible: true, order: 1 },
  { id: 'workspace', name: 'Workspace', visible: true, order: 2 },
  { id: 'thoughts', name: 'Thoughts', visible: true, order: 3 },
  { id: 'log', name: 'Log', visible: true, order: 4 },
  { id: 'code', name: 'Code', visible: true, order: 5 },
  { id: 'html', name: 'HTML', visible: true, order: 6 },
  { id: 'codeExecution', name: 'Code Execution', visible: true, order: 7 },
  { id: 'functionCalls', name: 'Function Calls', visible: true, order: 8 },
  { id: 'variableInspector', name: 'Variables', visible: true, order: 9 },
  { id: 'sandboxLogs', name: 'Sandbox Logs', visible: true, order: 10 },
  { id: 'history', name: 'Execution History', visible: true, order: 11 },
  { id: 'knowledgeGraph', name: 'Knowledge Graph', visible: true, order: 12 },
  { id: 'streamViewer', name: 'Stream', visible: true, order: 13 },
  { id: 'speechQueue', name: 'Speech Queue', visible: true, order: 14 },
  { id: 'processes', name: 'Processes', visible: true, order: 15 },
  { id: 'visualization', name: 'Display', visible: true, order: 16 },
  { id: 'llmInspector', name: 'LLM Inspector', visible: true, order: 17 },
];

// Default layout configuration
// 2-column layout, grouped by function: conversation → display → execution → debug → infra
const DEFAULT_LAYOUT: WidgetGridConfig[] = [
  // ── Conversation ──
  { i: 'chat',              x: 0, y: 0,  w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'chatInput',         x: 6, y: 0,  w: 6, h: 2, minW: 4, minH: 1 },
  { i: 'thoughts',          x: 6, y: 2,  w: 6, h: 2, minW: 4, minH: 2 },
  // ── Display ──
  { i: 'visualization',     x: 0, y: 4,  w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'html',              x: 6, y: 4,  w: 6, h: 4, minW: 4, minH: 3 },
  // ── Execution ──
  { i: 'code',              x: 0, y: 8,  w: 6, h: 3, minW: 4, minH: 3 },
  { i: 'codeExecution',     x: 6, y: 8,  w: 6, h: 3, minW: 4, minH: 3 },
  { i: 'functionCalls',     x: 0, y: 11, w: 6, h: 3, minW: 4, minH: 3 },
  { i: 'variableInspector', x: 6, y: 11, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'sandboxLogs',       x: 0, y: 14, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'history',           x: 6, y: 14, w: 6, h: 3, minW: 4, minH: 3 },
  // ── Data ──
  { i: 'workspace',         x: 0, y: 17, w: 6, h: 3, minW: 4, minH: 3 },
  { i: 'knowledgeGraph',    x: 6, y: 17, w: 6, h: 4, minW: 4, minH: 4 },
  // ── Debug / Infra ──
  { i: 'log',               x: 0, y: 20, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'streamViewer',      x: 6, y: 21, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'speechQueue',       x: 0, y: 23, w: 6, h: 3, minW: 3, minH: 2 },
  { i: 'processes',         x: 6, y: 24, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'llmInspector',      x: 0, y: 26, w: 6, h: 4, minW: 4, minH: 4 },
];

// Layout presets for different use cases
const LAYOUT_PRESETS: Record<string, WidgetGridConfig[]> = {
  default: DEFAULT_LAYOUT,
  focus: [
    { i: 'chat', x: 0, y: 0, w: 12, h: 8, minW: 4, minH: 3 }
  ],
  development: [
    { i: 'chat', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 3 },
    { i: 'code', x: 6, y: 0, w: 6, h: 6, minW: 4, minH: 3 },
    { i: 'workspace', x: 0, y: 6, w: 12, h: 4, minW: 4, minH: 3 }
  ],
  debug: [
    { i: 'chat', x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'workspace', x: 4, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'thoughts', x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'log', x: 0, y: 4, w: 6, h: 3, minW: 4, minH: 2 },
    { i: 'code', x: 6, y: 4, w: 6, h: 3, minW: 4, minH: 2 },
    { i: 'codeExecution', x: 0, y: 7, w: 6, h: 4, minW: 4, minH: 3 },
    { i: 'functionCalls', x: 6, y: 7, w: 6, h: 4, minW: 4, minH: 3 },
    { i: 'sandboxLogs', x: 0, y: 11, w: 12, h: 3, minW: 4, minH: 2 },
    { i: 'streamViewer', x: 0, y: 14, w: 12, h: 4, minW: 4, minH: 2 },
    { i: 'speechQueue', x: 0, y: 18, w: 6, h: 3, minW: 3, minH: 2 },
  ],
  minimal: [
    { i: 'chat', x: 0, y: 0, w: 8, h: 6, minW: 4, minH: 3 },
    { i: 'thoughts', x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 3 }
  ]
};

export function useWidgetConfig() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cortex_widget_config');
      return saved ? JSON.parse(saved) : DEFAULT_WIDGETS;
    }
    return DEFAULT_WIDGETS;
  });

  const [widgetLayout, setWidgetLayout] = useState<WidgetGridConfig[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cortex_widget_layout');
      return saved ? JSON.parse(saved) : DEFAULT_LAYOUT;
    }
    return DEFAULT_LAYOUT;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('cortex_widget_config', JSON.stringify(widgets));
    }
  }, [widgets]);

  const toggleWidget = useCallback((id: string) => {
    setWidgets(prev => prev.map(w =>
      w.id === id ? { ...w, visible: !w.visible } : w
    ));
  }, []);

  const saveLayout = useCallback((layout: WidgetGridConfig[]) => {
    setWidgetLayout(layout);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cortex_widget_layout', JSON.stringify(layout));
    }
  }, []);

  const resetLayout = useCallback(() => {
    setWidgetLayout(DEFAULT_LAYOUT);
    setWidgets(DEFAULT_WIDGETS);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cortex_widget_layout');
      localStorage.removeItem('cortex_widget_config');
    }
  }, []);

  const applyPreset = useCallback((presetName: string) => {
    const preset = LAYOUT_PRESETS[presetName];
    if (!preset) return;

    // Save the preset layout
    saveLayout(preset);

    // Show only widgets in the preset
    setWidgets(prev => prev.map(w => ({
      ...w,
      visible: preset.some(p => p.i === w.id)
    })));
  }, [saveLayout]);

  const visibleWidgets = useMemo(() => {
    return widgets.filter(w => w.visible).sort((a, b) => a.order - b.order);
  }, [widgets]);

  return useMemo(() => ({
    widgets,
    visibleWidgets,
    toggleWidget,
    widgetLayout,
    saveLayout,
    resetLayout,
    applyPreset
  }), [widgets, visibleWidgets, toggleWidget, widgetLayout, saveLayout, resetLayout, applyPreset]);
}
