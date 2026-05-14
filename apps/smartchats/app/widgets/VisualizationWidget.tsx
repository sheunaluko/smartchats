'use client';

import React from 'react';
import WidgetItem from '../WidgetItem';
import { SurfacePanel } from '../ui/recipes';
import { OrbStage } from '../ui/recipes/voice-stage/OrbStage';
import { VisualizationRenderer } from '../visualizations';
import type { Visualization } from '../visualizations';
import HTML_Widget from '../HTMLWidget';
import Code_Widget from '../CodeWidget';
import { useSmartChatsStore } from '../store/useSmartChatsStore';
import { AppContainer } from '../components/AppContainer';

interface VisualizationWidgetProps {
  fullscreen?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  activeVisualization: { type: string; props: any } | null;
  clearVisualization: () => void;
  activeHtml: string | null;
  clearHtml: () => void;
  codeParams: { code: string; mode: string };
  handleCodeChange: (params: any) => void;
  vizContext?: { tivi?: any; tiviSettings?: any; updateTiviSettings?: (partial: any) => void };
}

const VisualizationWidget: React.FC<VisualizationWidgetProps> = ({
  fullscreen = false,
  onFocus,
  onClose,
  activeHtml,
  clearHtml,
  codeParams,
  handleCodeChange,
  vizContext,
}) => {
  const vizStack = useSmartChatsStore(s => s.vizStack);
  const dismissViz = useSmartChatsStore(s => s.dismissViz);
  const activeAppSandbox = useSmartChatsStore(s => s.activeAppSandbox);
  const hasApp = !!activeAppSandbox;
  const hasViz = vizStack.length > 0;
  const hasHtml = !!activeHtml && activeHtml !== '__app__';
  const hasCode = !!codeParams?.code;
  const hasContent = hasApp || hasViz || hasHtml || hasCode;

  // Wrap fullscreen enter/exit: snapshot app state BEFORE React unmounts the iframe
  const appOnFocus = hasApp && onFocus ? async () => {
    await activeAppSandbox.snapshotState();
    onFocus();
  } : onFocus;
  const appOnClose = hasApp && onClose ? async () => {
    await activeAppSandbox.snapshotState();
    onClose();
  } : onClose;

  // When an app is active, it takes over the Display widget.
  // Fullscreen is safe — state is snapshotted before unmount, restored on remount.
  if (hasApp) {
    return (
      <WidgetItem title="Display" fullscreen={fullscreen} onFocus={appOnFocus} onClose={appOnClose}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <AppContainer sandbox={activeAppSandbox} />
        </div>
      </WidgetItem>
    );
  }

  return (
    <WidgetItem
      title="Display"
      fullscreen={fullscreen}
      onFocus={onFocus}
      onClose={onClose}
    >
      {hasContent ? (
        <div className="flex flex-col gap-3 overflow-y-auto" style={{ flex: 1 }}>
          {[...vizStack].reverse().map(v => (
            <VisualizationRenderer
              key={v._ts}
              viz={v as Visualization}
              onDismiss={() => dismissViz(v._ts)}
              context={vizContext}
            />
          ))}
          {hasHtml && (
            <SurfacePanel
              variant="tertiary"
              className="overflow-hidden"
              style={{ flexGrow: 1, minHeight: fullscreen ? '100%' : '95%' }}
            >
              <HTML_Widget to_display={activeHtml!} />
            </SurfacePanel>
          )}
          {hasCode && !hasViz && !hasHtml && (
            <SurfacePanel
              variant="tertiary"
              className="overflow-hidden"
              style={{ flexGrow: 1, minHeight: fullscreen ? '100%' : '95%' }}
            >
              <Code_Widget code_params={codeParams} onChange={handleCodeChange} />
            </SurfacePanel>
          )}
        </div>
      ) : (
        <OrbDefault />
      )}
    </WidgetItem>
  );
};

function OrbDefault() {
  const voiceStatus = useSmartChatsStore(s => s.voiceStatus);
  const started = useSmartChatsStore(s => s.started);
  const startStopVoice = useSmartChatsStore(s => s.startStopVoice);

  const state = !started && voiceStatus === 'idle' ? 'idle'
    : voiceStatus === 'listening' ? 'listening'
    : voiceStatus === 'processing' ? 'processing'
    : voiceStatus === 'speaking' ? 'speaking'
    : 'ready';

  const level = state === 'listening' ? 0.9 : state === 'speaking' ? 0.6 : state === 'processing' ? 0.45 : 0.18;

  return (
    <div className="flex items-center justify-center" style={{ minHeight: 280 }}>
      <OrbStage state={state} level={level} onActivate={startStopVoice} />
    </div>
  );
}

export default React.memo(VisualizationWidget);
