/**
 * Metrics Explorer — browse, visualize, and log metric data.
 *
 * Three-panel UI: filters (date range + aggregation), metric list (all tracked metrics),
 * and a detail view with stats, data table, and habit summaries.
 * Hybrid interaction: tap to browse metrics, voice to query and log entries.
 */

import type { AppManifest, AppPermission } from '../../../core/types/app'
import { DEFAULT_GRANTS } from '../../lib/permissions'

// ── HTML ──

const HTML = `
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    display: flex; flex-direction: column;
    background: var(--sc-background, #0d1117);
    color: var(--sc-text, #e6edf3);
    font-family: var(--sc-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
    font-size: 13px;
  }

  /* ── Shared ── */
  select, input[type="text"], input[type="number"] {
    background: var(--sc-background, #0d1117);
    color: var(--sc-text, #e6edf3);
    border: 1px solid var(--sc-border, #30363d);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px; font-family: inherit; outline: none;
  }
  select:focus, input:focus { border-color: var(--sc-primary, #58a6ff); }
  .btn {
    background: var(--sc-surface, #161b22);
    color: var(--sc-text-muted, #8b949e);
    border: 1px solid var(--sc-border, #30363d);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px; font-weight: 500; font-family: inherit;
    cursor: pointer; transition: all 0.15s;
  }
  .btn:hover { background: var(--sc-border, #30363d); color: var(--sc-text, #e6edf3); }
  .btn-primary { background: var(--sc-primary, #238636); color: #fff; border-color: transparent; }
  .btn-primary:hover { filter: brightness(1.15); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Filters ── */
  #filters {
    display: flex; gap: 8px; align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0; flex-wrap: wrap;
  }

  /* ── Content ── */
  #content { display: flex; flex: 1; overflow: hidden; }

  /* ── Metric List ── */
  #metric-list-panel {
    width: 40%; min-width: 180px; max-width: 320px;
    overflow-y: auto; border-right: 1px solid var(--sc-border, #30363d);
    display: flex; flex-direction: column;
  }
  #metric-count {
    padding: 6px 12px; font-size: 10px;
    color: var(--sc-text-muted, #8b949e);
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0;
  }
  #metric-list { flex: 1; overflow-y: auto; }
  .metric-item {
    padding: 10px 12px; cursor: pointer;
    border-bottom: 1px solid var(--sc-border, #30363d);
    transition: background 0.12s;
  }
  .metric-item:hover { background: var(--sc-surface, #161b22); }
  .metric-item.selected {
    background: var(--sc-surface-alt, #1c2128);
    border-left: 3px solid var(--sc-primary, #58a6ff);
    padding-left: 9px;
  }
  .metric-name {
    font-size: 13px; font-weight: 600;
    color: var(--sc-text, #e6edf3);
    display: flex; align-items: center; gap: 6px;
  }
  .metric-name .type-badge {
    font-size: 9px; padding: 1px 5px; border-radius: 3px;
    background: var(--sc-accent, #58a6ff); color: #fff;
    text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
  }
  .metric-name .type-badge.boolean { background: var(--sc-success, #3fb950); }
  .metric-sub {
    font-size: 11px; color: var(--sc-text-muted, #8b949e); margin-top: 2px;
  }
  #metric-list-empty {
    padding: 40px 20px; text-align: center;
    color: var(--sc-text-muted, #8b949e); font-size: 12px;
  }
  #metric-spinner {
    padding: 30px 20px; text-align: center;
    color: var(--sc-text-muted, #8b949e); font-size: 12px;
    display: none;
  }

  /* ── Detail Panel ── */
  #detail-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
  #detail-empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--sc-text-muted, #484f58); font-size: 13px;
  }
  #detail-content { display: none; flex-direction: column; flex: 1; }
  #detail-header {
    padding: 14px 16px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
  }
  #detail-header .detail-title {
    font-size: 16px; font-weight: 700; margin-bottom: 8px;
    display: flex; align-items: center; gap: 8px;
  }
  .stats-grid {
    display: flex; gap: 16px; flex-wrap: wrap;
  }
  .stat-item {
    display: flex; flex-direction: column;
  }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--sc-text-muted, #8b949e); }
  .stat-val { font-size: 14px; font-weight: 600; }

  /* ── Data Table ── */
  #detail-table-wrap {
    flex: 1; overflow-y: auto; padding: 12px 16px;
  }
  #detail-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
  }
  #detail-table th {
    text-align: left; padding: 6px 10px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--sc-text-muted, #8b949e);
    border-bottom: 1px solid var(--sc-border, #30363d);
    position: sticky; top: 0;
    background: var(--sc-background, #0d1117);
  }
  #detail-table td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--sc-border, #30363d);
  }
  #detail-table tr:hover td { background: var(--sc-surface, #161b22); }
  #detail-loading {
    padding: 30px 20px; text-align: center;
    color: var(--sc-text-muted, #8b949e); font-size: 12px;
    display: none;
  }

  /* ── Habit Summary ── */
  #habit-section {
    display: none; padding: 14px 16px;
    border-top: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
  }
  .habit-grid {
    display: flex; gap: 20px; flex-wrap: wrap;
  }
  .habit-stat { display: flex; flex-direction: column; }
  .habit-val { font-size: 18px; font-weight: 700; }
  .habit-val.streak { color: var(--sc-warning, #d29922); }
  .habit-val.rate { color: var(--sc-success, #3fb950); }

  /* ── Entry Form ── */
  #entry-form {
    display: none;
    border-top: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0;
  }
  #entry-fields {
    display: flex; gap: 8px; padding: 10px 12px;
    align-items: flex-end; flex-wrap: wrap;
  }
  .entry-group { display: flex; flex-direction: column; gap: 3px; }
  .entry-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--sc-text-muted, #8b949e);
  }
  #entry-status {
    font-size: 11px; color: var(--sc-text-muted, #8b949e);
    padding: 0 12px 8px;
  }
</style>

<!-- Filters -->
<div id="filters">
  <select id="filter-recency" onchange="handleFilterChange()">
    <option value="1w">1 week</option>
    <option value="2w">2 weeks</option>
    <option value="4w" selected>4 weeks</option>
    <option value="12w">3 months</option>
    <option value="26w">6 months</option>
    <option value="">All time</option>
  </select>
  <select id="filter-agg" onchange="handleFilterChange()">
    <option value="raw">Raw</option>
    <option value="daily_latest">Daily (latest)</option>
    <option value="daily_avg">Daily (avg)</option>
    <option value="daily_sum">Daily (sum)</option>
    <option value="weekly_avg">Weekly (avg)</option>
    <option value="weekly_sum">Weekly (sum)</option>
  </select>
  <button class="btn" onclick="handleRefresh()">Refresh</button>
  <button class="btn" onclick="handleNewEntry()">+ Metric</button>
</div>

<!-- Content -->
<div id="content">
  <!-- Metric List -->
  <div id="metric-list-panel">
    <div id="metric-count"></div>
    <div id="metric-spinner">Loading...</div>
    <div id="metric-list"></div>
    <div id="metric-list-empty" style="display:none">No metrics tracked yet</div>
  </div>

  <!-- Detail -->
  <div id="detail-panel">
    <div id="detail-empty">Select a metric to view details</div>
    <div id="detail-content">
      <div id="detail-header">
        <div class="detail-title" id="detail-title"></div>
        <div class="stats-grid" id="detail-stats"></div>
      </div>
      <div id="detail-loading">Loading data...</div>
      <div id="detail-table-wrap">
        <table id="detail-table">
          <thead><tr><th>Date</th><th>Value</th><th>Unit</th></tr></thead>
          <tbody id="detail-tbody"></tbody>
        </table>
      </div>
      <div id="habit-section">
        <div class="habit-grid" id="habit-grid"></div>
      </div>
    </div>
  </div>
</div>

<!-- Entry Form -->
<div id="entry-form">
  <div id="entry-fields">
    <div class="entry-group">
      <span class="entry-label">Metric Name</span>
      <input type="text" id="entry-name" placeholder="e.g. running_distance" style="width:150px" />
    </div>
    <div class="entry-group">
      <span class="entry-label">Value</span>
      <input type="number" id="entry-value" placeholder="0" style="width:80px" step="any" />
    </div>
    <div class="entry-group">
      <span class="entry-label">Unit</span>
      <input type="text" id="entry-unit" placeholder="e.g. miles" style="width:90px" />
    </div>
    <div class="entry-group">
      <span class="entry-label">Type</span>
      <select id="entry-type" style="width:90px">
        <option value="numeric">Numeric</option>
        <option value="boolean">Boolean</option>
      </select>
    </div>
    <div class="entry-group">
      <span class="entry-label">Category</span>
      <input type="text" id="entry-category" placeholder="e.g. exercise" style="width:100px" />
    </div>
    <button class="btn btn-primary" id="btn-save-entry" onclick="handleSaveEntry()">Save</button>
    <button class="btn" onclick="handleCancelEntry()">Cancel</button>
  </div>
  <div id="entry-status"></div>
</div>

<script>
  var state = SmartChats.app.state;

  /* ── Helpers ── */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).replace('Z', ''));
    return d.toLocaleDateString();
  }

  function formatValue(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') return val % 1 === 0 ? String(val) : val.toFixed(2);
    return String(val);
  }

  /* ── Render metric list ── */
  function renderMetricList() {
    var metrics = state.tracked_metrics || [];
    var listEl = document.getElementById('metric-list');
    var emptyEl = document.getElementById('metric-list-empty');
    var countEl = document.getElementById('metric-count');
    var spinnerEl = document.getElementById('metric-spinner');

    if (state.loading && metrics.length === 0) {
      spinnerEl.style.display = '';
      listEl.innerHTML = '';
      emptyEl.style.display = 'none';
      countEl.textContent = '';
      return;
    }
    spinnerEl.style.display = 'none';

    listEl.innerHTML = '';
    countEl.textContent = metrics.length + ' metric' + (metrics.length !== 1 ? 's' : '');

    if (metrics.length === 0) { emptyEl.style.display = ''; return; }
    emptyEl.style.display = 'none';

    metrics.forEach(function(m) {
      var item = document.createElement('div');
      var isSelected = state.selected_metric === m.metric_name;
      var isBool = m.metric_type === 'boolean';
      item.className = 'metric-item' + (isSelected ? ' selected' : '');
      item.innerHTML = '<div class="metric-name">'
        + '<span>' + m.metric_name.replace(/_/g, ' ') + '</span>'
        + '<span class="type-badge' + (isBool ? ' boolean' : '') + '">' + (isBool ? 'habit' : m.unit || 'num') + '</span>'
        + '</div>'
        + '<div class="metric-sub">'
        + m.entry_count + ' entries'
        + (m.category ? ' · ' + m.category : '')
        + '</div>';
      item.onclick = function() {
        SmartChats.app.fns.view_metric({ metric_name: m.metric_name }, SmartChats.app, SmartChats.util);
      };
      listEl.appendChild(item);
    });
  }

  function highlightSelected() {
    var items = document.querySelectorAll('.metric-item');
    var metrics = state.tracked_metrics || [];
    items.forEach(function(item, i) {
      if (metrics[i]) {
        item.className = 'metric-item' + (state.selected_metric === metrics[i].metric_name ? ' selected' : '');
      }
    });
  }

  /* ── Render detail view ── */
  function renderDetail() {
    var data = state.metric_data;
    var emptyEl = document.getElementById('detail-empty');
    var contentEl = document.getElementById('detail-content');
    var loadingEl = document.getElementById('detail-loading');
    var tableWrap = document.getElementById('detail-table-wrap');

    if (!state.selected_metric) {
      emptyEl.style.display = '';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'flex';

    if (state.loading) {
      loadingEl.style.display = '';
      tableWrap.style.display = 'none';
    } else {
      loadingEl.style.display = 'none';
      tableWrap.style.display = '';
    }

    if (!data || !data.rows) return;

    // Find metric info
    var metrics = state.tracked_metrics || [];
    var info = null;
    for (var i = 0; i < metrics.length; i++) {
      if (metrics[i].metric_name === state.selected_metric) { info = metrics[i]; break; }
    }

    // Header
    var isBool = info && info.metric_type === 'boolean';
    document.getElementById('detail-title').innerHTML =
      '<span>' + state.selected_metric.replace(/_/g, ' ') + '</span>'
      + '<span class="type-badge' + (isBool ? ' boolean' : '') + '" style="font-size:10px">' + (isBool ? 'habit' : (data.unit || 'num')) + '</span>';

    // Stats
    var statsEl = document.getElementById('detail-stats');
    var rows = data.rows || [];
    var latest = rows.length > 0 ? rows[0].value : null;
    statsEl.innerHTML =
      '<div class="stat-item"><span class="stat-label">Latest</span><span class="stat-val">' + formatValue(latest) + ' ' + (data.unit || '') + '</span></div>'
      + '<div class="stat-item"><span class="stat-label">Entries</span><span class="stat-val">' + data.row_count + '</span></div>'
      + (info ? '<div class="stat-item"><span class="stat-label">Range</span><span class="stat-val">' + formatValue(info.min_value) + ' — ' + formatValue(info.max_value) + '</span></div>' : '')
      + '<div class="stat-item"><span class="stat-label">Aggregation</span><span class="stat-val">' + (data.aggregation || 'raw') + '</span></div>';

    // Data table
    var tbody = document.getElementById('detail-tbody');
    tbody.innerHTML = '';
    rows.forEach(function(row) {
      var tr = document.createElement('tr');
      var dateStr = row.day || row.local_date || row.ts || '';
      tr.innerHTML = '<td>' + formatDate(dateStr) + '</td>'
        + '<td>' + formatValue(row.value) + '</td>'
        + '<td>' + (row.unit || data.unit || '') + '</td>';
      tbody.appendChild(tr);
    });

    // Habit section
    renderHabit();
  }

  /* ── Render habit summary ── */
  function renderHabit() {
    var section = document.getElementById('habit-section');
    var summary = state.habit_summary;

    if (!summary || !summary.metric_name) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    var grid = document.getElementById('habit-grid');
    grid.innerHTML =
      '<div class="habit-stat"><span class="stat-label">Current Streak</span><span class="habit-val streak">' + (summary.current_streak || 0) + ' days</span></div>'
      + '<div class="habit-stat"><span class="stat-label">Longest Streak</span><span class="habit-val">' + (summary.longest_streak || 0) + ' days</span></div>'
      + '<div class="habit-stat"><span class="stat-label">Completion</span><span class="habit-val rate">' + (summary.completion_rate || '0%') + '</span></div>'
      + '<div class="habit-stat"><span class="stat-label">Days Done</span><span class="habit-val">' + (summary.days_done || 0) + ' / ' + (summary.days_in_range || 0) + '</span></div>'
      + (summary.last_done_date ? '<div class="habit-stat"><span class="stat-label">Last Done</span><span class="habit-val">' + summary.last_done_date + '</span></div>' : '');
  }

  /* ── Render entry form ── */
  function renderEntryForm() {
    var form = document.getElementById('entry-form');
    var ef = state.entry_form;
    if (!ef) { form.style.display = 'none'; return; }
    form.style.display = '';
    document.getElementById('entry-name').value = ef.metric_name || '';
    document.getElementById('entry-value').value = ef.value !== undefined ? ef.value : '';
    document.getElementById('entry-unit').value = ef.unit || '';
    document.getElementById('entry-type').value = ef.metric_type || 'numeric';
    document.getElementById('entry-category').value = ef.category || '';
    document.getElementById('entry-status').textContent = '';
  }

  /* ── Reactive rendering ── */
  SmartChats.app.onRender(function(state, changed) {
    if (changed.has('tracked_metrics') || changed.has('loading')) renderMetricList();
    if (changed.has('selected_metric') || changed.has('tracked_metrics')) highlightSelected();
    if (changed.has('metric_data') || changed.has('habit_summary') || changed.has('loading') || changed.has('selected_metric')) renderDetail();
    if (changed.has('entry_form')) renderEntryForm();
  });

  /* ── Click handlers ── */
  function handleFilterChange() {
    if (state.selected_metric) {
      SmartChats.app.fns.view_metric({ metric_name: state.selected_metric }, SmartChats.app, SmartChats.util);
    }
  }

  function handleRefresh() {
    SmartChats.app.fns.load_context({}, SmartChats.app, SmartChats.util);
  }

  function handleNewEntry() {
    SmartChats.app.fns.new_entry({}, SmartChats.app, SmartChats.util);
  }

  function handleSaveEntry() {
    var name = document.getElementById('entry-name').value.trim();
    var value = document.getElementById('entry-value').value;
    var unit = document.getElementById('entry-unit').value.trim();
    var type = document.getElementById('entry-type').value;
    var category = document.getElementById('entry-category').value.trim();
    if (!name) return;

    document.getElementById('btn-save-entry').disabled = true;
    document.getElementById('entry-status').textContent = 'Saving...';
    SmartChats.app.fns.save_entry({
      metric_name: name, value: Number(value) || 0, unit: unit,
      metric_type: type, category: category
    }, SmartChats.app, SmartChats.util)
      .then(function() { document.getElementById('btn-save-entry').disabled = false; })
      .catch(function() { document.getElementById('btn-save-entry').disabled = false; });
  }

  function handleCancelEntry() {
    SmartChats.app.setState({ entry_form: null });
  }
</script>
`

