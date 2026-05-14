/**
 * Canary — devops dashboard app for platform health validation.
 *
 * Exercises every app platform capability: bridge communication, state management,
 * permissions, data access (metrics, logs, KG), DOM/theme, serialization, and
 * agent multi-call orchestration. Provides real-time observability into its own
 * execution with latency tracking and call logging.
 *
 * All test data uses '__canary_' prefix for easy filtering/cleanup.
 */

import type { AppManifest, AppPermission } from '../../../core/types/app'
import { DEFAULT_GRANTS } from '../../lib/permissions'

// ── HTML Scaffold ──

const HTML = `
<style>
  :root {
    --cn-green: #3fb950;
    --cn-red: #f85149;
    --cn-yellow: #d29922;
    --cn-dim: #484f58;
    --cn-border: #30363d;
    --cn-surface: #161b22;
    --cn-bg: #0d1117;
  }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    display: flex; flex-direction: column;
    background: var(--sc-background, var(--cn-bg));
    color: var(--sc-text, #e6edf3);
    font-family: var(--sc-font-mono, 'SF Mono', 'Fira Code', monospace);
    font-size: 12px;
  }

  /* ── Header ── */
  #header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sc-border, var(--cn-border));
    background: var(--sc-surface, var(--cn-surface));
    flex-shrink: 0;
  }
  #header .title { font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  #health-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--cn-dim);
    flex-shrink: 0;
  }
  #health-dot.healthy { background: var(--cn-green); box-shadow: 0 0 6px var(--cn-green); }
  #health-dot.degraded { background: var(--cn-yellow); box-shadow: 0 0 6px var(--cn-yellow); }
  #health-dot.failing { background: var(--cn-red); box-shadow: 0 0 6px var(--cn-red); }
  #health-label { color: var(--cn-dim); font-size: 11px; }
  #uptime { margin-left: auto; color: var(--cn-dim); font-size: 11px; }

  /* ── Grid ── */
  #grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    flex: 1; overflow: hidden;
    gap: 1px;
    background: var(--sc-border, var(--cn-border));
  }

  .panel {
    background: var(--sc-background, var(--cn-bg));
    padding: 10px 12px;
    overflow-y: auto;
    min-height: 0;
  }
  .panel-title {
    font-size: 10px; font-weight: 600; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--cn-dim);
    margin-bottom: 8px;
  }

  /* ── Stats ── */
  .stat-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .stat-label { color: var(--cn-dim); }
  .stat-value { font-weight: 600; }

  /* ── Call Log ── */
  .log-entry {
    display: flex; gap: 8px; padding: 2px 0;
    font-size: 11px; border-bottom: 1px solid var(--sc-border, var(--cn-border));
  }
  .log-entry .fn-name { color: var(--sc-accent, #58a6ff); min-width: 80px; }
  .log-entry .timing { color: var(--cn-dim); min-width: 50px; text-align: right; }
  .log-entry .status-ok { color: var(--cn-green); }
  .log-entry .status-err { color: var(--cn-red); }

  /* ── Suites ── */
  .suite-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; cursor: pointer; border-radius: 4px;
    transition: background 0.12s;
  }
  .suite-row:hover { background: var(--sc-surface, var(--cn-surface)); }
  .suite-row:active { background: var(--sc-border, var(--cn-border)); }
  .suite-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--cn-dim); flex-shrink: 0;
  }
  .suite-dot.pass { background: var(--cn-green); }
  .suite-dot.fail { background: var(--cn-red); }
  .suite-dot.running { background: var(--cn-yellow); animation: pulse 0.8s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .suite-label { flex: 1; }
  .suite-result { color: var(--cn-dim); font-size: 11px; }

  #run-all-btn {
    display: block; width: 100%; margin-top: 10px;
    padding: 8px; border-radius: 4px;
    border: 1px solid var(--sc-border, var(--cn-border));
    background: var(--sc-surface, var(--cn-surface));
    color: var(--sc-text, #e6edf3);
    font-family: inherit; font-size: 11px; font-weight: 600;
    letter-spacing: 1px; text-transform: uppercase;
    cursor: pointer; transition: background 0.12s;
  }
  #run-all-btn:hover { background: var(--sc-border, var(--cn-border)); }
  #run-all-btn:active { background: #3d444d; }
  #run-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Results ── */
  .test-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 0; font-size: 11px;
  }
  .test-icon { width: 14px; text-align: center; flex-shrink: 0; }
  .test-name { flex: 1; }
  .test-ms { color: var(--cn-dim); min-width: 50px; text-align: right; }
  .test-err { color: var(--cn-red); font-size: 10px; padding-left: 20px; }

  #summary {
    margin-top: 10px; padding-top: 8px;
    border-top: 1px solid var(--sc-border, var(--cn-border));
    font-size: 11px; color: var(--cn-dim);
  }
</style>

<!-- Header -->
<div id="header">
  <span class="title">Canary</span>
  <span id="health-dot"></span>
  <span id="health-label">idle</span>
  <span id="uptime">00:00</span>
</div>

<!-- Grid -->
<div id="grid">
  <!-- Stats -->
  <div class="panel" id="stats-panel">
    <div class="panel-title">Stats</div>
    <div class="stat-row"><span class="stat-label">Calls</span><span class="stat-value" id="call-count">0</span></div>
    <div class="stat-row"><span class="stat-label">Avg Latency</span><span class="stat-value" id="avg-latency">—</span></div>
    <div class="stat-row"><span class="stat-label">Errors</span><span class="stat-value" id="error-count">0</span></div>
  </div>

  <!-- Call Log -->
  <div class="panel" id="call-log-panel">
    <div class="panel-title">Call Log</div>
    <div id="call-log"></div>
  </div>

  <!-- Suites -->
  <div class="panel" id="suites-panel">
    <div class="panel-title">Test Suites</div>
    <div id="suite-list"></div>
    <button id="run-all-btn" onclick="handleRunAll()">Run All</button>
  </div>

  <!-- Results -->
  <div class="panel" id="results-panel">
    <div class="panel-title">Results</div>
    <div id="results-list"></div>
    <div id="summary"></div>
  </div>
</div>

<script>
  /* ── Suite definitions ── */
  var SUITES = [
    { id: 'bridge', label: 'Bridge' },
    { id: 'state', label: 'State' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'data_metrics', label: 'Data: Metrics' },
    { id: 'data_logs', label: 'Data: Logs' },
    { id: 'data_kg', label: 'Data: KG' },
    { id: 'dom_theme', label: 'DOM / Theme' },
    { id: 'serialization', label: 'Serialization' },
  ];

  /* ── Render suite list ── */
  var suiteListEl = document.getElementById('suite-list');
  SUITES.forEach(function(s) {
    var row = document.createElement('div');
    row.className = 'suite-row';
    row.id = 'suite-row-' + s.id;
    row.innerHTML = '<span class="suite-dot" id="suite-dot-' + s.id + '"></span>'
      + '<span class="suite-label">' + s.label + '</span>'
      + '<span class="suite-result" id="suite-res-' + s.id + '"></span>';
    row.onclick = function() { handleRunSuite(s.id); };
    suiteListEl.appendChild(row);
  });

  /* ── Uptime timer ── */
  var startTime = Date.now();
  setInterval(function() {
    var s = Math.floor((Date.now() - startTime) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    document.getElementById('uptime').textContent =
      (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);

  /* ── Render helpers ── */
  function renderStats() {
    var st = SmartChats.app.state;
    document.getElementById('call-count').textContent = st.call_count || 0;
    document.getElementById('error-count').textContent = st.error_count || 0;
    var lats = st.latencies || [];
    if (lats.length > 0) {
      var avg = lats.reduce(function(a,b){return a+b;}, 0) / lats.length;
      document.getElementById('avg-latency').textContent = avg.toFixed(1) + 'ms';
    } else {
      document.getElementById('avg-latency').textContent = '—';
    }
  }

  function renderHealth() {
    var h = SmartChats.app.state.health || 'idle';
    var dot = document.getElementById('health-dot');
    var label = document.getElementById('health-label');
    dot.className = 'health-dot';
    if (h === 'healthy') dot.className += ' healthy';
    else if (h === 'degraded') dot.className += ' degraded';
    else if (h === 'failing') dot.className += ' failing';
    label.textContent = h;
  }

  function renderCallLog() {
    var log = SmartChats.app.state.call_log || [];
    var el = document.getElementById('call-log');
    el.innerHTML = '';
    log.slice(0, 20).forEach(function(entry) {
      var row = document.createElement('div');
      row.className = 'log-entry';
      row.innerHTML = '<span class="fn-name">' + entry.name + '</span>'
        + '<span class="timing">' + (entry.duration_ms != null ? entry.duration_ms.toFixed(1) + 'ms' : '—') + '</span>'
        + '<span class="' + (entry.ok ? 'status-ok' : 'status-err') + '">' + (entry.ok ? 'ok' : 'err') + '</span>';
      el.appendChild(row);
    });
  }

  function renderSuiteStatus(suiteId, result) {
    var dot = document.getElementById('suite-dot-' + suiteId);
    var res = document.getElementById('suite-res-' + suiteId);
    if (!dot || !res) return;
    if (!result) { dot.className = 'suite-dot'; res.textContent = ''; return; }
    if (result.running) { dot.className = 'suite-dot running'; res.textContent = '...'; return; }
    var allPass = result.failed === 0;
    dot.className = 'suite-dot ' + (allPass ? 'pass' : 'fail');
    res.textContent = result.passed + '/' + result.total;
  }

  function renderResults(suiteResult) {
    var el = document.getElementById('results-list');
    if (!suiteResult || !suiteResult.tests) { el.innerHTML = ''; return; }
    el.innerHTML = '';
    suiteResult.tests.forEach(function(t) {
      var row = document.createElement('div');
      row.className = 'test-row';
      row.innerHTML = '<span class="test-icon">' + (t.ok ? '<span style="color:var(--cn-green)">+</span>' : '<span style="color:var(--cn-red)">x</span>') + '</span>'
        + '<span class="test-name">' + t.name + '</span>'
        + '<span class="test-ms">' + (t.ms != null ? t.ms.toFixed(1) + 'ms' : '') + '</span>';
      el.appendChild(row);
      if (t.error) {
        var err = document.createElement('div');
        err.className = 'test-err';
        err.textContent = t.error;
        el.appendChild(err);
      }
    });
  }

  function renderSummary(allResults) {
    var el = document.getElementById('summary');
    if (!allResults) { el.textContent = ''; return; }
    var totalP = 0, totalF = 0, totalMs = 0;
    Object.keys(allResults).forEach(function(k) {
      var r = allResults[k];
      if (r && r.passed != null) { totalP += r.passed; totalF += r.failed; totalMs += (r.duration_ms || 0); }
    });
    el.textContent = 'Total: ' + totalP + '/' + (totalP + totalF) + '  ' + totalMs.toFixed(0) + 'ms';
  }

  function renderAll() {
    renderStats();
    renderHealth();
    renderCallLog();
    var sr = SmartChats.app.state.suite_results || {};
    SUITES.forEach(function(s) { renderSuiteStatus(s.id, sr[s.id]); });
    renderSummary(sr);
  }

  /* ── Reactive rendering ── */
  SmartChats.app.onRender(function(state, changed) {
    if (changed.has('call_count') || changed.has('error_count') || changed.has('latencies')) renderStats();
    if (changed.has('health')) renderHealth();
    if (changed.has('call_log')) renderCallLog();
    if (changed.has('suite_results')) {
      var sr = state.suite_results || {};
      SUITES.forEach(function(s) { renderSuiteStatus(s.id, sr[s.id]); });
      renderSummary(sr);
    }
  });

  /* ── Click handlers ── */
  function handleRunSuite(suiteId) {
    SmartChats.app.fns.run_suite({ suite: suiteId }, SmartChats.app, SmartChats.util);
  }

  function handleRunAll() {
    var btn = document.getElementById('run-all-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';
    SmartChats.app.fns.run_suite({ suite: 'all' }, SmartChats.app, SmartChats.util).then(function() {
      btn.disabled = false;
      btn.textContent = 'Run All';
    }).catch(function() {
      btn.disabled = false;
      btn.textContent = 'Run All';
    });
  }

  renderAll();
</script>
`

