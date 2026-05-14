/**
 * Log Explorer — browse, search, edit, and create journal logs.
 *
 * Three-panel UI: filters (category + date + search), scrollable log list,
 * and an editor for viewing/editing/creating entries.
 * Hybrid interaction: tap to browse, voice to search and create.
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

  /* ── Shared form elements ── */
  select, input[type="text"], input[type="date"], input[type="time"] {
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
  .btn-primary {
    background: var(--sc-primary, #238636); color: #fff;
    border-color: transparent;
  }
  .btn-primary:hover { filter: brightness(1.15); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Filters bar ── */
  #filters {
    display: flex; gap: 8px; align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0; flex-wrap: wrap;
  }
  #filters input[type="text"] { flex: 1; min-width: 100px; }

  /* ── Content area ── */
  #content { display: flex; flex: 1; overflow: hidden; }

  /* ── Log List ── */
  #log-list-panel {
    width: 45%; min-width: 200px; max-width: 400px;
    overflow-y: auto; border-right: 1px solid var(--sc-border, #30363d);
    display: flex; flex-direction: column;
  }
  #log-count {
    padding: 6px 12px; font-size: 10px;
    color: var(--sc-text-muted, #8b949e);
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0;
  }
  #log-list { flex: 1; overflow-y: auto; }
  .log-item {
    padding: 10px 12px; cursor: pointer;
    border-bottom: 1px solid var(--sc-border, #30363d);
    transition: background 0.12s;
  }
  .log-item:hover { background: var(--sc-surface, #161b22); }
  .log-item.selected {
    background: var(--sc-surface-alt, #1c2128);
    border-left: 3px solid var(--sc-primary, #58a6ff);
    padding-left: 9px;
  }
  .log-meta {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 4px;
  }
  .log-category {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--sc-accent, #58a6ff);
  }
  .log-date { font-size: 10px; color: var(--sc-text-muted, #8b949e); }
  .log-preview {
    font-size: 12px; color: var(--sc-text-muted, #8b949e);
    line-height: 1.5;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .log-item.expanded .log-preview {
    -webkit-line-clamp: unset; display: block;
  }
  #log-list-empty {
    padding: 40px 20px; text-align: center;
    color: var(--sc-text-muted, #8b949e); font-size: 12px;
  }

  /* ── Editor ── */
  #editor-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #editor-empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--sc-text-muted, #484f58); font-size: 13px;
  }
  #editor-form { display: none; flex: 1; flex-direction: column; }
  #editor-fields {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 8px; padding: 12px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
  }
  .field-group { display: flex; flex-direction: column; gap: 3px; }
  .field-group.full { grid-column: 1 / -1; }
  .field-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--sc-text-muted, #8b949e);
  }
  #editor-content { flex: 1; display: flex; flex-direction: column; padding: 12px; }
  #editor-textarea {
    flex: 1; width: 100%; resize: none;
    background: var(--sc-background, #0d1117);
    color: var(--sc-text, #e6edf3);
    border: 1px solid var(--sc-border, #30363d);
    border-radius: 8px;
    padding: 12px; font-size: 13px; font-family: inherit;
    line-height: 1.6; outline: none;
  }
  #editor-textarea:focus { border-color: var(--sc-primary, #58a6ff); }
  #editor-textarea::placeholder { color: var(--sc-text-muted, #484f58); }
  #editor-actions {
    display: flex; gap: 8px; align-items: center;
    padding: 10px 12px;
    border-top: 1px solid var(--sc-border, #30363d);
  }
  #editor-status {
    font-size: 11px; color: var(--sc-text-muted, #8b949e);
    margin-left: auto;
  }
</style>

<!-- Filters -->
<div id="filters">
  <select id="filter-category" onchange="handleFilter()">
    <option value="">All categories</option>
  </select>
  <select id="filter-recency" onchange="handleFilter()">
    <option value="1d">Today</option>
    <option value="3d">3 days</option>
    <option value="1w" selected>This week</option>
    <option value="2w">2 weeks</option>
    <option value="4w">This month</option>
    <option value="12w">3 months</option>
    <option value="">All time</option>
  </select>
  <input id="filter-search" type="text" placeholder="Search logs..." onkeydown="if(event.key==='Enter')handleSearch()" />
  <button class="btn" onclick="handleSearch()">Search</button>
  <button class="btn" onclick="handleClear()">Clear</button>
  <button class="btn" onclick="handleNewLog()">+ New</button>
</div>

<!-- Query Details -->
<div id="query-details" style="border-bottom:1px solid var(--sc-border,#30363d);font-size:11px;">
  <div id="query-toggle" onclick="toggleQueryDetails()" style="padding:4px 12px;cursor:pointer;color:var(--sc-text-muted,#8b949e);display:flex;align-items:center;gap:6px;user-select:none;">
    <span id="query-arrow" style="font-size:9px;">&#9654;</span>
    <span>Query Details</span>
  </div>
  <div id="query-body" style="display:none;padding:6px 12px 8px;background:var(--sc-surface,#161b22);">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="color:var(--sc-text-muted,#8b949e);">Limit:</span>
      <input type="number" id="query-limit" value="500" style="width:70px;" onchange="handleFilter()" />
    </div>
    <div id="query-text" style="font-family:var(--sc-font-mono,monospace);color:var(--sc-text-muted,#8b949e);word-break:break-all;white-space:pre-wrap;"></div>
  </div>
</div>

<!-- Content -->
<div id="content">
  <!-- Log List -->
  <div id="log-list-panel">
    <div id="log-count"></div>
    <div id="log-spinner" style="display:none;padding:30px 20px;text-align:center;color:var(--sc-text-muted,#8b949e);font-size:12px">Loading...</div>
    <div id="log-list"></div>
    <div id="log-list-empty" style="display:none">No logs found</div>
  </div>

  <!-- Editor -->
  <div id="editor-panel">
    <div id="editor-empty">Select a log or create a new one</div>
    <div id="editor-form">
      <div id="editor-fields">
        <div class="field-group">
          <span class="field-label">Category</span>
          <select id="editor-category"></select>
        </div>
        <div class="field-group">
          <span class="field-label">Date</span>
          <input type="date" id="editor-date" />
        </div>
        <div class="field-group">
          <span class="field-label">Time</span>
          <input type="time" id="editor-time" />
        </div>
        <div class="field-group">
          <span class="field-label" id="editor-id-label"></span>
        </div>
      </div>
      <div id="editor-content">
        <textarea id="editor-textarea" placeholder="Write your log entry..."></textarea>
      </div>
      <div id="editor-actions">
        <button class="btn btn-primary" id="btn-save" onclick="handleSave()">Save</button>
        <button class="btn" onclick="handleCancel()">Cancel</button>
        <span id="editor-status"></span>
      </div>
    </div>
  </div>
</div>

<script>
  var state = SmartChats.app.state;

  /* ── Helpers ── */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff/86400000) + 'd ago';
    return d.toLocaleDateString();
  }

  function parseLts(dateStr) {
    // lts is fake-UTC local time — strip the Z and parse as local
    if (!dateStr) return new Date();
    var s = String(dateStr).replace('Z', '');
    return new Date(s);
  }

  function toDateValue(d) {
    // YYYY-MM-DD for input[type=date]
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function toTimeValue(d) {
    // HH:MM for input[type=time]
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  /* ── Render log list ── */
  function renderLogList() {
    var logs = state.logs || [];
    var loading = state.loading;
    var listEl = document.getElementById('log-list');
    var emptyEl = document.getElementById('log-list-empty');
    var spinnerEl = document.getElementById('log-spinner');
    var countEl = document.getElementById('log-count');

    // Spinner
    spinnerEl.style.display = loading ? '' : 'none';
    if (loading) { listEl.innerHTML = ''; emptyEl.style.display = 'none'; countEl.textContent = ''; return; }

    listEl.innerHTML = '';
    var searchQuery = document.getElementById('filter-search').value.trim();
    countEl.textContent = logs.length + ' log' + (logs.length !== 1 ? 's' : '') + (searchQuery ? ' matching "' + searchQuery + '"' : '');

    if (logs.length === 0) { emptyEl.style.display = ''; return; }
    emptyEl.style.display = 'none';

    logs.forEach(function(log) {
      var item = document.createElement('div');
      var isSelected = state.selected_log_id === log.id;
      item.className = 'log-item' + (isSelected ? ' selected' : '');
      item.innerHTML = '<div class="log-meta">'
        + '<span class="log-category">' + (log.category || 'general') + '</span>'
        + '<span class="log-date">' + formatDate(log.lts || log.created_at) + '</span>'
        + '</div>'
        + '<div class="log-preview">' + (log.content || '').replace(/</g, '&lt;') + '</div>';
      item.onclick = function(e) {
        if (e.detail === 2) {
          // Double-click: toggle expand preview
          item.classList.toggle('expanded');
        } else {
          selectLog(log);
        }
      };
      listEl.appendChild(item);
    });
  }

  /* ── Render category dropdowns ── */
  function renderCategories() {
    var cats = state.categories || [];
    var filterSel = document.getElementById('filter-category');
    var editorSel = document.getElementById('editor-category');
    var currentFilter = filterSel.value;
    var currentEditor = editorSel.value;

    filterSel.innerHTML = '<option value="">All categories</option>';
    cats.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.category;
      opt.textContent = c.category + ' (' + c.count + ')';
      filterSel.appendChild(opt);
    });
    filterSel.value = currentFilter;

    editorSel.innerHTML = '';
    var allCats = cats.map(function(c) { return c.category; });
    if (allCats.indexOf('general') === -1) allCats.unshift('general');
    allCats.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      editorSel.appendChild(opt);
    });
    editorSel.value = currentEditor || 'general';
  }

  /* ── Select a log for editing ── */
  function selectLog(log) {
    var d = parseLts(log.lts || log.created_at);
    SmartChats.app.setState({
      selected_log_id: log.id,
      _editing: {
        id: log.id,
        content: log.content || '',
        category: log.category || 'general',
        date: toDateValue(d),
        time: toTimeValue(d),
        is_new: false,
      }
    });
  }

  /* ── Show/hide editor ── */
  function showEditor() {
    var e = state._editing;
    if (!e) return;
    document.getElementById('editor-empty').style.display = 'none';
    var form = document.getElementById('editor-form');
    form.style.display = 'flex';
    document.getElementById('editor-textarea').value = e.content;
    document.getElementById('editor-category').value = e.category;
    document.getElementById('editor-date').value = e.date;
    document.getElementById('editor-time').value = e.time;
    document.getElementById('editor-id-label').textContent = e.is_new ? 'New entry' : '';
    document.getElementById('editor-status').textContent = '';
    document.getElementById('btn-save').textContent = e.is_new ? 'Create' : 'Update';
  }

  function hideEditor() {
    state._editing = null;
    state.selected_log_id = '';
    document.getElementById('editor-empty').style.display = '';
    document.getElementById('editor-form').style.display = 'none';
    renderLogList();
  }

  /* ── Query details toggle ── */
  function toggleQueryDetails() {
    var body = document.getElementById('query-body');
    var arrow = document.getElementById('query-arrow');
    var showing = body.style.display !== 'none';
    body.style.display = showing ? 'none' : '';
    arrow.innerHTML = showing ? '&#9654;' : '&#9660;';
  }

  function renderQueryDetails() {
    var el = document.getElementById('query-text');
    if (el) el.textContent = state._last_query || '';
  }

  /* ── Reactive rendering ── */
  SmartChats.app.onRender(function(state, changed) {
    if (changed.has('logs') || changed.has('selected_log_id') || changed.has('loading')) renderLogList();
    if (changed.has('categories')) renderCategories();
    if (changed.has('_last_query')) renderQueryDetails();
    if (changed.has('_editing') || changed.has('selected_log_id')) {
      if (state._editing) showEditor();
      else hideEditor();
    }
  });

  /* ── Click handlers ── */
  function handleFilter() {
    SmartChats.app.fns.load_logs({}, SmartChats.app, SmartChats.util);
  }

  function handleSearch() {
    var q = document.getElementById('filter-search').value.trim();
    if (q) {
      SmartChats.app.fns.search({ query: q }, SmartChats.app, SmartChats.util);
    } else {
      handleFilter();
    }
  }

  function handleClear() {
    document.getElementById('filter-search').value = '';
    handleFilter();
  }

  function handleNewLog() {
    SmartChats.app.fns.new_log({}, SmartChats.app, SmartChats.util);
  }

  function handleSave() {
    var content = document.getElementById('editor-textarea').value.trim();
    var category = document.getElementById('editor-category').value;
    var date = document.getElementById('editor-date').value;
    var time = document.getElementById('editor-time').value;
    if (!content) return;
    document.getElementById('btn-save').disabled = true;
    document.getElementById('editor-status').textContent = 'Saving...';
    SmartChats.app.fns.save_edit({
      content: content, category: category, date: date, time: time
    }, SmartChats.app, SmartChats.util)
      .then(function() { document.getElementById('btn-save').disabled = false; })
      .catch(function() { document.getElementById('btn-save').disabled = false; });
  }

  function handleCancel() {
    SmartChats.app.setState({ _editing: null, selected_log_id: '' });
  }
</script>
`

// ── App Functions ──

const FN_LOAD_LOGS = `async function(fnArgs, app, util) {
    var catEl = app.dom.getElementById('filter-category');
    var recEl = app.dom.getElementById('filter-recency');
    var limEl = app.dom.getElementById('query-limit');
    var category = catEl && catEl.value !== undefined ? catEl.value : (fnArgs.category || '');
    var recency = recEl && recEl.value !== undefined ? recEl.value : (fnArgs.recency !== undefined ? fnArgs.recency : '1w');
    var limit = limEl ? (Number(limEl.value) || 500) : 500;

    app.setState({ loading: true });

    var params = { limit: limit };
    if (category) params.category = category;
    if (recency) params.recency = recency;

    // Build query description for Query Details panel
    var queryDesc = 'get_recent_logs(' + JSON.stringify(params) + ')';
    app.setState({ _last_query: queryDesc });

    var logs = await util.smartchats.get_recent_logs(params);

    app.setState({
      logs: Array.isArray(logs) ? logs : [],
      filter_category: category,
      filter_recency: recency,
      loading: false,
    });
    await util.update_workspace({ filter_category: category, filter_recency: recency });

    return { count: (app.state.logs || []).length };
}`

const FN_SEARCH = `async function(fnArgs, app, util) {
    var query = fnArgs.query || '';
    if (!query) return { error: 'query is required' };

    app.setState({ loading: true });

    var catEl = app.dom.getElementById('filter-category');
    var limEl = app.dom.getElementById('query-limit');
    var category = catEl ? catEl.value : '';
    var limit = limEl ? (Number(limEl.value) || 500) : 500;
    var params = { text: query, limit: limit };
    if (category) params.category = category;

    app.setState({ _last_query: 'search_logs(' + JSON.stringify(params) + ')' });

    var logs = await util.smartchats.search_logs(params);
    app.setState({ logs: Array.isArray(logs) ? logs : [], loading: false });

    return { count: (app.state.logs || []).length, query: query };
}`

const FN_SELECT_LOG = `async function(fnArgs, app, util) {
    var logId = fnArgs.log_id || fnArgs.id;
    if (!logId) return { error: 'log_id is required' };

    var logs = app.state.logs || [];
    var log = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].id === logId) { log = logs[i]; break; }
    }
    if (!log) return { error: 'Log not found in current list' };

    var d = parseLts(log.lts || log.created_at);
    app.setState({
      selected_log_id: log.id,
      _editing: {
        id: log.id,
        content: log.content || '',
        category: log.category || 'general',
        date: toDateValue(d),
        time: toTimeValue(d),
        is_new: false,
      }
    });
    return { selected: logId, content: log.content, category: log.category };
}`

const FN_SAVE_EDIT = `async function(fnArgs, app, util) {
    var content = fnArgs.content;
    var category = fnArgs.category || 'general';
    var date = fnArgs.date || '';
    var time = fnArgs.time || '';
    if (!content) return { error: 'content is required' };

    var editing = app.state._editing;
    var result;

    if (editing && editing.id && !editing.is_new) {
      // Update existing log
      var params = { id: editing.id, text: content, category: category };
      if (date) { params.date = date; params.time = time || '12:00'; }
      result = await util.smartchats.update_log(params);
    } else {
      // Create new log
      result = await util.smartchats.save_log({ text: content, category: category });
    }

    var statusEl = app.dom.getElementById('editor-status');
    statusEl.textContent = editing && editing.id && !editing.is_new ? 'Updated' : 'Created';
    setTimeout(function() {
      if (statusEl) statusEl.textContent = '';
    }, 2000);

    // Reload the list
    await app.fns.load_logs({}, app, util);

    return result;
}`

const FN_NEW_LOG = `async function(fnArgs, app, util) {
    var now = new Date();
    app.setState({
      selected_log_id: '',
      _editing: {
        id: null,
        content: '',
        category: fnArgs.category || 'general',
        date: toDateValue(now),
        time: toTimeValue(now),
        is_new: true,
      }
    });
    app.dom.getElementById('editor-textarea').focus();
    return { editing: true, is_new: true };
}`

const FN_LOAD_CATEGORIES = `async function(fnArgs, app, util) {
    var cats = await util.smartchats.get_log_categories();
    app.setState({ categories: Array.isArray(cats) ? cats : [] });
    return { count: (app.state.categories || []).length };
}`

// ── Manifest ──

export const logExplorerApp: AppManifest = {
    id: 'log_explorer',
    name: 'Log Explorer',
    version: '1.1.0',
    description: 'Browse, search, edit, and create journal log entries. Filter by category and date range, search by text, and edit entries inline.',
    icon: '📋',
    source: 'builtin',
    categories: ['utility', 'data'],
    tags: ['logs', 'journal', 'search', 'editor', 'builtin'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],

    requested_functions: [
        'get_recent_logs', 'search_logs', 'search_logs_semantic',
        'get_log_categories', 'save_log', 'update_log',
    ],

    html_templates: { main: HTML },

    on_activate: 'on_activate',

    state_schema: {
        filter_category: { type: 'string',  default: '',    description: 'Active category filter', persist: true },
        filter_recency:  { type: 'string',  default: '1w',  description: 'Active recency filter', persist: true },
        selected_log_id: { type: 'string',  default: '',    description: 'Currently selected log ID', persist: false },
        logs:            { type: 'array',   default: [],     description: 'Currently displayed log entries', persist: false },
        categories:      { type: 'array',   default: [],     description: 'Available log categories', persist: false },
        loading:         { type: 'boolean', default: false,  description: 'Whether logs are being loaded', persist: false },
    },

    modules: [{
        id: 'main',
        name: 'Log Explorer',
        position: 60,
        system_msg: `The Log Explorer app is active. The user can browse, search, and edit their journal logs via the app UI. Available functions:
- log_explorer_load_logs: Load/refresh logs with current filters (category, recency). Called automatically on open.
- log_explorer_search: Search logs by text. Pass { query: "search term" }.
- log_explorer_select_log: Select a log for viewing/editing. Pass { log_id: "..." }.
- log_explorer_save_edit: Save a new or edited log. Pass { content: "...", category: "..." }.
- log_explorer_new_log: Open the editor for a new entry. Optionally pass { category: "..." }.
- log_explorer_load_categories: Refresh the category list.
The user can also interact directly via the app UI (tap to select, type to edit, filter dropdowns).`,
        functions: [
            {
                name: 'on_activate',
                description: 'Initialize: load categories and recent logs',
                parameters: null,
                return_type: 'object',
                code: `async function(fnArgs, app, util) {
    await app.fns.load_categories({}, app, util);
    await app.fns.load_logs({}, app, util);
    return { ready: true };
}`,
            },
            {
                name: 'load_logs',
                description: 'Load recent logs with current filter settings (category, recency).',
                parameters: { category: 'string', recency: 'string' },
                return_type: 'object',
                code: FN_LOAD_LOGS,
            },
            {
                name: 'search',
                description: 'Search logs by text substring.',
                parameters: { query: 'string' },
                return_type: 'object',
                code: FN_SEARCH,
            },
            {
                name: 'select_log',
                description: 'Select a log entry for viewing/editing in the editor panel.',
                parameters: { log_id: 'string' },
                return_type: 'object',
                code: FN_SELECT_LOG,
            },
            {
                name: 'save_edit',
                description: 'Save the current editor content. Updates the existing log if editing (content, category, date, time), creates a new one if new.',
                parameters: { content: 'string', category: 'string', date: 'string', time: 'string' },
                return_type: 'object',
                code: FN_SAVE_EDIT,
            },
            {
                name: 'new_log',
                description: 'Open the editor for creating a new log entry.',
                parameters: { category: 'string' },
                return_type: 'object',
                code: FN_NEW_LOG,
            },
            {
                name: 'load_categories',
                description: 'Refresh the list of available log categories.',
                parameters: null,
                return_type: 'object',
                code: FN_LOAD_CATEGORIES,
            },
        ],
    }],

    version_history: [
        { version: '1.0.0', published_at: '2026-04-07T00:00:00.000Z' },
        { version: '1.1.0', published_at: new Date().toISOString() },
    ],
}