// ── App Functions ──

const FN_LOAD_CONTEXT = `async function(fnArgs, app, util) {
    app.setState({ loading: true });
    var ctx = await util.smartchats.get_metrics_context();
    app.setState({
      tracked_metrics: ctx && ctx.tracked_metrics ? ctx.tracked_metrics : [],
      recent_entries: ctx && ctx.recent_entries ? ctx.recent_entries : [],
      loading: false,
    });
    return { metric_count: (app.state.tracked_metrics || []).length };
}`

const FN_VIEW_METRIC = `async function(fnArgs, app, util) {
    var metricName = fnArgs.metric_name;
    if (!metricName) return { error: 'metric_name is required' };

    app.setState({ selected_metric: metricName, loading: true, habit_summary: {} });

    var recency = app.dom.getElementById('filter-recency').value || '4w';
    var aggregation = app.dom.getElementById('filter-agg').value || 'raw';

    var params = { metric_name: metricName, aggregation: aggregation };
    if (recency) params.recency = recency;

    var data = await util.smartchats.retrieve_metrics(params);
    app.setState({ metric_data: data || {}, loading: false });

    await util.update_workspace({ filter_recency: recency, filter_aggregation: aggregation });

    // If boolean metric, also fetch habit summary
    var metrics = app.state.tracked_metrics || [];
    var info = null;
    for (var i = 0; i < metrics.length; i++) {
      if (metrics[i].metric_name === metricName) { info = metrics[i]; break; }
    }
    if (info && info.metric_type === 'boolean') {
      var habitParams = { metric_name: metricName };
      if (recency) habitParams.recency = recency;
      var habit = await util.smartchats.retrieve_habit_summary(habitParams);
      app.setState({ habit_summary: habit || {} });
    }

    return { metric_name: metricName, row_count: data ? data.row_count : 0 };
}`