// ── Shared test runner helpers (injected into function code) ──

const RUNNER = `
  function _logCall(app, name, t0, ok, err, util) {
    var duration_ms = performance.now() - t0;
    var callCount = (app.state.call_count || 0) + 1;
    var errorCount = (app.state.error_count || 0) + (!ok ? 1 : 0);
    var latencies = app.state.latencies || [];
    if (ok) {
      latencies = latencies.concat([duration_ms]);
      if (latencies.length > 100) latencies = latencies.slice(-100);
    }
    var entry = { name: name, ts: Date.now(), duration_ms: duration_ms, ok: ok };
    if (err) entry.error = String(err);
    var callLog = [entry].concat((app.state.call_log || []).slice(0, 49));

    app.setState({
      call_count: callCount,
      error_count: errorCount,
      latencies: latencies,
      call_log: callLog,
    });

    // Persist stats to workspace for cross-session survival
    if (util) {
      util.update_workspace({
        call_count: callCount,
        error_count: errorCount,
        latencies: latencies,
      });
    }
  }

  async function _runTest(name, fn) {
    var t0 = performance.now();
    try {
      await fn();
      return { name: name, ok: true, ms: performance.now() - t0 };
    } catch(e) {
      return { name: name, ok: false, ms: performance.now() - t0, error: String(e.message || e) };
    }
  }

  function _suiteResult(suite, tests, t0) {
    var passed = tests.filter(function(t){return t.ok;}).length;
    var failed = tests.length - passed;
    return { suite: suite, passed: passed, failed: failed, total: tests.length, duration_ms: performance.now() - t0, tests: tests };
  }

  function _updateHealth(app) {
    var sr = app.state.suite_results || {};
    var keys = Object.keys(sr);
    var health = 'idle';
    if (keys.length > 0) {
      var allPass = keys.every(function(k) { return sr[k] && sr[k].failed === 0; });
      var anyFail = keys.some(function(k) { return sr[k] && sr[k].failed > 0; });
      health = allPass ? 'healthy' : anyFail ? 'degraded' : 'idle';
    }
    app.setState({ health: health });
  }
`

