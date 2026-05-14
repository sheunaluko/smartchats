'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSmartChatsStore } from '../store/useSmartChatsStore';

/**
 * TourOverlay — full-screen spotlight overlay for the UI tour.
 * Highlights an element matched by `[data-tour="${target}"]` and shows tooltip text.
 * Tap anywhere to advance to the next step.
 */
export function TourOverlay() {
  const highlight = useSmartChatsStore(s => s.uiTourHighlight);
  const advance = useSmartChatsStore(s => s.advanceUiTour);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Find the target element and track its position
  useEffect(() => {
    if (!highlight) { setRect(null); return; }

    function measure() {
      const el = document.querySelector(`[data-tour="${highlight!.target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    }

    measure();
    // Re-measure on scroll/resize
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [highlight]);

  const handleTap = useCallback(() => {
    advance();
  }, [advance]);

  if (!highlight || !rect) return null;

  // Spotlight cutout dimensions (slightly larger than the element)
  const pad = 8;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(rect.width, rect.height) / 2 + pad;

  // Tooltip position: above or below the element
  const tooltipAbove = cy > window.innerHeight / 2;
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    ...(tooltipAbove
      ? { bottom: window.innerHeight - rect.top + 16 }
      : { top: rect.bottom + 16 }),
    maxWidth: 280,
    padding: '12px 16px',
    borderRadius: 12,
    background: 'var(--sc-surface, #1a1a2e)',
    border: '1px solid var(--sc-primary, #6366f1)',
    color: 'var(--sc-text, #e0e0e0)',
    fontSize: 14,
    lineHeight: 1.5,
    textAlign: 'center' as const,
    zIndex: 10001,
    animation: 'sc-tour-fade-in 300ms ease-out',
  };

  return (
    <>
      {/* Dark overlay with circular cutout */}
      <div
        onClick={handleTap}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          cursor: 'pointer',
          background: 'transparent',
        }}
      >
        {/* Spotlight ring */}
        <div
          style={{
            position: 'fixed',
            left: cx - radius,
            top: cy - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: '50%',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
            zIndex: 10000,
            pointerEvents: 'none',
            animation: 'sc-tour-fade-in 300ms ease-out',
          }}
        />
        {/* Pulse ring around spotlight */}
        <div
          style={{
            position: 'fixed',
            left: cx - radius - 4,
            top: cy - radius - 4,
            width: (radius + 4) * 2,
            height: (radius + 4) * 2,
            borderRadius: '50%',
            border: '2px solid var(--sc-primary, #6366f1)',
            opacity: 0.6,
            animation: 'sc-tour-pulse 2s ease-in-out infinite',
            zIndex: 10000,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Tooltip */}
      <div onClick={handleTap} style={tooltipStyle}>
        {highlight.text}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sc-text-muted, #888)' }}>
          Tap anywhere to continue
        </div>
      </div>

      {/* Inject keyframes */}
      <style>{`
        @keyframes sc-tour-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes sc-tour-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.1); opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