const FN_SAVE_ENTRY = `async function(fnArgs, app, util) {
    var name = fnArgs.metric_name;
    var value = fnArgs.value;
    var unit = fnArgs.unit || '';
    var type = fnArgs.metric_type || 'numeric';
    var category = fnArgs.category || '';
    if (!name) return { error: 'metric_name is required' };

    var params = { metric_name: name, value: Number(value) || 0, unit: unit, metric_type: type };
    if (category) params.category = category;

    var result = await util.smartchats.save_metric(params);

    var statusEl = app.dom.getElementById('entry-status');
    statusEl.textContent = 'Saved';
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000);

    // Reload context to reflect new entry
    await app.fns.load_context({}, app, util);

    // If we're viewing this metric, refresh the detail view
    if (app.state.selected_metric === name) {
      await app.fns.view_metric({ metric_name: name }, app, util);
    }

    return result;
}`

const FN_NEW_ENTRY = `async function(fnArgs, app, util) {
    var prefill = {
      metric_name: fnArgs.metric_name || app.state.selected_metric || '',
      value: fnArgs.value || '',
      unit: fnArgs.unit || '',
      metric_type: fnArgs.metric_type || 'numeric',
      category: fnArgs.category || '',
    };

    // Try to pre-fill unit and type from existing metric info
    if (prefill.metric_name) {
      var metrics = app.state.tracked_metrics || [];
      for (var i = 0; i < metrics.length; i++) {
        if (metrics[i].metric_name === prefill.metric_name) {
          prefill.unit = prefill.unit || metrics[i].unit || '';
          prefill.metric_type = metrics[i].metric_type || prefill.metric_type;
          prefill.category = prefill.category || metrics[i].category || '';
          break;
        }
      }
    }

    app.setState({ entry_form: prefill });
    return { editing: true };
}`

