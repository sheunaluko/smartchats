/**
 * Guided Breathing — visual breathing pacer with square path animation.
 * A dot travels clockwise through inhale, hold, exhale, hold phases.
 */

import type { AppManifest, AppPermission } from '../../../core/types/app'
import { DEFAULT_GRANTS } from '../../lib/permissions'

const HTML = `
<style>
  body { display: flex; flex-direction: column; align-items: center; justify-content: center;
         height: 100%; width: 100%; gap: 5vmin; user-select: none;
         padding: 4vmin; }
  .phase { font-size: clamp(18px, 5vmin, 28px); font-weight: 600; color: var(--sc-text);
           min-height: 1.5em; text-align: center; }
  .arena { position: relative; width: min(55vmin, 280px); height: min(55vmin, 280px);
           flex-shrink: 0; }
  .square { position: absolute; inset: 12%; border: 2px solid var(--sc-border); border-radius: 4px; }
  .dot { position: absolute; width: clamp(10px, 3.5vmin, 16px); height: clamp(10px, 3.5vmin, 16px);
         background: var(--sc-accent); border-radius: 50%; transform: translate(-50%, -50%);
         box-shadow: 0 0 12px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
  .label { position: absolute; font-size: clamp(10px, 2.8vmin, 14px); color: var(--sc-text-muted);
           text-align: center; white-space: nowrap; transition: color 0.3s, opacity 0.3s; }
  .label.active { color: var(--sc-accent); font-weight: 600; }
  .label.top    { top: 0; left: 50%; transform: translateX(-50%); }
  .label.right  { right: 0; top: 50%; transform: translateX(50%) translateY(-50%); writing-mode: vertical-rl; }
  .label.bottom { bottom: 0; left: 50%; transform: translateX(-50%); }
  .label.left   { left: 0; top: 50%; transform: translateX(-50%) translateY(-50%); writing-mode: vertical-rl; direction: rtl; }
  .timer { font-size: clamp(12px, 3vmin, 16px); color: var(--sc-text-muted); min-height: 1.2em;
           font-variant-numeric: tabular-nums; }
  .controls { display: flex; gap: 10px; }
  .btn { padding: 10px 24px; border-radius: var(--sc-radius-md, 10px); border: 1px solid var(--sc-border);
         background: var(--sc-surface); color: var(--sc-text); font-size: clamp(13px, 3vmin, 15px);
         cursor: pointer; transition: background 0.15s, transform 0.1s; }
  .btn:active { transform: scale(0.96); }
  .btn.primary { background: var(--sc-primary); color: white;
                 border-color: color-mix(in srgb, var(--sc-primary) 80%, white 20%); }
  .btn.danger { background: var(--sc-danger); color: white;
                border-color: color-mix(in srgb, var(--sc-danger) 80%, white 20%); }
  .stats { font-size: clamp(11px, 2.5vmin, 13px); color: var(--sc-text-muted); opacity: 0.7; }
</style>

<div class="phase" id="phase">Ready</div>
<div class="arena">
  <div class="square"></div>
  <div class="dot" id="dot"></div>
  <div class="label top" id="lbl-inhale">Inhale</div>
  <div class="label right" id="lbl-hold1">Hold</div>
  <div class="label bottom" id="lbl-exhale">Exhale</div>
  <div class="label left" id="lbl-hold2">Hold</div>
</div>
<div class="timer" id="timer"></div>
<div class="controls" id="controls">
  <button class="btn primary" id="startBtn" onclick="handleStart()">Start</button>
</div>
<div class="stats" id="stats"></div>

<script>
  var PHASES = [
    { name: 'Inhale', label: 'lbl-inhale', instruction: 'Inhale through your nose' },
    { name: 'Hold',   label: 'lbl-hold1',  instruction: 'Hold' },
    { name: 'Exhale', label: 'lbl-exhale', instruction: 'Exhale through your mouth' },
    { name: 'Hold',   label: 'lbl-hold2',  instruction: 'Hold' },
  ];

  var timings = [4, 4, 4, 4];
  var running = false;
  var paused = false;
  var phaseIndex = 0;
  var phaseStart = 0;
  var pauseTime = 0;
  var cycles = 0;
  var rafId = null;

  var dot = document.getElementById('dot');
  var phaseEl = document.getElementById('phase');
  var timerEl = document.getElementById('timer');
  var controlsEl = document.getElementById('controls');
  var statsEl = document.getElementById('stats');

  function getCorners() {
    var a = document.querySelector('.arena');
    if (!a) return [[0,0],[1,0],[1,1],[0,1]];
    var w = a.offsetWidth, h = a.offsetHeight;
    var inset = 0.12;
    var l = w * inset, t = h * inset, r = w * (1 - inset), b = h * (1 - inset);
    return [[l, t], [r, t], [r, b], [l, b]];
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function getDotPos(phase, progress) {
    var corners = getCorners();
    var c1 = corners[phase];
    var c2 = corners[(phase + 1) % 4];
    return [lerp(c1[0], c2[0], progress), lerp(c1[1], c2[1], progress)];
  }

  function updateLabels(activeIdx) {
    for (var i = 0; i < PHASES.length; i++) {
      var el = document.getElementById(PHASES[i].label);
      if (i === activeIdx) el.classList.add('active');
      else el.classList.remove('active');
    }
  }

  function renderControls() {
    if (!running) {
      controlsEl.innerHTML = '<button class="btn primary" onclick="handleStart()">Start</button>';
    } else if (paused) {
      controlsEl.innerHTML =
        '<button class="btn primary" onclick="handleResume()">Resume</button>' +
        '<button class="btn danger" onclick="handleStop()">Stop</button>';
    } else {
      controlsEl.innerHTML =
        '<button class="btn" onclick="handlePause()">Pause</button>' +
        '<button class="btn danger" onclick="handleStop()">Stop</button>';
    }
  }

  function tick() {
    if (!running || paused) return;
    var now = performance.now();
    var elapsed = (now - phaseStart) / 1000;
    var dur = timings[phaseIndex];
    var progress = Math.min(elapsed / dur, 1);

    var pos = getDotPos(phaseIndex, progress);
    dot.style.left = pos[0] + 'px';
    dot.style.top = pos[1] + 'px';

    var remaining = Math.max(0, dur - elapsed);
    timerEl.textContent = remaining.toFixed(1) + 's';

    if (progress >= 1) {
      phaseIndex = (phaseIndex + 1) % 4;
      if (phaseIndex === 0) cycles++;
      phaseStart = now;
      phaseEl.textContent = PHASES[phaseIndex].instruction;
      updateLabels(phaseIndex);
      statsEl.textContent = 'Cycles: ' + cycles;
      // Update app.state locally (no workspace push on every frame)
      SmartChats.app.state.cycles = cycles;
      SmartChats.app.state.phase = PHASES[phaseIndex].name;
    }

    rafId = requestAnimationFrame(tick);
  }

  function handleStart() {
    running = true; paused = false; phaseIndex = 0; cycles = 0;
    phaseStart = performance.now();
    phaseEl.textContent = PHASES[0].instruction;
    updateLabels(0);
    renderControls();
    SmartChats.app.state.running = true;
    SmartChats.app.state.paused = false;
    var pos = getDotPos(0, 0);
    dot.style.left = pos[0] + 'px';
    dot.style.top = pos[1] + 'px';
    rafId = requestAnimationFrame(tick);
  }

  function handlePause() {
    paused = true; pauseTime = performance.now();
    phaseEl.textContent = 'Paused';
    SmartChats.app.state.paused = true;
    renderControls();
  }

  function handleResume() {
    var pausedDuration = performance.now() - pauseTime;
    phaseStart += pausedDuration;
    paused = false;
    phaseEl.textContent = PHASES[phaseIndex].instruction;
    SmartChats.app.state.paused = false;
    renderControls();
    rafId = requestAnimationFrame(tick);
  }

  function handleStop() {
    running = false; paused = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    phaseIndex = 0;
    phaseEl.textContent = 'Ready';
    timerEl.textContent = '';
    updateLabels(-1);
    SmartChats.app.state.running = false;
    SmartChats.app.state.paused = false;
    SmartChats.app.state.phase = 'Ready';
    var pos = getDotPos(0, 0);
    dot.style.left = pos[0] + 'px';
    dot.style.top = pos[1] + 'px';
    statsEl.textContent = cycles > 0 ? 'Completed ' + cycles + ' cycles' : '';
    renderControls();
  }

  // Initial dot position
  var initPos = getDotPos(0, 0);
  dot.style.left = initPos[0] + 'px';
  dot.style.top = initPos[1] + 'px';
</script>
`