// ── Test suite implementations ──

const SUITE_BRIDGE = `
  async function _suite_bridge(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('echo_roundtrip', async function() {
      var r = await app.fns.echo({ ping: 1, msg: 'hello' }, app, util);
      if (r.ping !== 1 || r.msg !== 'hello') throw new Error('Echo mismatch');
    }));

    tests.push(await _runTest('latency_10x', async function() {
      var times = [];
      for (var i = 0; i < 10; i++) {
        var lt0 = performance.now();
        await util.update_workspace({ __canary_lat_probe: i });
        times.push(performance.now() - lt0);
      }
      var avg = times.reduce(function(a,b){return a+b;},0) / times.length;
      if (avg > 5000) throw new Error('Avg latency ' + avg.toFixed(0) + 'ms exceeds 5s');
    }));

    tests.push(await _runTest('concurrent_3x', async function() {
      var results = await Promise.all([
        util.get_workspace(),
        util.get_workspace(),
        util.get_workspace(),
      ]);
      if (results.length !== 3) throw new Error('Expected 3 results');
      results.forEach(function(r, i) {
        if (typeof r !== 'object') throw new Error('Result ' + i + ' not an object');
      });
    }));

    tests.push(await _runTest('stress_20x', async function() {
      var times = [];
      for (var i = 0; i < 20; i++) {
        var st0 = performance.now();
        await app.fns.echo({ stress: i }, app, util);
        times.push(performance.now() - st0);
      }
      var avg = times.reduce(function(a,b){return a+b;},0) / times.length;
      var max = Math.max.apply(null, times);
      if (max > 10000) throw new Error('Slowest call ' + max.toFixed(0) + 'ms exceeds 10s');
      // Store throughput stats for dashboard
      app.state.__canary_stress = { calls: 20, avg_ms: Math.round(avg*10)/10, max_ms: Math.round(max*10)/10 };
    }));

    return _suiteResult('bridge', tests, t0);
  }
`