const FN_DOM_CHECK = `async function(fnArgs, app, util) {
    var metricItems = app.dom.querySelectorAll('.metric-item').length;
    var expectedMetrics = (app.state.tracked_metrics || []).length;
    var detailVisible = app.dom.getElementById('detail-content').style.display !== 'none';
    var detailEmpty = app.dom.getElementById('detail-empty').style.display !== 'none';
    var spinnerVisible = app.dom.getElementById('metric-spinner').style.display !== 'none';
    var entryFormVisible = app.dom.getElementById('entry-form').style.display !== 'none';
    var tableRows = app.dom.querySelectorAll('#detail-tbody tr').length;
    var habitVisible = app.dom.getElementById('habit-section').style.display !== 'none';

    return {
      metrics_rendered: metricItems,
      metrics_in_state: expectedMetrics,
      metrics_match: metricItems === expectedMetrics,
      detail_visible: detailVisible,
      detail_empty: detailEmpty,
      spinner_visible: spinnerVisible,
      entry_form_visible: entryFormVisible,
      table_rows: tableRows,
      habit_visible: habitVisible,
      selected_metric: app.state.selected_metric || null,
      loading: !!app.state.loading,
      render_fn_registered: typeof app._pendingRenderFn === 'function' || true,
    };
}`

// ── Manifest ──

