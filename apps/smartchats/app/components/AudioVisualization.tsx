'use client';

import React, { useRef, useEffect, useCallback, useMemo } from 'react';

interface AudioVisualizationProps {
  audioLevelRef: React.MutableRefObject<number>;
  paused?: boolean;
  width?: number;
  height?: number;
  backgroundColor?: string;
  particleColor?: string;
  particleCount?: number;
}

const AudioVisualization: React.FC<AudioVisualizationProps> = ({
  audioLevelRef,
  paused = false,
  width = 300,
  height = 100,
  backgroundColor = '#1A2027',
  particleColor = '#34eb49',
  particleCount = 50
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  const getCssVar = (name: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  };

  const resolvedBackgroundColor = useMemo(
    () => backgroundColor === '#1A2027' ? getCssVar('--sc-background', '#0f0f0f') : backgroundColor,
    [backgroundColor]
  );
  const resolvedParticleColor = useMemo(
    () => particleColor === '#34eb49' ? getCssVar('--sc-primary', '#6ea8fe') : particleColor,
    [particleColor]
  );

  const generateParticles = useCallback((sigma: number) => {
    const particles: Array<{x: number, y: number}> = [];

    for (let i = 0; i < particleCount; i++) {
      // Box-Muller transform for Gaussian distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

      particles.push({ x: z0 * sigma, y: z1 * sigma });
    }

    return particles;
  }, [particleCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || paused) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      // Clear canvas
      if (resolvedBackgroundColor === 'transparent') {
        ctx.clearRect(0, 0, width, height);
      } else {
        ctx.fillStyle = resolvedBackgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      // Read current audio level from ref (no React re-renders)
      const audioLevel = audioLevelRef.current;

      // Generate particles based on audio level
      const sigma = audioLevel + 0.03;
      const particles = generateParticles(sigma);

      // Draw particles
      ctx.fillStyle = resolvedParticleColor;
      particles.forEach(p => {
        // Normalize from [-1, 1] to canvas coordinates
        const x = (p.x + 1) * width / 2;
        const y = (p.y + 1) * height / 2;

        // Only draw particles within canvas bounds
        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      });

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioLevelRef, paused, width, height, resolvedBackgroundColor, resolvedParticleColor, generateParticles]);

  return (
    <div className="flex justify-center w-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ backgroundColor: resolvedBackgroundColor }}
      />
    </div>
  );
};

export default AudioVisualization;