const SUITE_STATE = `
  async function _suite_state(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('app_state_rw', async function() {
      app.state.__canary_test_val = 42;
      if (app.state.__canary_test_val !== 42) throw new Error('State write/read failed');
      delete app.state.__canary_test_val;
    }));

    tests.push(await _runTest('workspace_rw', async function() {
      var marker = '__canary_ws_' + Date.now();
      await util.update_workspace({ __canary_test: marker });
      var ws = await util.get_workspace();
      var found = false;
      var keys = Object.keys(ws);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__canary_test') !== -1 && ws[keys[i]] === marker) { found = true; break; }
      }
      if (!found) throw new Error('Workspace write/read failed');
    }));

    tests.push(await _runTest('schema_defaults', async function() {
      if (typeof app.state.call_count !== 'number') throw new Error('call_count not initialized');
      if (!Array.isArray(app.state.call_log)) throw new Error('call_log not initialized');
    }));

    tests.push(await _runTest('workspace_sync_timing', async function() {
      // Write from app, then immediately read back — tests the sync race window
      var syncMarker = '__canary_sync_' + Date.now();
      await util.update_workspace({ __canary_sync_test: syncMarker });
      var ws = await util.get_workspace();
      // Find the value (may be prefixed with app id)
      var found = Object.keys(ws).some(function(k) { return ws[k] === syncMarker; });
      if (!found) throw new Error('Workspace sync: written value not readable immediately');
    }));

    tests.push(await _runTest('persistence_marker', async function() {
      // Write a known value that we can check after deactivate/reactivate
      app.state.__canary_persistence_check = 'persisted_' + Date.now();
      await util.update_workspace({ __canary_persistence_check: app.state.__canary_persistence_check });
    }));

    tests.push(await _runTest('setState_merge', async function() {
      // Verify setState merges and doesn't replace
      app.setState({ __canary_a: 1 });
      app.setState({ __canary_b: 2 });
      if (app.state.__canary_a !== 1) throw new Error('setState lost key a after second call');
      if (app.state.__canary_b !== 2) throw new Error('setState key b not set');
      delete app.state.__canary_a;
      delete app.state.__canary_b;
    }));

    tests.push(await _runTest('onRender_fires', async function() {
      // Verify onRender fires after setState with correct changed keys
      var renderFired = false;
      var receivedChanged = null;
      var prevRender = app._savedRender || null;

      app.onRender(function(state, changed) {
        renderFired = true;
        receivedChanged = changed;
      });

      app.setState({ __canary_render_test: 'hello' });

      // onRender is scheduled via microtask — wait for it
      await new Promise(function(r) { setTimeout(r, 10); });

      if (!renderFired) throw new Error('onRender did not fire after setState');
      if (!receivedChanged || !receivedChanged.has('__canary_render_test')) {
        throw new Error('onRender changed set missing __canary_render_test');
      }

      // Restore previous render function (canary's own renderAll)
      if (prevRender) app.onRender(prevRender);
      delete app.state.__canary_render_test;
    }));

    tests.push(await _runTest('onRender_batches', async function() {
      // Multiple setState calls in same microtask should trigger only one render
      var renderCount = 0;
      app.onRender(function() { renderCount++; });

      app.setState({ __canary_batch_a: 1 });
      app.setState({ __canary_batch_b: 2 });
      app.setState({ __canary_batch_c: 3 });

      // Wait for microtask to flush
      await new Promise(function(r) { setTimeout(r, 10); });

      if (renderCount !== 1) throw new Error('Expected 1 batched render, got ' + renderCount);

      delete app.state.__canary_batch_a;
      delete app.state.__canary_batch_b;
      delete app.state.__canary_batch_c;
    }));

    return _suiteResult('state', tests, t0);
  }
`