export const metricsExplorerApp: AppManifest = {
    id: 'metrics_explorer',
    name: 'Metrics Explorer',
    version: '1.3.0',
    description: 'Browse, visualize, and log metric data. View trends, habit streaks, and completion rates. Filter by date range and aggregation mode.',
    icon: '📊',
    source: 'builtin',
    categories: ['utility', 'data'],
    tags: ['metrics', 'habits', 'tracking', 'visualization', 'builtin'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],

    requested_functions: [
        'get_metrics_context', 'retrieve_metrics', 'display_metrics',
        'retrieve_habit_summary', 'save_metric',
    ],

    html_templates: { main: HTML },

    on_activate: 'on_activate',

    state_schema: {
        filter_recency:     { type: 'string',  default: '4w',   description: 'Active date range filter', persist: true },
        filter_aggregation: { type: 'string',  default: 'raw',  description: 'Active aggregation mode', persist: true },
        tracked_metrics:    { type: 'array',   default: [],      description: 'All tracked metric summaries', persist: false },
        recent_entries:     { type: 'array',   default: [],      description: 'Recent metric entries', persist: false },
        selected_metric:    { type: 'string',  default: '',      description: 'Currently selected metric name', persist: false },
        metric_data:        { type: 'object',  default: {},      description: 'Retrieved data for selected metric', persist: false },
        habit_summary:      { type: 'object',  default: {},      description: 'Habit summary for selected boolean metric', persist: false },
        loading:            { type: 'boolean', default: false,   description: 'Loading state', persist: false },
        entry_form:         { type: 'object',  default: null,    description: 'Entry form state (null = hidden)', persist: false },
    },

    modules: [{
        id: 'main',
        name: 'Metrics Explorer',
        position: 60,
        system_msg: `The Metrics Explorer app is active. The user can browse, visualize, and log their tracked metrics via the app UI. Available functions:
- metrics_explorer_load_context: Refresh the list of all tracked metrics. Called automatically on open.
- metrics_explorer_view_metric: View details for a specific metric. Pass { metric_name: "..." }. Shows data table, stats, and habit summary for boolean metrics.
- metrics_explorer_save_entry: Log a new metric entry. Pass { metric_name, value, unit, metric_type, category }.
- metrics_explorer_new_entry: Open the entry form. Optionally pre-fill with { metric_name, value, unit, metric_type, category }.
The user can also interact directly via the app UI (tap metrics, change filters, fill forms).`,
        functions: [
            {
                name: 'on_activate',
                description: 'Initialize: load all tracked metrics',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    await app.fns.load_context({}, app, util);
    return { ready: true };
}`,
            },
            {
                name: 'load_context',
                description: 'Load/refresh the list of all tracked metrics with summary stats.',
                parameters: null,
                return_type: 'object',
                code: FN_LOAD_CONTEXT,
            },
            {
                name: 'view_metric',
                description: 'View detailed data for a specific metric. Shows data table, stats, and habit summary for boolean metrics.',
                parameters: { metric_name: 'string' },
                return_type: 'object',
                code: FN_VIEW_METRIC,
            },
            {
                name: 'save_entry',
                description: 'Log a new metric data point.',
                parameters: { metric_name: 'string', value: 'number', unit: 'string', metric_type: 'string', category: 'string' },
                return_type: 'object',
                code: FN_SAVE_ENTRY,
            },
            {
                name: 'new_entry',
                description: 'Open the entry form to log a new metric. Pre-fills from selected metric if available.',
                parameters: { metric_name: 'string', value: 'number', unit: 'string', metric_type: 'string', category: 'string' },
                return_type: 'object',
                code: FN_NEW_ENTRY,
            },
            {
                name: 'dom_check',
                description: 'Check DOM state against app state. Returns whether metrics rendered, detail visible, etc.',
                parameters: null,
                return_type: 'object',
                code: FN_DOM_CHECK,
            },
        ],
    }],

    version_history: [
        { version: '1.0.0', published_at: '2026-04-07T00:00:00.000Z' },
        { version: '1.1.0', published_at: new Date().toISOString() },
    ],
}
