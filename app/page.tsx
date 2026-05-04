'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Mic, Code2, Brain, ArrowRight,
  GitBranch, Volume2, Plug,
  Send, Sparkles, ExternalLink, Linkedin, Github,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

/* ═══════════════════════════════════════════════════════════════
   SMARTCHATS MARK — paths verbatim from app/ui/recipes/SessionMiniHeader.tsx
   (the actual logo). Gradient C arc + S Bézier path. Animation
   simplified for the marketing context: S rotates clockwise, C
   counter-clockwise, both continuously — always visible motion.
   Keyframes live in the global style block (more reliable than SVG-
   embedded <style>).
   ═══════════════════════════════════════════════════════════════ */
function SmartChatsMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="sc-mark-wrap"
      style={{ width: size, height: size, display: 'inline-block' }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" aria-label="SmartChats" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="sc-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9ec5ff" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="#0a0a0a" />
        <g className="sc-c-spin">
          <path
            d="M 72 28 A 31 31 0 1 0 72 72"
            fill="none"
            stroke="url(#sc-logo-grad)"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M 60 36 C 52 30, 38 32, 38 40 C 38 48, 62 46, 62 56 C 62 66, 46 68, 38 62"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinecap="round"
          className="sc-s-spin"
        />
      </svg>
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VOICE WAVEFORM — restrained, signature visual.
   Single layered wave; no particle noise.
   ═══════════════════════════════════════════════════════════════ */
function VoiceWave({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let t = 0;
    let visible = true;
    let running = false;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const waves = [
      { amp: 70, freq: 0.0055, speed: 0.6, alpha: 0.55, width: 1.8 },
      { amp: 45, freq: 0.009,  speed: 1.0, alpha: 0.30, width: 1.2 },
      { amp: 25, freq: 0.014,  speed: 1.6, alpha: 0.18, width: 0.9 },
    ];

    const draw = () => {
      if (!visible) { running = false; return; }
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      t += 0.006;

      // No shadowBlur — it forces an offscreen pass + blur + composite for
      // every stroke. Slightly thicker strokes preserve the visual presence
      // at a fraction of the per-frame cost.
      waves.forEach(wave => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(99, 162, 255, ${wave.alpha * intensity})`;
        ctx.lineWidth = wave.width;
        for (let x = 0; x <= w; x += 2) {
          const y = h / 2 +
            Math.sin(x * wave.freq + t * wave.speed) * wave.amp * intensity +
            Math.sin(x * wave.freq * 0.5 + t * wave.speed * 1.3) * wave.amp * 0.4 * intensity;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      animRef.current = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      animRef.current = requestAnimationFrame(draw);
    };

    // Pause the loop entirely once the hero scrolls out of view.
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        visible = e.isIntersecting;
        if (visible) start();
      },
      { threshold: 0 }
    );
    io.observe(canvas);
    start();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
      io.disconnect();
      visible = false;
      running = false;
    };
  }, [intensity]);

  return <canvas ref={canvasRef} className={className} style={{ width: '100%', height: '100%' }} />;
}

/* ═══════════════════════════════════════════════════════════════
   VOICE ORB — the signature interactive element.
   Single restrained design, not pulsing chaos.
   ═══════════════════════════════════════════════════════════════ */
function VoiceOrb({ size = 120, glow = true }: { size?: number; glow?: boolean }) {
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orbRef.current) return;
    gsap.to(orbRef.current, {
      scale: 1.04,
      duration: 2.4,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    const rings = orbRef.current.querySelectorAll('.orb-ring');
    rings.forEach((ring, i) => {
      gsap.to(ring, {
        scale: 1.6 + i * 0.25,
        opacity: 0,
        duration: 3,
        ease: 'power1.out',
        repeat: -1,
        delay: i * 1.0,
      });
    });
  }, []);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div
        ref={orbRef}
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          background: 'radial-gradient(circle at 30% 30%, rgba(99,162,255,0.95) 0%, rgba(70,120,220,0.7) 40%, rgba(40,80,180,0.4) 70%, rgba(20,40,100,0.2) 100%)',
          boxShadow: glow
            ? '0 0 80px rgba(99,162,255,0.35), 0 0 160px rgba(99,162,255,0.15), inset 0 0 40px rgba(255,255,255,0.08)'
            : 'inset 0 0 30px rgba(255,255,255,0.08)',
        }}
      >
        <div className="orb-ring absolute inset-0 rounded-full border border-blue-400/30" />
        <div className="orb-ring absolute inset-0 rounded-full border border-blue-400/20" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ANIMATED PRODUCT MOCK — shows real-feeling SmartChats UI
   with a scripted voice → execution → result flow.
   ═══════════════════════════════════════════════════════════════ */
type DemoStep =
  | { t: 'voice'; text: string }
  | { t: 'thought'; text: string }
  | { t: 'code'; text: string }
  | { t: 'result' }
  | { t: 'speak'; text: string };

type ChartSpec =
  | { kind: 'bar'; title: string; bars: { label: string; value: number; highlighted?: boolean }[]; metrics: { label: string; value: string; tone?: 'pos' | 'neutral' }[] }
  | { kind: 'line'; title: string; labels: string[]; values: number[]; unit: string; metrics: { label: string; value: string; tone?: 'pos' | 'neutral' }[] }
  | { kind: 'pie'; title: string; slices: { label: string; value: number; color: string }[]; metrics: { label: string; value: string; tone?: 'pos' | 'neutral' }[] };

type DemoScript = {
  id: string;
  steps: DemoStep[];
  chart: ChartSpec;
};

const DEMO_SCRIPTS: DemoScript[] = [
  {
    id: 'revenue',
    steps: [
      { t: 'voice', text: '"Pull last quarter\'s revenue and chart it by month"' },
      { t: 'thought', text: 'Resolving query → revenue table → group by month → render bar chart' },
      { t: 'code', text: `const rows = await db.query(\`
  SELECT time::group(date, 'month') AS month,
         math::sum(amount) AS revenue
  FROM transactions
  WHERE date >= '2026-01-01'
  GROUP BY month
\`)
chart.bar({ data: rows, x: 'month', y: 'revenue' })` },
      { t: 'result' },
      { t: 'speak', text: '"Revenue grew 23% quarter over quarter, with strongest gains in March. Saved to your knowledge graph as Q1-2026 revenue."' },
    ],
    chart: {
      kind: 'bar',
      title: 'Q1-2026 Revenue ($k)',
      bars: [
        { label: 'Jan', value: 62 },
        { label: 'Feb', value: 41 },
        { label: 'Mar', value: 88 },
        { label: 'Apr', value: 73 },
        { label: 'May', value: 92, highlighted: true },
      ],
      metrics: [
        { label: 'QoQ Δ', value: '+23%', tone: 'pos' },
        { label: 'stored to KG', value: 'q1-2026-revenue' },
      ],
    },
  },
  {
    id: 'activity',
    steps: [
      { t: 'voice', text: '"Show me my cumulative running activity over the last 6 months"' },
      { t: 'thought', text: 'KG → activity logs · type=run · last 6 months → cumulative sum → line chart' },
      { t: 'code', text: `const logs = await db.query(\`
  SELECT date, distance_km
  FROM activity_logs
  WHERE type = 'run'
    AND date >= time::sub(time::now(), 6mo)
  ORDER BY date ASC
\`)
const cumulative = logs.reduce((acc, l) =>
  [...acc, (acc.at(-1) ?? 0) + l.distance_km], [])
chart.line({ x: logs.map(l => l.date), y: cumulative })` },
      { t: 'result' },
      { t: 'speak', text: '"You\'ve run 264 kilometers over the last six months — about 44 a month on average. Your strongest stretch was March at 56 kilometers."' },
    ],
    chart: {
      kind: 'line',
      title: 'Cumulative running · last 6 months (km)',
      labels: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'],
      values: [18, 47, 89, 142, 198, 264],
      unit: 'km',
      metrics: [
        { label: 'total', value: '264 km', tone: 'pos' },
        { label: 'avg / month', value: '44 km' },
      ],
    },
  },
  {
    id: 'percentage',
    steps: [
      { t: 'voice', text: '"What percent of my journal entries this year mention exercise?"' },
      { t: 'thought', text: 'Counting logs from 2026-01-01 → matching content → exercise vs other → pie' },
      { t: 'code', text: `const total = await db.query(\`
  SELECT count() FROM logs WHERE date >= '2026-01-01'
\`)
const exercise = await db.query(\`
  SELECT count() FROM logs
  WHERE date >= '2026-01-01'
    AND content @@ 'exercise'
\`)
chart.pie({ exercise, other: total - exercise })` },
      { t: 'result' },
      { t: 'speak', text: '"About 38 percent of your journal entries this year mention exercise. Meals are next at 24 percent, and sleep at 18 percent — all tracked alongside in your knowledge graph."' },
    ],
    chart: {
      kind: 'pie',
      title: 'Journal entries · 2026 YTD',
      slices: [
        { label: 'Exercise', value: 38, color: '#3b82f6' },
        { label: 'Meals',    value: 24, color: '#9ec5ff' },
        { label: 'Sleep',    value: 18, color: '#63a2ff' },
        { label: 'Other',    value: 20, color: 'rgba(255,255,255,0.18)' },
      ],
      metrics: [
        { label: 'exercise',     value: '38%', tone: 'pos' },
        { label: 'tracked total', value: '342 entries' },
      ],
    },
  },
];

function ProductDemo() {
  const [scriptIdx, setScriptIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let alive = true;

    const STEP_DELAY = 2200;
    const SCRIPT_PAUSE = 3200;

    const tick = (sIdx: number, stp: number) => {
      if (!alive) return;
      const script = DEMO_SCRIPTS[sIdx];
      if (stp >= script.steps.length - 1) {
        // Last step rendered. Pause, then advance to next script.
        timerRef.current = setTimeout(() => {
          if (!alive) return;
          const nextScript = (sIdx + 1) % DEMO_SCRIPTS.length;
          setScriptIdx(nextScript);
          setStepIdx(0);
          tick(nextScript, 0);
        }, SCRIPT_PAUSE);
        return;
      }
      const next = stp + 1;
      timerRef.current = setTimeout(() => {
        if (!alive) return;
        setStepIdx(next);
        tick(sIdx, next);
      }, STEP_DELAY);
    };

    const start = () => {
      if (!alive) return;
      setStepIdx(0);
      tick(0, 0);
    };

    const trigger = ScrollTrigger.create({
      trigger: containerRef.current,
      start: 'top 75%',
      once: true,
      onEnter: start,
    });

    return () => {
      alive = false;
      trigger.kill();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const script = DEMO_SCRIPTS[scriptIdx];
  const visible = stepIdx < 0 ? [] : script.steps.slice(0, stepIdx + 1);
  const showResult = visible.some(s => s.t === 'result');

  return (
    <div ref={containerRef} className="w-full">
      {/* App-shell mock */}
      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur overflow-hidden shadow-2xl shadow-blue-500/5">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-3 text-[11px] text-white/40 font-mono tracking-wide">smartchats.ai — live session</span>
          <div className="ml-auto flex items-center gap-3">
            {/* Script indicator dots */}
            <div className="flex items-center gap-1.5">
              {DEMO_SCRIPTS.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${i === scriptIdx ? 'bg-blue-400 w-4' : 'bg-white/15'}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-emerald-400/70 font-mono">connected</span>
            </div>
          </div>
        </div>

        {/* Timeline. Both columns get an explicit min-h so the demo's overall
           height is stable across the script loop — without this, the left
           column collapses from ~5 entries back to 1 every ~14s and pumps
           the page layout below. */}
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          {/* Left: conversation timeline */}
          <div key={`script-${scriptIdx}`} className="p-5 space-y-3 border-b lg:border-b-0 lg:border-r border-white/5 min-h-[460px]">
            {visible.map((s, i) => <DemoEntry key={`${scriptIdx}-${i}`} step={s} />)}
            {visible.length === 0 && (
              <div className="flex items-center gap-2 text-white/40 text-sm py-12 justify-center">
                <Mic className="w-4 h-4" />
                <span>Say something...</span>
              </div>
            )}
          </div>

          {/* Right: workspace output */}
          <div className="p-5 bg-white/[0.01]">
            <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3 font-mono">workspace</div>
            <DemoWorkspace key={`ws-${scriptIdx}-${showResult}`} chart={script.chart} show={showResult} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoEntry({ step }: { step: DemoStep }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
  }, []);

  if (step.t === 'voice') {
    return (
      <div ref={ref} className="flex gap-3 items-start">
        <div className="mt-0.5 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center shrink-0">
          <Mic className="w-3.5 h-3.5 text-blue-300" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-blue-300/70 mb-1 font-mono">voice in</div>
          <div className="text-white/90 text-[15px] leading-relaxed">{step.text}</div>
        </div>
      </div>
    );
  }
  if (step.t === 'thought') {
    return (
      <div ref={ref} className="pl-10 text-[12px] text-white/40 font-mono leading-relaxed border-l border-white/5 ml-3 pl-4 py-1">
        <span className="text-emerald-400/60">▸</span> {step.text}
      </div>
    );
  }
  if (step.t === 'code') {
    return (
      <div ref={ref} className="pl-10">
        <div className="text-[10px] uppercase tracking-wider text-emerald-400/70 mb-1.5 font-mono">code · sandboxed</div>
        <pre className="text-[11.5px] leading-relaxed text-white/70 bg-white/[0.02] border border-white/5 rounded-lg p-3 overflow-x-auto font-mono">
          {step.text}
        </pre>
      </div>
    );
  }
  if (step.t === 'speak') {
    return (
      <div ref={ref} className="flex gap-3 items-start">
        <div className="mt-0.5 w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Volume2 className="w-3.5 h-3.5 text-white/70" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1 font-mono">voice out · streaming tts</div>
          <div className="text-white/80 text-[14px] leading-relaxed italic">{step.text}</div>
        </div>
      </div>
    );
  }
  return null;
}

function DemoWorkspace({ chart, show }: { chart: ChartSpec; show: boolean }) {
  if (!show) {
    return (
      <div className="h-[360px] rounded-lg border border-dashed border-white/10 flex items-center justify-center">
        <div className="text-center">
          <Code2 className="w-6 h-6 text-white/20 mx-auto mb-2" />
          <div className="text-white/30 text-xs font-mono">awaiting execution</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[360px] flex flex-col">
      <div className="text-[12px] text-white/60 mb-2 font-mono">{chart.title}</div>
      <div className="flex-1 min-h-0 pb-3 border-b border-white/5">
        {chart.kind === 'bar' && <DemoBarChart spec={chart} />}
        {chart.kind === 'line' && <DemoLineChart spec={chart} />}
        {chart.kind === 'pie' && <DemoPieChart spec={chart} />}
      </div>
      <div className="pt-3 grid grid-cols-2 gap-3">
        {chart.metrics.map((m, i) => (
          <div key={i} className="text-xs">
            <div className="text-white/40 font-mono text-[10px] uppercase tracking-wider">{m.label}</div>
            <div className={`font-mono text-base ${m.tone === 'pos' ? 'text-emerald-400' : 'text-white/80'}`}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoBarChart({ spec }: { spec: Extract<ChartSpec, { kind: 'bar' }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const bars = ref.current.querySelectorAll('.demo-bar');
    gsap.fromTo(bars,
      { scaleY: 0, transformOrigin: 'bottom' },
      { scaleY: 1, duration: 0.7, stagger: 0.08, ease: 'power3.out' }
    );
  }, []);

  const max = Math.max(...spec.bars.map(b => b.value));
  return (
    <div ref={ref} className="h-full flex items-end justify-between gap-3">
      {spec.bars.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-2">
          <span className="text-[10px] text-white/40 font-mono">{b.value}</span>
          <div
            className="demo-bar w-full rounded-t-sm"
            style={{
              height: `${(b.value / max) * 220}px`,
              background: b.highlighted
                ? 'linear-gradient(180deg, #63a2ff 0%, #3b82f6 100%)'
                : 'linear-gradient(180deg, rgba(99,162,255,0.4) 0%, rgba(59,130,246,0.5) 100%)',
            }}
          />
          <span className="text-[10px] text-white/40 font-mono">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function DemoLineChart({ spec }: { spec: Extract<ChartSpec, { kind: 'line' }> }) {
  const pathRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!pathRef.current) return;
    const len = pathRef.current.getTotalLength();
    pathRef.current.style.strokeDasharray = `${len}`;
    pathRef.current.style.strokeDashoffset = `${len}`;
    gsap.to(pathRef.current, {
      strokeDashoffset: 0,
      duration: 1.4,
      ease: 'power2.out',
    });
    if (fillRef.current) {
      gsap.fromTo(fillRef.current, { opacity: 0 }, { opacity: 1, duration: 1.2, delay: 0.4, ease: 'power2.out' });
    }
  }, []);

  // Compute path coordinates in a 300×100 viewBox (aspect ~3:1 to match
  // the workspace cell's typical aspect). preserveAspectRatio="xMidYMid meet"
  // keeps dots round and line uniform-thickness across viewports.
  const { values, labels } = spec;
  const max = Math.max(...values);
  const W = 300;
  const H = 100;
  const padX = 12;
  const padY = 10;
  const pts = values.map((v, i) => {
    const x = padX + (i / (values.length - 1)) * (W - padX * 2);
    const y = H - padY - (v / max) * (H - padY * 2);
    return [x, y] as const;
  });
  const linePath = pts.reduce((acc, [x, y], i) =>
    acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`), ''
  );
  const fillPath = `${linePath} L ${pts[pts.length - 1][0]} ${H - padY} L ${pts[0][0]} ${H - padY} Z`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          <defs>
            <linearGradient id="line-fill-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="line-stroke-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#9ec5ff" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          {/* Gridlines */}
          {[0.25, 0.5, 0.75].map((p, i) => (
            <line
              key={i}
              x1={padX}
              x2={W - padX}
              y1={padY + p * (H - padY * 2)}
              y2={padY + p * (H - padY * 2)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="0.5"
            />
          ))}
          {/* Area fill */}
          <path ref={fillRef} d={fillPath} fill="url(#line-fill-grad)" />
          {/* Line */}
          <path
            ref={pathRef}
            d={linePath}
            fill="none"
            stroke="url(#line-stroke-grad)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Endpoint dots — round (no preserveAspectRatio stretch),
              sized to fully cover the line stroke at each vertex */}
          {pts.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i === pts.length - 1 ? 3.2 : 2.4}
              fill={i === pts.length - 1 ? '#9ec5ff' : '#3b82f6'}
              stroke="#0a0a0a"
              strokeWidth="0.6"
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-white/40 font-mono px-3">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function DemoPieChart({ spec }: { spec: Extract<ChartSpec, { kind: 'pie' }> }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const slices = ref.current.querySelectorAll('.pie-slice');
    gsap.fromTo(slices,
      { opacity: 0, scale: 0.6, transformOrigin: '50px 50px' },
      { opacity: 1, scale: 1, duration: 0.6, stagger: 0.1, ease: 'back.out(1.4)' }
    );
  }, []);

  const total = spec.slices.reduce((s, x) => s + x.value, 0);
  let cum = 0;
  const slicePaths = spec.slices.map((s) => {
    const startAngle = (cum / total) * Math.PI * 2 - Math.PI / 2;
    cum += s.value;
    const endAngle = (cum / total) * Math.PI * 2 - Math.PI / 2;
    const cx = 50;
    const cy = 50;
    const r = 36;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const large = s.value / total > 0.5 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { d, color: s.color, label: s.label, pct: Math.round((s.value / total) * 100) };
  });

  return (
    <div className="h-full flex items-center gap-5">
      <div className="h-full aspect-square max-h-[220px]">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <g ref={ref}>
            {slicePaths.map((p, i) => (
              <path key={i} d={p.d} fill={p.color} className="pie-slice" stroke="#0a0a0a" strokeWidth="0.6" />
            ))}
            {/* Inner cutout for donut style */}
            <circle cx="50" cy="50" r="14" fill="#0a0a0a" />
          </g>
        </svg>
      </div>
      <div className="flex-1 space-y-2">
        {slicePaths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="text-white/70 font-mono flex-1">{p.label}</span>
            <span className="text-white/50 font-mono tabular-nums">{p.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SECTION HEADING — restrained, single style across the page
   ═══════════════════════════════════════════════════════════════ */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 mb-6">
      <span className="w-6 h-px bg-blue-400/60" />
      <span className="text-[11px] uppercase tracking-[0.18em] text-blue-300/80 font-mono">{children}</span>
    </div>
  );
}

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current,
      { y: 24, opacity: 0 },
      {
        y: 0, opacity: 1, duration: 0.8, delay,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 88%', once: true },
      }
    );
  }, [delay]);
  return <div ref={ref} className={className}>{children}</div>;
}

/* ═══════════════════════════════════════════════════════════════
   CAPABILITY CARD — four core primitives
   ═══════════════════════════════════════════════════════════════ */
function CapabilityCard({
  num, icon: Icon, title, lede, detail, delay,
}: {
  num: string;
  icon: React.ElementType;
  title: string;
  lede: string;
  detail: string;
  delay: number;
}) {
  return (
    <FadeIn delay={delay} className="group relative">
      <div className="relative p-7 rounded-2xl border border-white/8 bg-white/[0.015] backdrop-blur-sm h-full
                      hover:border-blue-400/30 hover:bg-white/[0.025] transition-all duration-300">
        <div className="flex items-start justify-between mb-5">
          <Icon className="w-7 h-7 text-blue-300" strokeWidth={1.5} />
          <span className="text-[11px] font-mono text-white/30 tabular-nums">{num}</span>
        </div>
        <h3 className="text-xl font-medium text-white mb-2 tracking-tight">{title}</h3>
        <p className="text-[15px] text-white/65 leading-relaxed mb-4">{lede}</p>
        <p className="text-[13px] text-white/40 leading-relaxed font-mono border-t border-white/5 pt-3">
          {detail}
        </p>
      </div>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ARCHITECTURE DIAGRAM — visual stack
   ═══════════════════════════════════════════════════════════════ */
function ArchitectureDiagram() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.015] p-8 md:p-10 backdrop-blur-sm">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 md:gap-3 items-stretch">
        <ArchBlock label="Voice Layer" sub="Tivi" items={['ONNX VAD (Silero v5)', 'Streaming STT', 'Per-utterance TTS', 'Optimized latency / cost that scales to millions of simultaneous users']} />
        <ArchArrow />
        <ArchBlock label="Cortex Engine" sub="Open core" items={['Multi-provider LLM router', 'JSON-stream parser', 'Function-calling loop', 'Background processes']} highlight />
        <ArchArrow />
        <ArchBlock label="Output Surface" sub="Multi-modal" items={['Streaming TTS audio', 'Sandboxed JS exec', 'Knowledge graph writes', 'Visualization widgets']} />
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-[12px] font-mono text-white/50">
        <div className="border-l-2 border-blue-400/40 pl-3">
          <div className="text-white/70 mb-0.5">Storage</div>
          SurrealDB · semantic triples · HNSW vector index · 1536-dim embeddings
        </div>
        <div className="border-l-2 border-blue-400/40 pl-3">
          <div className="text-white/70 mb-0.5">Models</div>
          GPT-5.5 · Claude Opus 4.7 · Gemini 3.1 Pro · BYO API keys, no lock-in
        </div>
        <div className="border-l-2 border-blue-400/40 pl-3">
          <div className="text-white/70 mb-0.5">Interop</div>
          MCP server bundled · bidirectional data portability · works with Claude, Cursor, IDEs
        </div>
        <div className="border-l-2 border-blue-400/40 pl-3">
          <div className="text-white/70 mb-0.5">Deploy</div>
          Open-core (MIT) · self-host docker · or hosted with billing
        </div>
      </div>
    </div>
  );
}

function ArchBlock({ label, sub, items, highlight = false }: {
  label: string; sub: string; items: string[]; highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-5 border transition-colors ${
        highlight
          ? 'border-blue-400/40 bg-blue-500/[0.04]'
          : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="text-white font-medium tracking-tight">{label}</h4>
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-mono">{sub}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-[13px] text-white/60 font-mono leading-relaxed flex items-start gap-2">
            <span className="text-blue-300/60 mt-0.5">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArchArrow() {
  return (
    <div className="hidden md:flex items-center justify-center text-white/20">
      <ArrowRight className="w-5 h-5" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  /* Hero entrance */
  useEffect(() => {
    if (!heroRef.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.hero-eyebrow', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 })
        .fromTo('.hero-line-1', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.3')
        .fromTo('.hero-line-2', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.5')
        .fromTo('.hero-sub',    { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, '-=0.4')
        .fromTo('.hero-cta',    { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1 }, '-=0.3')
        .fromTo('.hero-orb',    { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.2, ease: 'elastic.out(1, 0.7)' }, '-=0.6');
    }, heroRef);
    return () => ctx.revert();
  }, []);

  /* Nav scroll state — rAF-throttled, only writes when state actually flips
     (avoids style-invalidation churn that piles up during smooth-scroll). */
  useEffect(() => {
    let ticking = false;
    let scrolled = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!navRef.current) return;
        const next = window.scrollY > 24;
        if (next !== scrolled) {
          scrolled = next;
          navRef.current.classList.toggle('nav-scrolled', next);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden antialiased">
      {/* ── Global styles ── */}
      <style jsx global>{`
        :root { color-scheme: dark; }
        html { scroll-behavior: smooth; }
        body { font-feature-settings: 'cv11', 'ss01', 'ss03'; }
        .nav-transition {
          transition: background-color 300ms ease, backdrop-filter 300ms ease, border-bottom-color 300ms ease;
        }
        .nav-scrolled {
          background: rgba(0, 0, 0, 0.7) !important;
          backdrop-filter: blur(16px) saturate(160%);
          border-bottom-color: rgba(255,255,255,0.06) !important;
        }
        .text-gradient {
          background: linear-gradient(110deg, #ffffff 0%, #e0ecff 40%, #63a2ff 75%, #ffffff 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shine 8s linear infinite;
        }
        @keyframes shine {
          to { background-position: -200% center; }
        }
        .grid-bg {
          background-image:
            linear-gradient(rgba(99,162,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,162,255,0.04) 1px, transparent 1px);
          background-size: 40px 40px;
          background-position: -1px -1px;
          mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, black 40%, transparent 100%);
        }
        /* Override globals.css "a { color: inherit }" for landing CTAs.
           Without this, white-background CTAs render their text invisible
           (anchor inherits white from the page wrapper). */
        .cta-light { color: #000 !important; }
        .cta-light:hover { color: #000 !important; }

        /* SmartChats mark: continuous counter-rotation. The original app's
           24s alternating animation has long idle periods; for marketing it
           reads as "stopped." Simple continuous spin always reads as alive. */
        @keyframes sc-mark-s-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes sc-mark-c-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        /* Isolate the mark so the rotating SVG never invalidates the fixed
           nav's backdrop-filter region (the main source of scroll jitter). */
        .sc-mark-wrap {
          contain: layout paint style;
          isolation: isolate;
          transform: translateZ(0);
        }
        .sc-s-spin,
        .sc-c-spin {
          transform-box: view-box;
          transform-origin: 50% 50%;
          will-change: transform;
          backface-visibility: hidden;
        }
        .sc-s-spin { animation: sc-mark-s-rotate 11s linear infinite; }
        .sc-c-spin { animation: sc-mark-c-rotate 15s linear infinite; }
      `}</style>

      {/* ─────────────────────────────────────────────────────────
         NAV
         ───────────────────────────────────────────────────────── */}
      <nav
        ref={navRef}
        className="fixed top-0 inset-x-0 z-50 border-b border-transparent nav-transition"
      >
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <a href="#" className="flex items-center gap-2.5 group">
              <SmartChatsMark size={28} />
              <span className="text-[15px] font-medium tracking-tight">smartchats<span className="text-blue-400">.ai</span></span>
            </a>

            <div className="hidden md:flex items-center gap-7 text-[13px] text-white/60">
              <a href="#demo" className="hover:text-white transition-colors">Demo</a>
              <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
              <a href="#roadmap" className="hover:text-white transition-colors">Roadmap</a>
              <a href="#why" className="hover:text-white transition-colors">Why now</a>
              <a href="#founder" className="hover:text-white transition-colors">Founder</a>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="mailto:shay@sattvicsystems.com?subject=SmartChats%20demo%20request"
                className="cta-light inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-white text-[13px] font-medium hover:bg-blue-100 transition-colors"
              >
                Demo on request
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* ─────────────────────────────────────────────────────────
         HERO
         ───────────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative pt-32 pb-24 md:pt-40 md:pb-32 px-6 overflow-hidden"
      >
        {/* Background layers */}
        <div className="absolute inset-0 grid-bg pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none">
          <VoiceWave className="absolute inset-0 opacity-50" intensity={1} />
        </div>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Eyebrow */}
          <div className="hero-eyebrow inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/[0.03] mb-8">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/70 font-mono">Stealth stage · Voice-native AI</span>
          </div>

          {/* Headline */}
          <h1 className="mb-8">
            <span className="hero-line-1 block text-[clamp(2.25rem,6.5vw,5rem)] font-semibold tracking-tight leading-[1.04] text-white">
              The future of agentic
            </span>
            <span className="hero-line-1 block text-[clamp(2.25rem,6.5vw,5rem)] font-semibold tracking-tight leading-[1.04] text-white">
              voice experiences.
            </span>
            <span className="hero-line-2 block text-[clamp(2.25rem,6.5vw,5rem)] font-semibold tracking-tight leading-[1.04] text-gradient mt-1">
              Now.
            </span>
          </h1>

          {/* Sub */}
          <p className="hero-sub text-lg md:text-xl text-white/70 max-w-2xl mx-auto mb-4 leading-relaxed">
            <span className="text-white font-medium">SmartChats</span> is an open source voice-native AI platform.
          </p>
          <p className="hero-sub text-base md:text-lg text-white/55 max-w-2xl mx-auto mb-12 leading-relaxed">
            Voice in. Code, charts, web answers, and persistent knowledge — out.
            SmartChats turns conversation into a computing surface that gets smarter every time you use it.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-20">
            <a
              href="mailto:shay@sattvicsystems.com?subject=SmartChats%20demo%20request"
              className="hero-cta cta-light group inline-flex items-center gap-2 px-6 py-3 rounded-md bg-white text-sm font-medium hover:bg-blue-100 transition-all"
            >
              Request a demo
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#architecture"
              className="hero-cta inline-flex items-center gap-2 px-6 py-3 rounded-md border border-white/15 text-white/80 text-sm font-medium hover:bg-white/5 hover:text-white transition-all"
            >
              See the architecture
            </a>
          </div>

          {/* Voice orb */}
          <div className="hero-orb flex justify-center">
            <VoiceOrb size={130} />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         DEMO
         ───────────────────────────────────────────────────────── */}
      <section id="demo" className="px-6 py-24 md:py-32 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-14 max-w-2xl mx-auto">
            <SectionLabel>What it does</SectionLabel>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-4">
              One sentence in. <span className="text-white/50">Code, charts, memory, voice — out.</span>
            </h2>
            <p className="text-white/60 text-base md:text-lg leading-relaxed">
              No toolbars, no copy-paste between apps. You speak. SmartChats decides which capability to invoke, runs it, shows the result, and speaks the answer back.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <ProductDemo />
          </FadeIn>

          <FadeIn delay={0.2} className="text-center mt-8">
            <p className="text-white/40 text-xs font-mono">
              recorded session · loops automatically · live demo on request — <a href="mailto:shay@sattvicsystems.com?subject=SmartChats%20demo%20request" className="text-blue-300/80 hover:text-blue-300 transition-colors">shay@sattvicsystems.com</a>
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         CAPABILITIES — four primitives
         ───────────────────────────────────────────────────────── */}
      <section className="px-6 py-24 md:py-32 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-16 max-w-2xl mx-auto">
            <SectionLabel>How it's different</SectionLabel>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
              Not a chatbot. A computing substrate.
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <CapabilityCard
              num="01"
              icon={Mic}
              title="Voice-native, not bolted on"
              lede="Streaming STT → LLM → TTS pipeline designed end-to-end for real-time conversation. The whole stack is voice-aware."
              detail="ONNX VAD on-device (Silero v5) · streaming TTS · 2-chunk early-split for low first-utterance delay"
              delay={0}
            />
            <CapabilityCard
              num="02"
              icon={Code2}
              title="Sandboxed JavaScript execution"
              lede="The agent doesn't suggest code — it runs it. In a fully isolated iframe sandbox. Output renders alongside the conversation."
              detail="iframe sandbox with proxy membrane · function-call tracking · variable inspection · execution history time-travel"
              delay={0.05}
            />
            <CapabilityCard
              num="03"
              icon={Brain}
              title="Persistent semantic memory"
              lede="Every conversation builds an entity-relation knowledge graph. Embeddings make it searchable. Future conversations are smarter."
              detail="SurrealDB triple store · HNSW vector index · 1536-dim embeddings · multi-hop relation traversal"
              delay={0.1}
            />
            <CapabilityCard
              num="04"
              icon={GitBranch}
              title="Multi-provider, no lock-in"
              lede="Switch between GPT-5.5, Claude Opus 4.7, and Gemini 3.1 Pro mid-conversation. Or bring your own keys and route directly."
              detail="Unified streaming protocol across providers · structured-output coercion · BYO-key support on every plan"
              delay={0.15}
            />
            <div className="md:col-span-2">
              <CapabilityCard
                num="05"
                icon={Plug}
                title="MCP-native interoperability"
                lede="First-class Model Context Protocol support — bidirectional data export and ingestion, third-party tool wiring, and integrations across the agent ecosystem. Your data stays portable; your platform stays composable."
                detail="bundled smartchats-mcp server · cloud → local round-trip data portability · pluggable into any MCP client (Claude, Cursor, IDEs) · MCP tools surface as agent functions automatically"
                delay={0.2}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         ARCHITECTURE
         ───────────────────────────────────────────────────────── */}
      <section id="architecture" className="px-6 py-24 md:py-32 border-t border-white/5 bg-gradient-to-b from-transparent via-blue-950/[0.04] to-transparent">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-14 max-w-2xl mx-auto">
            <SectionLabel>Architecture</SectionLabel>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-4">
              An open-core stack you could read end-to-end.
            </h2>
            <p className="text-white/60 text-base md:text-lg leading-relaxed">
              Voice → orchestration → multi-modal output. Three layers, clearly separated, swappable.
              The full stack — frontend, local server, schema, voice pipeline — ships open-source under MIT,
              so the entire app can be self-hosted. The production cloud backend
              (billing, auth, multi-tenant) stays private, and provides data synchronization across
              all devices for subscribing users.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <ArchitectureDiagram />
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         ROADMAP
         ───────────────────────────────────────────────────────── */}
      <section id="roadmap" className="px-6 py-24 md:py-32 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center mb-16 max-w-2xl mx-auto">
            <SectionLabel>Roadmap</SectionLabel>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-4">
              From stealth to platform.
            </h2>
            <p className="text-white/60 text-base md:text-lg leading-relaxed">
              A focused four-quarter path: ship the open core, layer the hosted product,
              build out the integration ecosystem, then turn the platform into something other apps can embed.
            </p>
          </FadeIn>

          {/* Desktop: horizontal timeline */}
          <div className="hidden md:block relative">
            <div className="absolute top-[44px] left-0 right-0 h-px bg-gradient-to-r from-blue-400/40 via-white/10 to-white/5" />
            <div className="grid grid-cols-4 gap-4 relative">
              <RoadmapMilestone
                marker="●"
                status="current"
                quarter="Now"
                title="Stealth"
                body="Working prototype with full stack operational — voice pipeline, knowledge graph, sandboxed execution, multi-provider LLM routing, and billing infrastructure all live. Active daily development."
                delay={0}
              />
              <RoadmapMilestone
                marker="○"
                status="next"
                quarter="Q2 2026"
                title="Open Core + Hosted"
                body="Open-source the core (MIT). Hosted web app product with managed billing, auth, and infrastructure ships publicly to prosumer users."
                delay={0.08}
              />
              <RoadmapMilestone
                marker="○"
                status="next"
                quarter="Q3 2026"
                title="Integrations + Mobile App"
                body="SmartChats Mobile App launch. Third-party integrations buildout — Gmail, Calendar, X, GitHub, and more — so SmartChats can read, write, and act across the apps where users already live."
                delay={0.16}
              />
              <RoadmapMilestone
                marker="○"
                status="next"
                quarter="Q4 2026"
                title="Enterprise"
                body="Drop-in voice agent SDK for enterprises — a JS / web component lets any external product embed SmartChats' full stack (voice, KG, sandboxed execution) without building it themselves. White-label and self-hosted options for regulated environments."
                delay={0.24}
              />
            </div>
          </div>

          {/* Mobile: vertical stack */}
          <div className="md:hidden space-y-4">
            <RoadmapMilestone marker="●" status="current" quarter="Now" title="Stealth" body="Working prototype with full stack operational — voice pipeline, knowledge graph, sandboxed execution, multi-provider LLM routing, and billing infrastructure all live. Active daily development." delay={0} mobile />
            <RoadmapMilestone marker="○" status="next" quarter="Q2 2026" title="Open Core + Hosted" body="Open-source the core (MIT). Hosted web app product with managed billing, auth, and infrastructure ships publicly to prosumer users." delay={0.05} mobile />
            <RoadmapMilestone marker="○" status="next" quarter="Q3 2026" title="Integrations + Mobile App" body="SmartChats Mobile App launch. Third-party integrations buildout — Gmail, Calendar, X, GitHub, and more — so SmartChats can read, write, and act across the apps where users already live." delay={0.1} mobile />
            <RoadmapMilestone marker="○" status="next" quarter="Q4 2026" title="Enterprise" body="Drop-in voice agent SDK for enterprises — a JS / web component lets any external product embed SmartChats' full stack (voice, KG, sandboxed execution) without building it themselves. White-label and self-hosted options for regulated environments." delay={0.15} mobile />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         WHY NOW
         ───────────────────────────────────────────────────────── */}
      <section id="why" className="px-6 py-24 md:py-32 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="mb-14">
            <SectionLabel>Why now</SectionLabel>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
              Three forcing functions converged in 2025.
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FadeIn delay={0}>
              <WhyNow
                num="i"
                title="Frontier models cleared the conversational quality threshold"
                body="GPT-5, Claude Sonnet 4.5, and Gemini 2.5 are the first generation that can reliably handle multi-turn voice context, structured tool use, and code generation in a single coherent loop."
              />
            </FadeIn>
            <FadeIn delay={0.08}>
              <WhyNow
                num="ii"
                title="On-device inference made always-on voice tractable"
                body="ONNX-runtime VAD models like Silero v5 ship sub-50ms speech detection in the browser. No more push-to-talk; conversation can be ambient."
              />
            </FadeIn>
            <FadeIn delay={0.16}>
              <WhyNow
                num="iii"
                title="Streaming TTS at usable price points"
                body="OpenAI's gpt-4o-mini-tts and equivalents made per-utterance synthesis cheap enough to run continuously. Voice can be the primary output, not a feature."
              />
            </FadeIn>
          </div>

          <FadeIn delay={0.24} className="mt-14 max-w-3xl">
            <p className="text-white/50 text-base leading-relaxed border-l-2 border-blue-400/40 pl-5 italic">
              Voice-as-interface is older than the GUI. What changed is that — for the first time — the
              substrate underneath voice can actually <em>do anything</em>. SmartChats is the bet that
              when those two things meet, the result is a new kind of computer.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         THE BET
         ───────────────────────────────────────────────────────── */}
      <section className="px-6 py-32 border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative max-w-3xl mx-auto text-center">
          <FadeIn>
            <SectionLabel>The bet</SectionLabel>
            <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-8">
              The next great computing interface is <span className="text-gradient">conversational, programmable, voice-native.</span>
            </h2>
            <p className="text-white/60 text-lg md:text-xl leading-relaxed">
              The keyboard didn't replace the punchcard because it was faster — it replaced it because
              it matched how humans think. Voice plus programmable substrate matches how humans think now,
              with a knowledge layer that compounds. That's the platform we're building.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         FOUNDER
         ───────────────────────────────────────────────────────── */}
      <section id="founder" className="px-6 py-24 md:py-32 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <SectionLabel>Founder</SectionLabel>
          </FadeIn>

          <FadeIn delay={0.05} className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10 items-start">
            {/* Founder photo — container matches source aspect (280×386)
                so the photo fills cleanly with no cropping or letterboxing. */}
            <div className="relative">
              <div className="aspect-[280/386] w-full max-w-[200px] rounded-2xl border border-white/10 overflow-hidden">
                <img
                  src="/sheun.png"
                  alt="Sheun Aluko, MD, MS"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-1">
                Sheun Aluko, <span className="text-white/60 font-medium">MD, MS</span>
              </h2>
              <p className="text-blue-300/80 font-mono text-sm tracking-wide mb-5">Founder & CEO</p>
              <div className="space-y-4 text-white/70 text-base leading-relaxed">
                {/* TODO: edit founder bio inline. Current copy is a strong default;
                          swap any clause that's not exactly true. */}
                <p>
                  Sheun is a software engineer building at the intersection of voice, AI, and personal
                  computing. SmartChats is the convergence of years spent shipping production AI systems
                  and a personal frustration with how much of human cognition still happens at a keyboard.
                </p>
                <p>
                  The product is built solo, end-to-end: the voice pipeline (Tivi), the agent engine
                  (Cortex), the knowledge graph layer, the sandboxed execution environment, the
                  multi-provider routing, the billing system. Every part is shipping.
                </p>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-4 text-sm">
                <a
                  href="mailto:shay@sattvicsystems.com"
                  className="inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <Send className="w-4 h-4" />
                  shay@sattvicsystems.com
                </a>
                <span className="text-white/20">·</span>
                <a
                  href="https://www.linkedin.com/in/sheun-aluko/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <Linkedin className="w-4 h-4" />
                  LinkedIn
                </a>
                <span className="text-white/20">·</span>
                <a
                  href="mailto:shay@sattvicsystems.com?subject=SmartChats%20demo%20request"
                  className="inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Demo on request
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         FINAL CTA
         ───────────────────────────────────────────────────────── */}
      <section className="px-6 py-32 border-t border-white/5 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/[0.06] blur-[120px] rounded-full pointer-events-none" />
        <div className="relative max-w-3xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-7">
              Talk to it.
            </h2>
            <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
              The fastest way to understand SmartChats is to say something to it.
              Live demos by request — partners, investors, and program reviewers get
              a guided walkthrough plus access to a working session.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="mailto:shay@sattvicsystems.com?subject=SmartChats%20demo%20request"
                className="cta-light group inline-flex items-center gap-2 px-7 py-3.5 rounded-md bg-white text-sm font-medium hover:bg-blue-100 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Request a demo
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="mailto:shay@sattvicsystems.com"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-md border border-white/15 text-white/80 text-sm font-medium hover:bg-white/5 hover:text-white transition-all"
              >
                Talk to founder
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────
         FOOTER
         ───────────────────────────────────────────────────────── */}
      <footer className="px-6 py-10 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-[13px] text-white/40">
          <div className="flex items-center gap-2.5">
            <SmartChatsMark size={20} />
            <span>smartchats.ai · &copy; {new Date().getFullYear()} Sattvic Systems</span>
          </div>
          <div className="flex items-center gap-5 font-mono text-[12px]">
            <a href="#demo" className="hover:text-white/80 transition-colors">demo</a>
            <a href="#architecture" className="hover:text-white/80 transition-colors">architecture</a>
            <a href="#founder" className="hover:text-white/80 transition-colors">founder</a>
            <a
              href="https://github.com/sheunaluko/smartchats"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-white/80 transition-colors"
              aria-label="GitHub"
            >
              <Github className="w-3.5 h-3.5" />
              github
            </a>
            <a href="mailto:shay@sattvicsystems.com" className="hover:text-white/80 transition-colors">contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WHY NOW — single card style
   ═══════════════════════════════════════════════════════════════ */
function WhyNow({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div className="group">
      <div className="text-[11px] font-mono text-blue-300/60 mb-4 tracking-widest uppercase">— {num}</div>
      <h3 className="text-xl text-white font-medium tracking-tight mb-3 leading-snug">{title}</h3>
      <p className="text-[15px] text-white/55 leading-relaxed">{body}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ROADMAP MILESTONE — single timeline card
   ═══════════════════════════════════════════════════════════════ */
function RoadmapMilestone({
  marker, status, quarter, title, body, delay, mobile = false,
}: {
  marker: string;
  status: 'current' | 'next';
  quarter: string;
  title: string;
  body: string;
  delay: number;
  mobile?: boolean;
}) {
  const isCurrent = status === 'current';
  return (
    <FadeIn delay={delay} className={mobile ? '' : 'relative'}>
      {!mobile && (
        <div className="flex justify-center mb-6">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] z-10 ${
              isCurrent
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/40'
                : 'bg-black border border-white/15 text-white/30'
            }`}
          >
            {isCurrent ? '' : marker}
          </div>
        </div>
      )}
      <div
        className={`p-6 rounded-xl border transition-colors h-full ${
          isCurrent
            ? 'border-blue-400/40 bg-blue-500/[0.05]'
            : 'border-white/8 bg-white/[0.015]'
        }`}
      >
        <div className="flex items-baseline justify-between mb-3">
          <span className={`text-[10px] uppercase tracking-widest font-mono ${
            isCurrent ? 'text-blue-300' : 'text-white/40'
          }`}>
            {quarter}
          </span>
          {isCurrent && (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400 font-mono">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              live
            </span>
          )}
        </div>
        <h3 className={`text-lg font-medium tracking-tight mb-2 ${isCurrent ? 'text-white' : 'text-white/85'}`}>
          {title}
        </h3>
        <p className="text-[13px] text-white/55 leading-relaxed">{body}</p>
      </div>
    </FadeIn>
  );
}