const SUITE_PERMISSIONS = `
  async function _suite_permissions(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('util_methods_exist', async function() {
      if (typeof util.update_workspace !== 'function') throw new Error('update_workspace missing');
      if (typeof util.get_workspace !== 'function') throw new Error('get_workspace missing');
      if (typeof util.log !== 'function') throw new Error('log missing');
      if (typeof util.feedback !== 'function') throw new Error('feedback missing');
    }));

    tests.push(await _runTest('smartchats_fns_exist', async function() {
      var expected = ['save_log','get_recent_logs','search_logs','search_logs_semantic','get_log_categories',
                      'save_metric','get_metrics_context','retrieve_metrics',
                      'store_declarative_knowledge','retrieve_declarative_knowledge'];
      var missing = [];
      expected.forEach(function(fn) {
        if (!util.smartchats || typeof util.smartchats[fn] !== 'function') missing.push(fn);
      });
      if (missing.length > 0) throw new Error('Missing: ' + missing.join(', '));
    }));

    tests.push(await _runTest('function_count', async function() {
      var count = util.smartchats ? Object.keys(util.smartchats).length : 0;
      if (count < 10) throw new Error('Expected >= 10 smartchats functions, got ' + count);
    }));

    tests.push(await _runTest('voice_permissions', async function() {
      // Builtin apps get all permissions — verify voice util methods exist
      if (typeof util.user_output !== 'function') throw new Error('user_output missing (voice:tts)');
      if (typeof util.get_user_input !== 'function') throw new Error('get_user_input missing (voice:mic)');
    }));

    return _suiteResult('permissions', tests, t0);
  }
`

const SUITE_DATA_METRICS = `
  async function _suite_data_metrics(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('write_metric', async function() {
      var r = await util.smartchats.save_metric({
        metric_name: '__canary_test',
        value: Date.now() % 1000,
        unit: 'test'
      });
      if (!r) throw new Error('save_metric returned falsy');
    }));

    // Brief delay for DB write propagation
    await new Promise(function(resolve) { setTimeout(resolve, 500); });

    tests.push(await _runTest('read_metric', async function() {
      var r = await util.smartchats.retrieve_metrics({
        metric_name: '__canary_test',
        recency: '1h'
      });
      if (!r || r.row_count < 1) throw new Error('Expected >= 1 row, got ' + (r ? r.row_count : 'null'));
    }));

    return _suiteResult('data_metrics', tests, t0);
  }
`

const SUITE_DATA_LOGS = `
  async function _suite_data_logs(app, util) {
    var t0 = performance.now();
    var tests = [];
    var marker = '__canary_test_' + Date.now();

    tests.push(await _runTest('write_log', async function() {
      var r = await util.smartchats.save_log({ text: marker, category: '__canary' });
      if (!r || !r.saved) throw new Error('save_log failed: ' + JSON.stringify(r));
    }));

    // Brief delay for DB write propagation
    await new Promise(function(resolve) { setTimeout(resolve, 500); });

    tests.push(await _runTest('search_log', async function() {
      var r = await util.smartchats.search_logs({ text: '__canary_test_', category: '__canary' });
      if (!Array.isArray(r)) throw new Error('search_logs returned ' + typeof r + ' instead of array');
      if (r.length < 1) throw new Error('search_logs found 0 results');
    }));

    tests.push(await _runTest('search_semantic', async function() {
      var r = await util.smartchats.search_logs_semantic({ text: 'canary test log entry', limit: 5 });
      if (!Array.isArray(r)) throw new Error('search_logs_semantic returned ' + typeof r + ' instead of array');
      // Semantic search may return 0 results if no embeddings match — just verify the call succeeds
    }));

    return _suiteResult('data_logs', tests, t0);
  }
`

