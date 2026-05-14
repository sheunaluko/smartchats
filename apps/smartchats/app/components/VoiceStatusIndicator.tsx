'use client';

import React from 'react';
import { Mic, Volume2, Square, Brain } from 'lucide-react';

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking';

interface VoiceStatusIndicatorProps {
  status: VoiceStatus;
  interimResult?: string;
  onStop?: () => void;
  visible: boolean;
  inline?: boolean; // If true, renders inline instead of fixed positioned
}

export const VoiceStatusIndicator: React.FC<VoiceStatusIndicatorProps> = React.memo(({
  status,
  interimResult,
  onStop,
  visible,
  inline = false
}) => {
  if (!visible || status === 'idle') return null;

  const statusColor = getStatusColor(status);

  return (
    <div
      className={`flex items-center backdrop-blur-[20px] border-2
        ${inline
          ? 'static gap-2 px-3 py-1.5 rounded-sc min-w-[200px] max-w-[400px] shadow-sm'
          : 'fixed top-20 left-1/2 -translate-x-1/2 z-[9999] gap-3 px-4 py-3 rounded-sc-lg min-w-[300px] max-w-[600px] shadow-lg animate-sc-slide-in-down'
        }`}
      style={{
        background: 'linear-gradient(135deg, var(--sc-surface) 0%, var(--sc-background) 100%)',
        borderColor: statusColor,
        boxShadow: inline
          ? `0 2px 8px ${statusColor}33`
          : `0 8px 32px ${statusColor}4D`,
      }}
    >
      {/* Status Icon */}
      <div
        className={`flex items-center justify-center rounded-full ${inline ? 'w-8 h-8' : 'w-12 h-12'}`}
        style={{
          background: `${statusColor}26`,
          color: statusColor,
        }}
      >
        {status === 'listening' && (
          <Mic size={inline ? 18 : 28} className="animate-pulse" />
        )}
        {status === 'processing' && (
          <Brain size={inline ? 18 : 28} />
        )}
        {status === 'speaking' && (
          <Volume2 size={inline ? 18 : 28} className="animate-bounce" />
        )}
      </div>

      {/* Status Text & Details */}
      <div className="flex-1 min-w-0">
        <h3
          className="text-lg font-semibold"
          style={{ color: statusColor, marginBottom: interimResult ? '2px' : 0 }}
        >
          {getStatusText(status)}
        </h3>

        {/* Interim Transcription */}
        {status === 'listening' && interimResult && (
          <p className="text-sm text-sc-text-muted italic overflow-hidden text-ellipsis whitespace-nowrap">
            &ldquo;{interimResult.length > 10 ? '...' + interimResult.slice(-10) : interimResult}&rdquo;
          </p>
        )}

        {/* Processing indicator */}
        {status === 'processing' && (
          <p className="text-sm text-sc-text-muted">
            Analyzing your request...
          </p>
        )}

        {/* Speaking indicator */}
        {status === 'speaking' && (
          <p className="text-sm text-sc-text-muted">
            Click stop to interrupt
          </p>
        )}
      </div>

      {/* Action Buttons */}
      {status === 'speaking' && onStop && (
        <button
          onClick={onStop}
          className="p-1.5 rounded-full transition-colors"
          style={{
            background: 'rgba(244, 67, 54, 0.1)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(244, 67, 54, 0.2)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(244, 67, 54, 0.1)';
          }}
        >
          <Square size={20} className="text-sc-danger" />
        </button>
      )}

      {status === 'processing' && (
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-sc-primary border-t-transparent" />
      )}
    </div>
  );
});

// Helper functions
function getStatusColor(status: VoiceStatus): string {
  switch (status) {
    case 'listening': return '#4caf50'; // Green
    case 'processing': return '#ff9800'; // Orange
    case 'speaking': return '#2196f3'; // Blue
    default: return '#9e9e9e'; // Gray
  }
}

function getStatusText(status: VoiceStatus): string {
  switch (status) {
    case 'listening': return 'Listening...';
    case 'processing': return 'Thinking...';
    case 'speaking': return 'Speaking...';
    default: return 'Ready';
  }
}
