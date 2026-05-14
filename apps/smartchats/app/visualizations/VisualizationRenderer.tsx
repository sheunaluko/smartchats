'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { DataCard } from '../ui/recipes/DataCard';
import type { Visualization } from './types';
import { BarChart, LineChart, PieChart, StatCard, TableDisplay, ImageDisplay, JitterPlot } from './charts';
import { Calendar } from './Calendar';
import { StructuredExtractionReview } from './StructuredExtractionReview';
import { TodoList } from './TodoList';
import { CalibrationPanel } from '@lab-components/tivi/CalibrationPanel';
import { VADMonitor } from '@lab-components/tivi/VADMonitor';
import { StarGraphViz } from './StarGraphViz';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

export type VizContext = {
  tivi?: any;
  tiviSettings?: any;
  updateTiviSettings?: (partial: any) => void;
};

type VisualizationRendererProps = {
  viz: Visualization;
  onDismiss: () => void;
  context?: VizContext;
};

export function VisualizationRenderer({ viz, onDismiss, context }: VisualizationRendererProps) {
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(onDismiss, 400);
    return () => clearTimeout(timer);
  }, [exiting, onDismiss]);

  return (
    <div
      className={`relative ${exiting ? 'animate-sc-viz-out' : 'animate-sc-scale-in'}`}
      style={exiting ? { animationFillMode: 'forwards' } : undefined}
    >
      <DataCard>
        <button
          onClick={handleDismiss}
          className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full text-sc-text-muted transition-colors duration-sc-fast hover:bg-sc-surface-secondary hover:text-sc-text"
          aria-label="Dismiss visualization"
        >
          <X size={12} />
        </button>
        <VizContent viz={viz} context={context} />
      </DataCard>
    </div>
  );
}

function VizContent({ viz, context }: { viz: Visualization; context?: VizContext }) {
  switch (viz.type) {
    case 'bar_chart':   return <BarChart {...viz.props} />;
    case 'line_chart':  return <LineChart {...viz.props} />;
    case 'pie_chart':   return <PieChart {...viz.props} />;
    case 'stat_card':   return <StatCard {...viz.props} />;
    case 'table':       return <TableDisplay {...viz.props} />;
    case 'image':       return <ImageDisplay {...viz.props} />;
    case 'jitter_plot': return <JitterPlot {...viz.props} />;
    case 'extraction_review': return <StructuredExtractionReview {...viz.props} />;
    case 'todo_list':   return <TodoList {...viz.props} />;
    case 'calendar':    return <Calendar {...viz.props} />;
    case 'calibration': return context?.tivi ? (
      <CalibrationViz context={context} />
    ) : <p className="text-xs text-sc-text-muted">Voice not initialized</p>;
    case 'star_graph':  return <StarGraphViz props={viz.props} />;
    default:            return <p className="text-xs text-sc-text-muted">Unknown visualization type</p>;
  }
}

function CalibrationViz({ context }: { context: VizContext }) {
  const handlePhaseChange = useCallback((phase: string) => {
    const suppress = phase === 'phase1' || phase === 'phase2';
    useSmartChatsStore.getState().setTranscribeEnabled(!suppress);
  }, []);

  // Re-enable transcription on unmount
  useEffect(() => {
    return () => { useSmartChatsStore.getState().setTranscribeEnabled(true); };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <VADMonitor
        speechProbRef={context.tivi.speechProbRef}
        audioLevelRef={context.tivi.audioLevelRef}
        threshold={context.tiviSettings?.positiveSpeechThreshold}
        powerThreshold={context.tiviSettings?.mode === 'responsive' ? context.tiviSettings.powerThreshold : undefined}
        minSpeechStartMs={context.tiviSettings?.minSpeechStartMs}
        paused={false}
        width={300}
        height={60}
      />
      <CalibrationPanel
        tivi={context.tivi}
        vadParams={context.tiviSettings}
        updateVadParam={(key: string, value: any) => context.updateTiviSettings?.({ [key]: value })}
        disabled={context.tivi.isSpeaking}
        onPhaseChange={handlePhaseChange}
      />
    </div>
  );
}