const SUITE_DATA_KG = `
  async function _suite_data_kg(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('write_kg', async function() {
      var r = await util.smartchats.store_declarative_knowledge({
        triples: [['__canary_entity_a', '__canary_tests_with', '__canary_entity_b']]
      });
      if (!r) throw new Error('store_declarative_knowledge returned falsy');
    }));

    // Brief delay for DB write + embedding propagation
    await new Promise(function(resolve) { setTimeout(resolve, 500); });

    tests.push(await _runTest('read_kg', async function() {
      var r = await util.smartchats.retrieve_declarative_knowledge({
        query: '__canary_entity_a __canary_tests_with'
      });
      if (!r) throw new Error('retrieve_declarative_knowledge returned falsy');
    }));

    return _suiteResult('data_kg', tests, t0);
  }
`

const SUITE_DOM_THEME = `
  async function _suite_dom_theme(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('tokens_present', async function() {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--sc-background');
      if (!bg || bg.trim() === '') throw new Error('--sc-background is empty');
    }));

    tests.push(await _runTest('multi_tokens', async function() {
      var tokens = ['--sc-text', '--sc-surface', '--sc-border'];
      var missing = [];
      tokens.forEach(function(t) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(t);
        if (!v || v.trim() === '') missing.push(t);
      });
      if (missing.length > 0) throw new Error('Missing: ' + missing.join(', '));
    }));

    tests.push(await _runTest('dom_manipulation', async function() {
      var el = document.createElement('div');
      el.id = '__canary_dom_test';
      el.textContent = 'test';
      document.body.appendChild(el);
      var found = document.getElementById('__canary_dom_test');
      if (!found) throw new Error('Element not found after append');
      if (found.textContent !== 'test') throw new Error('Content mismatch');
      document.body.removeChild(found);
      if (document.getElementById('__canary_dom_test')) throw new Error('Element not removed');
    }));

    return _suiteResult('dom_theme', tests, t0);
  }
`

const SUITE_SERIALIZATION = `
  async function _suite_serialization(app, util) {
    var t0 = performance.now();
    var tests = [];

    tests.push(await _runTest('nested_object', async function() {
      var r = await app.fns.echo({ nested: {a:{b:{c:{d:{e:42}}}}} }, app, util);
      if (!r.nested || r.nested.a.b.c.d.e !== 42) throw new Error('Nested object corrupted');
    }));

    tests.push(await _runTest('type_handling', async function() {
      var r = await app.fns.echo({ n: null, b: true, s: 'str', arr: [1,2,3], num: 3.14 }, app, util);
      if (r.n !== null) throw new Error('null not preserved');
      if (r.b !== true) throw new Error('boolean not preserved');
      if (r.s !== 'str') throw new Error('string not preserved');
      if (!Array.isArray(r.arr) || r.arr.length !== 3) throw new Error('array not preserved');
      if (r.num !== 3.14) throw new Error('float not preserved');
    }));

    tests.push(await _runTest('depth_limit', async function() {
      var deep = {l1:{l2:{l3:{l4:{l5:{l6:{l7:{l8:{l9:{l10:'deep'}}}}}}}}}};
      var r = await app.fns.echo({ deep: deep }, app, util);
      // Just verify it doesn't crash — depth behavior is implementation-defined
      if (!r.deep) throw new Error('Deep object lost entirely');
    }));

    return _suiteResult('serialization', tests, t0);
  }
`

// ── Orchestration report handler ──

const ORCHESTRATION_REPORT = `
  function _handle_orchestration_report(fnArgs) {
    var chain = fnArgs.chain;
    var total_ms = fnArgs.total_ms;
    var tests = [];

    tests.push({ name: 'chain_length', ok: chain && chain.length === 3, ms: 0,
      error: (!chain || chain.length !== 3) ? 'Expected 3 items, got ' + (chain ? chain.length : 0) : undefined });

    if (chain && chain.length === 3) {
      tests.push({ name: 'seq_order', ok: chain[0].seq === 1 && chain[1].seq === 2 && chain[2].seq === 3, ms: 0,
        error: (chain[0].seq !== 1 || chain[1].seq !== 2 || chain[2].seq !== 3) ? 'Sequence mismatch' : undefined });

      tests.push({ name: 'chain_integrity', ok: chain[1].prev_seq === 1 && chain[2].prev_seq === 2, ms: 0,
        error: (chain[1].prev_seq !== 1 || chain[2].prev_seq !== 2) ? 'Return value chaining broken' : undefined });

      tests.push({ name: 'timing_reasonable', ok: total_ms < 15000, ms: total_ms,
        error: total_ms >= 15000 ? 'Orchestration took ' + total_ms + 'ms (>15s)' : undefined });
    }

    var passed = tests.filter(function(t){return t.ok;}).length;
    return { suite: 'orchestration', passed: passed, failed: tests.length - passed, total: tests.length, duration_ms: total_ms || 0, tests: tests };
  }
`

// ── App Functions ──

const FN_ECHO = `async function(fnArgs, app, util) {
    ${RUNNER}
    var t0 = performance.now();
    try {
      var result = Object.assign({}, fnArgs, { _ts: Date.now() });
      _logCall(app, 'echo', t0, true, null, util);
      return result;
    } catch(e) {
      _logCall(app, 'echo', t0, false, e, util);
      throw e;
    }
}`