export const guidedBreathingApp: AppManifest = {
    id: 'guided_breathing',
    name: 'Guided Breathing',
    version: '1.4.0',
    description: 'A visual breathing pacer using a square path animation. A dot travels clockwise through inhale, hold, exhale, hold phases. Tap or ask the agent to start, pause, resume, or stop.',
    icon: '🌬️',
    source: 'builtin',
    categories: ['wellness', 'utility'],
    tags: ['breathing', 'meditation', 'wellness', 'relaxation', 'builtin'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],
    requested_functions: [],

    html_templates: { main: HTML },

    state_schema: {
        running: { type: 'boolean', default: false, description: 'Whether the breathing exercise is active' },
        paused: { type: 'boolean', default: false, description: 'Whether the exercise is paused' },
        phase: { type: 'string', default: 'Ready', description: 'Current phase: Inhale, Hold, Exhale, or Ready' },
        cycles: { type: 'number', default: 0, description: 'Number of completed breathing cycles' },
        timings: { type: 'array', default: [4, 4, 4, 4], description: 'Phase durations in seconds: [inhale, hold1, exhale, hold2]' },
    },

    modules: [{
        id: 'main',
        name: 'Guided Breathing',
        position: 60,
        system_msg: 'A guided breathing app is active. A square path animation shows a dot moving through inhale→hold→exhale→hold phases. The user can tap Start/Pause/Stop buttons directly, or ask you to control the exercise. Use the breathing_ prefixed functions.',
        functions: [
            {
                name: 'start_breathing',
                description: 'Start the breathing exercise',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    handleStart();
    await util.update_workspace({
        running: true, paused: false, phase: 'Inhale', cycles: 0
    });
    return { started: true, timings: app.state.timings || [4,4,4,4] };
}`,
            },
            {
                name: 'pause_breathing',
                description: 'Pause the breathing exercise',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    handlePause();
    await util.update_workspace({ paused: true });
    return { paused: true };
}`,
            },
            {
                name: 'resume_breathing',
                description: 'Resume the paused breathing exercise',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    handleResume();
    await util.update_workspace({ paused: false, running: true });
    return { resumed: true };
}`,
            },
            {
                name: 'stop_breathing',
                description: 'Stop the breathing exercise and reset',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    var c = cycles || 0;
    handleStop();
    await util.update_workspace({ running: false, paused: false, phase: 'Ready', cycles: c });
    return { stopped: true, cycles: c };
}`,
            },
            {
                name: 'set_breathing_timings',
                description: 'Set custom phase durations in seconds. Order: inhale, hold, exhale, hold.',
                parameters: { inhale: 'number', hold1: 'number', exhale: 'number', hold2: 'number' },
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    var t = [
        Number(fnArgs.inhale) || 4,
        Number(fnArgs.hold1) || 4,
        Number(fnArgs.exhale) || 4,
        Number(fnArgs.hold2) || 4
    ];
    if (typeof timings !== 'undefined') {
        timings[0] = t[0]; timings[1] = t[1]; timings[2] = t[2]; timings[3] = t[3];
    }
    app.state.timings = t;
    await util.update_workspace({ timings: t });
    return { timings: t };
}`,
            },
        ],
    }],

    version_history: [{ version: '1.0.0', published_at: new Date().toISOString() }],
}