const FN_GET_STATUS = `async function(fnArgs, app, util) {
    ${RUNNER}
    var t0 = performance.now();
    try {
      var lats = app.state.latencies || [];
      var avg = lats.length > 0 ? lats.reduce(function(a,b){return a+b;},0) / lats.length : 0;
      var suites = {};
      var sr = app.state.suite_results || {};
      Object.keys(sr).forEach(function(k) {
        suites[k] = sr[k] && sr[k].failed === 0 ? 'pass' : 'fail';
      });
      var result = {
        health: app.state.health || 'idle',
        call_count: app.state.call_count || 0,
        error_count: app.state.error_count || 0,
        avg_latency_ms: Math.round(avg * 10) / 10,
        suites: suites,
        uptime_s: Math.floor((Date.now() - app.state.activated_at) / 1000),
      };
      _logCall(app, 'get_status', t0, true, null, util);
      return result;
    } catch(e) {
      _logCall(app, 'get_status', t0, false, e, util);
      throw e;
    }
}`

const FN_GET_CALL_LOG = `async function(fnArgs, app, util) {
    ${RUNNER}
    var t0 = performance.now();
    try {
      var limit = (fnArgs && fnArgs.limit) || 20;
      var result = (app.state.call_log || []).slice(0, limit);
      _logCall(app, 'get_call_log', t0, true, null, util);
      return result;
    } catch(e) {
      _logCall(app, 'get_call_log', t0, false, e, util);
      throw e;
    }
}`

const FN_RUN_SUITE = `async function(fnArgs, app, util) {
    ${RUNNER}
    ${SUITE_BRIDGE}
    ${SUITE_STATE}
    ${SUITE_PERMISSIONS}
    ${SUITE_DATA_METRICS}
    ${SUITE_DATA_LOGS}
    ${SUITE_DATA_KG}
    ${SUITE_DOM_THEME}
    ${SUITE_SERIALIZATION}
    ${ORCHESTRATION_REPORT}

    var t0 = performance.now();
    var suite = fnArgs.suite || 'all';

    try {
      var runners = {
        bridge: function() { return _suite_bridge(app, util); },
        state: function() { return _suite_state(app, util); },
        permissions: function() { return _suite_permissions(app, util); },
        data_metrics: function() { return _suite_data_metrics(app, util); },
        data_logs: function() { return _suite_data_logs(app, util); },
        data_kg: function() { return _suite_data_kg(app, util); },
        dom_theme: function() { return _suite_dom_theme(app, util); },
        serialization: function() { return _suite_serialization(app, util); },
      };

      if (suite === 'orchestration_report') {
        var orchResult = _handle_orchestration_report(fnArgs);
        var sr = Object.assign({}, app.state.suite_results || {});
        sr.orchestration = orchResult;
        app.setState({ suite_results: sr });
        _updateHealth(app);
        _logCall(app, 'run_suite:orchestration', t0, orchResult.failed === 0, null, util);
        await util.update_workspace({ suite_results: app.state.suite_results, health: app.state.health });
        return orchResult;
      }

      if (suite === 'all') {
        var allResults = {};
        var suiteIds = Object.keys(runners);
        for (var i = 0; i < suiteIds.length; i++) {
          var sid = suiteIds[i];
          var r = await runners[sid]();
          allResults[sid] = r;
        }
        app.setState({ suite_results: allResults });
        _updateHealth(app);
        _logCall(app, 'run_suite:all', t0, true, null, util);
        await util.update_workspace({ suite_results: app.state.suite_results, health: app.state.health });
        return { suite: 'all', results: allResults, health: app.state.health };
      }

      if (!runners[suite]) throw new Error('Unknown suite: ' + suite);

      var result = await runners[suite]();
      var sr2 = Object.assign({}, app.state.suite_results || {});
      sr2[suite] = result;
      app.setState({ suite_results: sr2 });
      _updateHealth(app);
      _logCall(app, 'run_suite:' + suite, t0, result.failed === 0, null, util);
      await util.update_workspace({ suite_results: app.state.suite_results, health: app.state.health });
      return result;
    } catch(e) {
      _logCall(app, 'run_suite:' + suite, t0, false, e, util);
      throw e;
    }
}`

// ── Manifest ──

export const canaryApp: AppManifest = {
    id: 'canary',
    name: 'Canary',
    version: '1.3.0',
    description: 'Platform health dashboard. Validates every app platform layer: bridge, state, permissions, data access (metrics, logs, KG), DOM/theme, serialization, and agent orchestration. DevOps-style UI with real-time latency tracking and test runner.',
    icon: '🐤',
    source: 'builtin',
    categories: ['devops', 'testing'],
    tags: ['canary', 'testing', 'platform', 'builtin', 'reference'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],

    requested_functions: [
        'save_log', 'get_recent_logs', 'search_logs', 'search_logs_semantic', 'get_log_categories',
        'save_metric', 'get_metrics_context', 'retrieve_metrics',
        'store_declarative_knowledge', 'retrieve_declarative_knowledge',
    ],

    html_templates: { main: HTML },

    state_schema: {
        health:        { type: 'string',  default: 'idle', description: 'Overall health: idle | healthy | degraded | failing', persist: false },
        suite_results: { type: 'object',  default: {},     description: 'Test results keyed by suite name', persist: false },
        call_log:      { type: 'array',   default: [],     description: 'Recent function call log entries', persist: false },
        call_count:    { type: 'number',  default: 0,      description: 'Total function calls received', persist: false },
        error_count:   { type: 'number',  default: 0,      description: 'Total errors encountered', persist: false },
        latencies:     { type: 'array',   default: [],     description: 'Recent latency measurements (ms)', persist: false },
        activated_at:  { type: 'number',  default: 0,      description: 'Activation timestamp (ms)', persist: false },
    },

    on_activate: 'on_activate',

    modules: [{
        id: 'main',
        name: 'Canary',
        position: 60,
        system_msg: `The Canary devops dashboard app is active. It validates every layer of the app platform. Available functions:
- canary_echo: Returns args unchanged. Use for latency probes and orchestration testing.
- canary_get_status: Returns dashboard snapshot (health, call counts, latencies, suite results).
- canary_get_call_log: Returns recent function call log with timing.
- canary_run_suite: Runs a test suite. Pass { suite: "bridge"|"state"|"permissions"|"data_metrics"|"data_logs"|"data_kg"|"dom_theme"|"serialization"|"all" }.

For orchestration testing, chain multiple echo calls and report results:
var t0 = Date.now();
var e1 = await canary_echo({ seq: 1, ts: Date.now() });
var e2 = await canary_echo({ seq: 2, ts: Date.now(), prev_seq: e1.seq });
var e3 = await canary_echo({ seq: 3, ts: Date.now(), prev_seq: e2.seq });
await canary_run_suite({ suite: 'orchestration_report', chain: [e1, e2, e3], total_ms: Date.now() - t0 });`,
        functions: [
            {
                name: 'on_activate',
                description: 'Initialize the canary dashboard on activation',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    var now = Date.now();
    app.setState({ activated_at: now });
    await util.update_workspace({ activated_at: now });
    return { activated: true };
}`,
            },
            {
                name: 'echo',
                description: 'Returns args unchanged. Use for latency measurement and orchestration testing.',
                parameters: { any: 'object' },
                return_type: 'object',
                code: FN_ECHO,
            },
            {
                name: 'get_status',
                description: 'Returns current dashboard state: health, call counts, avg latency, suite results, uptime.',
                parameters: null,
                return_type: 'object',
                code: FN_GET_STATUS,
            },
            {
                name: 'get_call_log',
                description: 'Returns recent function call log entries with timing data.',
                parameters: { limit: 'number' },
                return_type: 'array',
                code: FN_GET_CALL_LOG,
            },
            {
                name: 'run_suite',
                description: 'Run a test suite or all suites. Returns pass/fail results with timing. Suites: bridge, state, permissions, data_metrics, data_logs, data_kg, dom_theme, serialization, all. Special: orchestration_report (pass chain + total_ms from multi-call test).',
                parameters: { suite: 'string' },
                return_type: 'object',
                code: FN_RUN_SUITE,
            },
            {
                name: 'dom_check',
                description: 'Check DOM state against app state. Returns whether UI elements match the data.',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    var suiteRows = app.dom.querySelectorAll('.suite-row').length;
    var logEntries = app.dom.querySelectorAll('.log-entry').length;
    var healthLabel = app.dom.getElementById('health-label').textContent;
    var callCount = app.dom.getElementById('call-count').textContent;
    var sr = app.state.suite_results || {};
    var suiteCount = Object.keys(sr).length;
    var suiteDots = app.dom.querySelectorAll('.suite-dot.pass, .suite-dot.fail').length;

    return {
      suite_rows: suiteRows,
      log_entries: logEntries,
      health_label: healthLabel,
      health_in_state: app.state.health || 'idle',
      health_match: healthLabel === (app.state.health || 'idle'),
      call_count_displayed: callCount,
      call_count_in_state: app.state.call_count || 0,
      suites_with_results: suiteCount,
      suite_dots_colored: suiteDots,
      suites_match: suiteDots === suiteCount,
    };
}`,
            },
        ],
    }],

    version_history: [
        { version: '1.0.0', published_at: '2026-04-06T00:00:00.000Z' },
        { version: '1.1.0', published_at: '2026-04-06T00:00:00.000Z' },
        { version: '1.2.0', published_at: '2026-04-07T00:00:00.000Z' },
        { version: '1.3.0', published_at: new Date().toISOString() },
    ],
}
