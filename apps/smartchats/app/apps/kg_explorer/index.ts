/**
 * Knowledge Graph Explorer — builtin app.
 *
 * Browse, search, add, and delete knowledge graph triples.
 * Three views: entity list (default), entity detail, search results.
 *
 * Rendering: setState + onRender reactive pattern.
 * Testing:   dom_check, seed_test_data, cleanup_test_data, auto_kg_explorer_flow.
 */

import type { AppManifest, AppPermission } from '../../../core/types/app'
import { DEFAULT_GRANTS } from '../../lib/permissions'
import { getStarGraphSource } from '../../lib/star_graph'

// ── App Function Code Strings ──

const FN_ON_ACTIVATE = `async function(fnArgs, app, util) {
    app.setState({ loading: true });
    try {
        var entities = await util.smartchats.get_knowledge_graph_entities({});
        app.setState({ entities: entities || [], loading: false, view: 'list' });
    } catch(e) {
        app.setState({ loading: false, error: 'Failed to load entities: ' + (e.message || e) });
    }
    return { activated: true };
}`

const FN_LOAD_ENTITIES = `async function(fnArgs, app, util) {
    app.setState({ loading: true, error: '' });
    try {
        var entities = await util.smartchats.get_knowledge_graph_entities({});
        app.setState({ entities: entities || [], loading: false });
        return { ok: true, count: (entities || []).length };
    } catch(e) {
        app.setState({ loading: false, error: 'Failed to load: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_SELECT_ENTITY = `async function(fnArgs, app, util) {
    var name = fnArgs.entity;
    if (!name) return { ok: false, error: 'entity required' };
    app.setState({ loading: true, error: '' });
    try {
        var detail = await util.smartchats.get_entity_detail({ entity: name });
        app.setState({
            selected: detail.name,
            detail: detail,
            view: 'detail',
            loading: false,
        });
        return { ok: true, name: detail.name, relations: detail.relations.length };
    } catch(e) {
        app.setState({ loading: false, error: 'Failed to load entity: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_BACK_TO_LIST = `async function(fnArgs, app, util) {
    app.setState({ selected: null, detail: null, search_results: null, view: 'list', add_form: null });
    return { ok: true };
}`

const FN_SEARCH = `async function(fnArgs, app, util) {
    var query = fnArgs.query || app.state.search_query;
    if (!query) return { ok: false, error: 'query required' };
    app.setState({ loading: true, search_query: query, error: '' });
    try {
        var formatted = await util.smartchats.retrieve_declarative_knowledge({ query: query, limit: 20 });
        // Parse the formatted text back into structured data
        var entities = [];
        var relations = [];
        var section = '';
        var lines = (formatted || '').split('\\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line === 'Entities:') { section = 'e'; continue; }
            if (line === 'Relations:') { section = 'r'; continue; }
            if (line.startsWith('- ') && section === 'e') {
                var m = line.match(/^- (.+?)\\s*\\(distance: ([\\d.]+)\\)/);
                if (m) entities.push({ name: m[1], distance: parseFloat(m[2]) });
            }
            if (line.startsWith('- ') && section === 'r') {
                var m2 = line.match(/^- (.+?) --\\[(.+?)\\]--> (.+?)(?:\\s*\\(distance: ([\\d.]+)\\))?$/);
                if (m2) relations.push({ sourceName: m2[1], kind: m2[2], targetName: m2[3], distance: m2[4] ? parseFloat(m2[4]) : null });
            }
        }
        var results = { query: query, entities: entities, relations: relations };
        app.setState({ search_results: results, view: 'search', loading: false });
        return { ok: true, entities: entities.length, relations: relations.length };
    } catch(e) {
        app.setState({ loading: false, error: 'Search failed: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_ADD_TRIPLE = `async function(fnArgs, app, util) {
    var subject = fnArgs.subject;
    var relation = fnArgs.relation;
    var object = fnArgs.object;
    if (!subject || !relation || !object) return { ok: false, error: 'subject, relation, and object required' };
    app.setState({ loading: true, error: '' });
    try {
        // If editing, delete the old triple first
        var editing = app.state.add_form && app.state.add_form.editing;
        if (editing) {
            await util.smartchats.delete_declarative_knowledge({ triples: [[editing.source, editing.relation, editing.target]] });
        }
        await util.smartchats.store_declarative_knowledge({ triples: [[subject, relation, object]] });
        app.setState({ add_form: null, loading: false });
        // Reload current view
        if (app.state.view === 'detail' && app.state.selected) {
            var detail = await util.smartchats.get_entity_detail({ entity: app.state.selected });
            app.setState({ detail: detail });
        } else {
            var entities = await util.smartchats.get_knowledge_graph_entities({});
            app.setState({ entities: entities || [] });
        }
        return { ok: true };
    } catch(e) {
        app.setState({ loading: false, error: 'Failed to add: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_DELETE_TRIPLE = `async function(fnArgs, app, util) {
    var source = fnArgs.source;
    var relation = fnArgs.relation;
    var target = fnArgs.target;
    if (!source || !relation || !target) return { ok: false, error: 'source, relation, and target required' };
    app.setState({ loading: true, error: '' });
    try {
        await util.smartchats.delete_declarative_knowledge({ triples: [[source, relation, target]] });
        // Reload detail view
        if (app.state.selected) {
            var detail = await util.smartchats.get_entity_detail({ entity: app.state.selected });
            app.setState({ detail: detail, loading: false });
        } else {
            app.setState({ loading: false });
        }
        return { ok: true };
    } catch(e) {
        app.setState({ loading: false, error: 'Delete failed: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_DELETE_ENTITY = `async function(fnArgs, app, util) {
    var entity = fnArgs.entity || app.state.selected;
    if (!entity) return { ok: false, error: 'entity required' };
    app.setState({ loading: true, error: '' });
    try {
        var result = await util.smartchats.delete_declarative_knowledge({ entity: entity });
        var entities = await util.smartchats.get_knowledge_graph_entities({});
        app.setState({ entities: entities || [], selected: null, detail: null, view: 'list', loading: false });
        return { ok: true, relations_deleted: result.relations_deleted || 0 };
    } catch(e) {
        app.setState({ loading: false, error: 'Delete failed: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_OPEN_ADD_FORM = `async function(fnArgs, app, util) {
    app.setState({ add_form: { subject: fnArgs.subject || '', relation: fnArgs.relation || '', object: fnArgs.object || '', editing: null } });
    return { ok: true };
}`

const FN_EDIT_TRIPLE = `async function(fnArgs, app, util) {
    var source = fnArgs.source;
    var relation = fnArgs.relation;
    var target = fnArgs.target;
    if (!source || !relation || !target) return { ok: false, error: 'source, relation, and target required' };
    app.setState({ add_form: { subject: source, relation: relation, object: target, editing: { source: source, relation: relation, target: target } } });
    return { ok: true };
}`

const FN_DOM_CHECK = `async function(fnArgs, app, util) {
    var view = app.state.view || 'list';
    var entityRows = app.dom.querySelectorAll('.entity-row').length;
    var entitiesInState = (app.state.entities || []).length;

    var detailEl = app.dom.getElementById('entity-detail');
    var detailNameEl = app.dom.getElementById('detail-name');
    var detailEntity = detailNameEl ? detailNameEl.textContent : null;
    var relationRows = app.dom.querySelectorAll('.relation-row').length;
    var detailRelationsInState = app.state.detail ? (app.state.detail.relations || []).length : 0;

    var searchEl = app.dom.getElementById('search-results');
    var searchVisible = searchEl ? searchEl.style.display !== 'none' : false;

    var addForm = app.dom.getElementById('add-form');
    var addFormVisible = addForm ? addForm.style.display !== 'none' : false;

    var emptyEl = app.dom.getElementById('empty');
    var emptyVisible = emptyEl ? emptyEl.style.display !== 'none' : false;

    var statusEl = app.dom.getElementById('status-bar');
    var statusText = statusEl ? statusEl.textContent : '';

    var graphEl = app.dom.getElementById('graph-container');
    var graphVisible = graphEl ? graphEl.style.display !== 'none' : false;

    return {
        view: view,
        entity_count: entityRows,
        entities_in_state: entitiesInState,
        entities_match: entityRows === entitiesInState,
        detail_entity: detailEntity,
        detail_relations: relationRows,
        detail_match: relationRows === detailRelationsInState,
        search_visible: searchVisible,
        add_form_visible: addFormVisible,
        empty_visible: emptyVisible,
        loading: app.state.loading || false,
        status_text: statusText,
        graph_visible: graphVisible,
    };
}`

const FN_SEED_TEST_DATA = `async function(fnArgs, app, util) {
    var triples = [
        ['__simi_alice', 'knows', '__simi_bob'],
        ['__simi_alice', 'works_at', '__simi_acme'],
        ['__simi_bob', 'lives_in', '__simi_paris'],
        ['__simi_alice', 'interested_in', '__simi_cooking'],
        ['__simi_acme', 'located_in', '__simi_nyc'],
    ];
    app.setState({ loading: true, error: '' });
    try {
        await util.smartchats.store_declarative_knowledge({ triples: triples });
        app.setState({ loading: false });
        return { seeded: true, count: triples.length };
    } catch(e) {
        app.setState({ loading: false, error: 'Seed failed: ' + (e.message || e) });
        return { seeded: false, error: e.message || String(e) };
    }
}`

const FN_CLEANUP_TEST_DATA = `async function(fnArgs, app, util) {
    var testEntities = ['__simi_alice', '__simi_bob', '__simi_acme', '__simi_paris', '__simi_cooking', '__simi_nyc', '__simi_jazz'];
    app.setState({ loading: true, error: '' });
    try {
        for (var i = 0; i < testEntities.length; i++) {
            try { await util.smartchats.delete_declarative_knowledge({ entity: testEntities[i] }); } catch(e) { /* ignore */ }
        }
        var entities = await util.smartchats.get_knowledge_graph_entities({});
        app.setState({ entities: entities || [], loading: false });
        return { ok: true, cleaned: testEntities.length };
    } catch(e) {
        app.setState({ loading: false, error: 'Cleanup failed: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

// ── HTML Template ──

const HTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    display: flex; flex-direction: column;
    padding: 4vmin; gap: 3vmin; height: 100%;
    font-family: var(--sc-font, system-ui, sans-serif);
    background: var(--sc-background, #111); color: var(--sc-text, #eee);
  }

  /* Toolbar */
  #toolbar {
    display: flex; gap: 8px; align-items: center;
  }
  #toolbar input[type="text"] {
    flex: 1; padding: 8px 12px; border-radius: var(--sc-radius-md, 8px);
    border: 1px solid var(--sc-border, #333); background: var(--sc-surface, #1a1a1a);
    color: var(--sc-text, #eee); font-size: 14px; outline: none;
  }
  #toolbar input[type="text"]:focus { border-color: var(--sc-accent, #6366f1); }
  .btn {
    padding: 8px 14px; border-radius: var(--sc-radius-md, 8px); border: none;
    background: var(--sc-accent, #6366f1); color: #fff; font-size: 13px;
    cursor: pointer; white-space: nowrap; transition: opacity 0.2s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-muted {
    background: var(--sc-surface-alt, #252525); color: var(--sc-text-muted, #888);
  }
  .btn-danger { background: var(--sc-danger, #ef4444); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  /* Add form */
  #add-form {
    padding: 12px; border-radius: var(--sc-radius-md, 8px);
    border: 1px solid var(--sc-border, #333); background: var(--sc-surface, #1a1a1a);
    display: none;
  }
  #add-form .form-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
  #add-form label { font-size: 12px; color: var(--sc-text-muted, #888); min-width: 60px; }
  #add-form input {
    flex: 1; padding: 6px 10px; border-radius: 6px;
    border: 1px solid var(--sc-border, #333); background: var(--sc-background, #111);
    color: var(--sc-text, #eee); font-size: 13px; outline: none;
  }
  #add-form .form-actions { display: flex; gap: 8px; justify-content: flex-end; }

  /* Scrollable content area */
  #content { flex: 1; overflow-y: auto; }

  /* Entity list */
  #entity-list { display: flex; flex-direction: column; gap: 4px; }
  .entity-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-radius: var(--sc-radius-md, 8px);
    border: 1px solid var(--sc-border, #333); background: var(--sc-surface, #1a1a1a);
    cursor: pointer; transition: all 0.15s;
  }
  .entity-row:hover {
    border-color: var(--sc-accent, #6366f1);
    background: color-mix(in srgb, var(--sc-accent, #6366f1) 6%, var(--sc-surface, #1a1a1a));
  }
  .entity-name { font-size: 14px; color: var(--sc-text, #eee); }
  .entity-count { font-size: 12px; color: var(--sc-text-muted, #888); }
  .entity-arrow { color: var(--sc-text-muted, #888); font-size: 14px; }

  /* Graph container */
  #graph-container {
    width: 100%; height: 280px;
    border-radius: var(--sc-radius-md, 8px);
    border: 1px solid var(--sc-border, #333);
    background: var(--sc-background, #111);
    margin-bottom: 12px; display: none;
    position: relative; overflow: hidden;
  }
  .sigma-container { width: 100% !important; height: 100% !important; position: relative !important; }
  .sigma-container canvas { position: absolute !important; top: 0 !important; left: 0 !important; }

  /* Entity detail */
  #entity-detail { display: none; }
  .detail-header {
    display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  }
  .detail-back {
    font-size: 13px; color: var(--sc-accent, #6366f1); cursor: pointer;
    background: none; border: none; padding: 4px 8px;
  }
  .detail-back:hover { text-decoration: underline; }
  #detail-name {
    font-size: 18px; font-weight: 600; color: var(--sc-text, #eee);
  }
  .relation-list { display: flex; flex-direction: column; gap: 4px; }
  .relation-row {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-radius: var(--sc-radius-md, 8px); border: 1px solid var(--sc-border, #333);
    background: var(--sc-surface, #1a1a1a); font-size: 13px;
  }
  .rel-kind {
    color: var(--sc-accent, #6366f1); font-weight: 500; min-width: 80px;
  }
  .rel-arrow { color: var(--sc-text-muted, #888); }
  .rel-target { color: var(--sc-text, #eee); flex: 1; }
  .rel-source { color: var(--sc-text-muted, #888); font-size: 12px; }
  .rel-edit, .rel-delete {
    background: none; border: none; color: var(--sc-text-muted, #555);
    cursor: pointer; font-size: 14px; padding: 2px 6px; transition: color 0.15s;
  }
  .rel-edit:hover { color: var(--sc-accent, #6366f1); }
  .rel-delete:hover { color: var(--sc-danger, #ef4444); }

  /* Search results */
  #search-results { display: none; }
  .search-section-title {
    font-size: 12px; font-weight: 600; color: var(--sc-text-muted, #888);
    text-transform: uppercase; letter-spacing: 0.5px; margin: 12px 0 6px;
  }
  .search-entity {
    padding: 8px 12px; border-radius: 6px; background: var(--sc-surface, #1a1a1a);
    border: 1px solid var(--sc-border, #333); margin-bottom: 4px;
    display: flex; justify-content: space-between; font-size: 13px;
    cursor: pointer; transition: border-color 0.15s;
  }
  .search-entity:hover { border-color: var(--sc-accent, #6366f1); }
  .search-distance { color: var(--sc-text-muted, #888); font-size: 12px; }
  .search-relation {
    padding: 8px 12px; border-radius: 6px; background: var(--sc-surface, #1a1a1a);
    border: 1px solid var(--sc-border, #333); margin-bottom: 4px; font-size: 13px;
  }

  /* Empty state */
  #empty {
    display: none; text-align: center; padding: 40px 20px;
    color: var(--sc-text-muted, #888); font-size: 14px;
  }

  /* Spinner */
  #spinner {
    display: none; text-align: center; padding: 20px;
    color: var(--sc-text-muted, #888); font-size: 13px;
  }

  /* Status + error bars */
  #status-bar {
    font-size: 12px; color: var(--sc-text-muted, #888);
    text-align: center; padding-top: 4px;
  }
  #error-bar {
    padding: 8px 12px; border-radius: var(--sc-radius-md, 8px);
    background: color-mix(in srgb, var(--sc-danger, #ef4444) 12%, var(--sc-surface, #1a1a1a));
    color: var(--sc-danger, #ef4444); font-size: 13px; display: none;
  }
</style>

<div id="toolbar">
  <input type="text" id="search-input" placeholder="Search knowledge graph..." />
  <button class="btn" onclick="doSearch()">Search</button>
  <button class="btn btn-muted" onclick="callFn('open_add_form')">+ Add</button>
</div>

<div id="add-form">
  <div id="form-title" style="font-size:13px;font-weight:600;color:var(--sc-text,#eee);margin-bottom:8px">Add Triple</div>
  <div class="form-row"><label>Subject</label><input type="text" id="f-subject" /></div>
  <div class="form-row"><label>Relation</label><input type="text" id="f-relation" /></div>
  <div class="form-row"><label>Object</label><input type="text" id="f-object" /></div>
  <div class="form-actions">
    <button class="btn btn-sm btn-muted" onclick="SmartChats.app.setState({add_form:null})">Cancel</button>
    <button class="btn btn-sm" onclick="doAddTriple()">Save</button>
  </div>
</div>

<div id="content">
  <div id="spinner">Loading...</div>
  <div id="empty">No entities in knowledge graph yet.<br>Add some facts to get started.</div>
  <div id="entity-list"></div>
  <div id="entity-detail">
    <div class="detail-header">
      <button class="detail-back" onclick="callFn('back_to_list')">&larr; Back</button>
      <span id="detail-name"></span>
      <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="if(confirm('Delete this entity and all its relations?')) callFn('delete_entity', {entity: SmartChats.app.state.selected})">Delete Entity</button>
    </div>
    <div id="graph-container"></div>
    <div class="relation-list" id="relation-list"></div>
  </div>
  <div id="search-results">
    <div class="detail-header">
      <button class="detail-back" onclick="callFn('back_to_list')">&larr; Back</button>
      <span id="search-title" style="font-size:14px;color:var(--sc-text-muted,#888)"></span>
    </div>
    <div id="search-body"></div>
  </div>
</div>

<div id="status-bar"></div>
<div id="error-bar"></div>

<script>${getStarGraphSource()}</script>

<script>
  // Helper: call an app function with proper (fnArgs, app, util) signature
  function callFn(name, args) {
    return SmartChats.app.fns[name](args || {}, SmartChats.app, SmartChats.util);
  }

  function doSearch() {
    var q = document.getElementById('search-input').value.trim();
    if (q) callFn('search', { query: q });
  }
  document.getElementById('search-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });

  function doAddTriple() {
    var s = document.getElementById('f-subject').value.trim();
    var r = document.getElementById('f-relation').value.trim();
    var o = document.getElementById('f-object').value.trim();
    if (s && r && o) callFn('add_triple', { subject: s, relation: r, object: o });
  }

  function renderEntityList() {
    var list = document.getElementById('entity-list');
    var entities = SmartChats.app.state.entities || [];
    var view = SmartChats.app.state.view || 'list';

    list.style.display = view === 'list' ? 'flex' : 'none';
    document.getElementById('entity-detail').style.display = view === 'detail' ? 'block' : 'none';
    document.getElementById('search-results').style.display = view === 'search' ? 'block' : 'none';

    if (view !== 'list') return;

    var empty = document.getElementById('empty');
    if (entities.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = entities.map(function(e) {
      return '<div class="entity-row" onclick="callFn(\\'select_entity\\',{entity:\\'' + e.name + '\\'})">' +
        '<span class="entity-name">' + e.name + '</span>' +
        '<span><span class="entity-count">' + (e.relation_count || 0) + ' relations</span> ' +
        '<span class="entity-arrow">\\u203A</span></span></div>';
    }).join('');
  }

  function renderDetail() {
    if (SmartChats.app.state.view !== 'detail') return;
    var detail = SmartChats.app.state.detail;
    if (!detail) return;

    document.getElementById('detail-name').textContent = detail.name;
    var rlist = document.getElementById('relation-list');
    var relations = detail.relations || [];

    rlist.innerHTML = relations.map(function(r) {
      var isSource = r.sourceName === detail.name;
      var other = isSource ? r.targetName : r.sourceName;
      var direction = isSource ? '\\u2192' : '\\u2190';
      return '<div class="relation-row">' +
        '<span class="rel-kind">' + r.kind + '</span>' +
        '<span class="rel-arrow">' + direction + '</span>' +
        '<span class="rel-target">' + other + '</span>' +
        '<button class="rel-edit" onclick="callFn(\\'edit_triple\\',{source:\\'' + r.sourceName + '\\',relation:\\'' + r.kind + '\\',target:\\'' + r.targetName + '\\'})">\\u270E</button>' +
        '<button class="rel-delete" onclick="callFn(\\'delete_triple\\',{source:\\'' + r.sourceName + '\\',relation:\\'' + r.kind + '\\',target:\\'' + r.targetName + '\\'})">\\u00D7</button>' +
        '</div>';
    }).join('');
  }

  function renderSearch() {
    if (SmartChats.app.state.view !== 'search') return;
    var results = SmartChats.app.state.search_results;
    if (!results) return;

    document.getElementById('search-title').textContent = 'Search: "' + results.query + '"';
    var body = document.getElementById('search-body');
    var html = '';

    if (results.entities && results.entities.length > 0) {
      html += '<div class="search-section-title">Entities</div>';
      html += results.entities.map(function(e) {
        return '<div class="search-entity" onclick="callFn(\\'select_entity\\',{entity:\\'' + e.name + '\\'})">' +
          '<span>' + e.name + '</span>' +
          '<span class="search-distance">' + (e.distance != null ? e.distance.toFixed(3) : '') + '</span></div>';
      }).join('');
    }

    if (results.relations && results.relations.length > 0) {
      html += '<div class="search-section-title">Relations</div>';
      html += results.relations.map(function(r) {
        return '<div class="search-relation">' +
          '<span>' + r.sourceName + '</span>' +
          ' <span style="color:var(--sc-accent,#6366f1)">[' + r.kind + ']</span> ' +
          '<span>' + r.targetName + '</span>' +
          (r.distance != null ? ' <span class="search-distance">(' + r.distance.toFixed(3) + ')</span>' : '') +
          '</div>';
      }).join('');
    }

    if (!html) html = '<div style="padding:20px;text-align:center;color:var(--sc-text-muted)">No results found</div>';
    body.innerHTML = html;
  }

  function renderStatus() {
    var entities = SmartChats.app.state.entities || [];
    var total = 0;
    entities.forEach(function(e) { total += e.relation_count || 0; });
    // Relations are double-counted (each relation touches two entities)
    var relCount = Math.round(total / 2) || total;
    document.getElementById('status-bar').textContent =
      entities.length + ' entities' + (relCount > 0 ? ' \\u00B7 ' + relCount + ' relations' : '');
  }

  function renderAddForm() {
    var form = document.getElementById('add-form');
    var data = SmartChats.app.state.add_form;
    form.style.display = data ? 'block' : 'none';
    if (data) {
      document.getElementById('form-title').textContent = data.editing ? 'Edit Triple' : 'Add Triple';
      document.getElementById('f-subject').value = data.subject || '';
      document.getElementById('f-relation').value = data.relation || '';
      document.getElementById('f-object').value = data.object || '';
    }
  }

  function renderLoading() {
    var spinner = document.getElementById('spinner');
    spinner.style.display = SmartChats.app.state.loading ? 'block' : 'none';
  }

  function renderError() {
    var bar = document.getElementById('error-bar');
    var err = SmartChats.app.state.error || '';
    if (err) { bar.textContent = err; bar.style.display = 'block'; }
    else { bar.textContent = ''; bar.style.display = 'none'; }
  }

  // ── Graph Visualization (star_graph lib injected via getStarGraphSource) ──
  var starGraph = null;

  function renderGraph() {
    var container = document.getElementById('graph-container');
    var view = SmartChats.app.state.view;

    if (view !== 'detail' || !SmartChats.app.state.detail) {
      container.style.display = 'none';
      if (starGraph) { starGraph.destroy(); starGraph = null; }
      return;
    }

    if (typeof graphology === 'undefined' || typeof Sigma === 'undefined' || typeof createStarGraph === 'undefined') {
      container.style.display = 'none';
      return;
    }

    var detail = SmartChats.app.state.detail;
    var relations = detail.relations || [];
    if (relations.length === 0) { container.style.display = 'none'; return; }

    container.style.display = 'block';

    if (starGraph) { starGraph.destroy(); starGraph = null; }

    // Read theme from CSS vars
    var s = getComputedStyle(document.documentElement);
    var accent = s.getPropertyValue('--sc-accent').trim() || '#6366f1';
    var bg = s.getPropertyValue('--sc-background').trim() || '#0d1117';
    var border = s.getPropertyValue('--sc-border').trim() || '#333';
    var textMuted = s.getPropertyValue('--sc-text-muted').trim() || '#888';

    // Parse hex to RGB for particle blending
    function hexToRGB(hex) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    }
    var accentRGB = hexToRGB(accent);
    var bgRGB = hexToRGB(bg);

    // Dim version of accent for node fill — blend 85% toward background (sigma ignores alpha)
    function blendHex(fg, bg, t) {
      return fg.map(function(f, i) { return Math.floor(f * t + bg[i] * (1 - t)); });
    }
    function rgbToHex(rgb) {
      return '#' + rgb.map(function(c) { return (c < 16 ? '0' : '') + c.toString(16); }).join('');
    }
    var accentDim = rgbToHex(blendHex(accentRGB, bgRGB, 0.15));
    var innerColor = rgbToHex(blendHex(accentRGB, bgRGB, 0.25));

    starGraph = createStarGraph({
      graphology: graphology, Sigma: Sigma, container: container,
      theme: {
        accent: accent, accentDim: accentDim, innerColor: innerColor,
        particleRGB: accentRGB, bgRGB: bgRGB,
        edgeColor: border, edgeLabelColor: textMuted,
        labelColor: accent, expandableColor: textMuted,
      },
      rootId: detail.name, rootLabel: detail.name,
      onNodeClick: function(nodeId) {
        // Navigate to clicked entity
        callFn('select_entity', { entity: nodeId });
      },
    });

    // Build children from current relations
    // For outgoing (center→other): add as normal child
    // For incoming (other→center): add other as parent of center (flipped)
    var outgoing = [];
    var incoming = [];
    var seen = {};
    for (var i = 0; i < relations.length; i++) {
      var r = relations[i];
      var isSource = r.sourceName === detail.name;
      var other = isSource ? r.targetName : r.sourceName;
      if (other !== detail.name && !seen[other]) {
        seen[other] = true;
        if (isSource) {
          outgoing.push({ name: other, kind: r.kind });
        } else {
          incoming.push({ name: other, kind: r.kind });
        }
      }
    }
    // All relations as children — outgoing edges are center→child, incoming are child→center
    // For incoming, we swap: add the other node, then the edge goes other→center
    var allChildren = outgoing.concat(incoming.map(function(r) { return { name: r.name, kind: r.kind, reverse: true }; }));
    starGraph.expandNode(detail.name, allChildren);
  }

  SmartChats.app.onRender(function(state, changed) {
    if (changed.has('entities') || changed.has('view')) { renderEntityList(); renderStatus(); }
    if (changed.has('detail') || changed.has('view') || changed.has('selected')) { renderEntityList(); renderDetail(); renderGraph(); }
    if (changed.has('search_results') || changed.has('view')) { renderEntityList(); renderSearch(); }
    if (changed.has('add_form')) renderAddForm();
    if (changed.has('loading')) renderLoading();
    if (changed.has('error')) renderError();
  });

  renderEntityList();
  renderStatus();
  renderAddForm();
  renderLoading();
  renderError();
</script>
`

// ── App Manifest ──

export const kgExplorerApp: AppManifest = {
    id: 'kg_explorer',
    name: 'Knowledge Graph Explorer',
    version: '1.1.0',
    description: 'Browse, search, add, and delete knowledge graph facts. See what SmartChats knows about you and manage your stored knowledge.',
    icon: '🔗',
    source: 'builtin',
    categories: ['data', 'knowledge'],
    tags: ['knowledge_graph', 'explorer', 'builtin'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: [
        ...DEFAULT_GRANTS.builtin as AppPermission[],
    ],
    // Same-origin scripts served from apps/smartchats/public/lib/.
    // The prebuild step (`npm run prebuild`) copies these from node_modules,
    // so library versions stay pinned to package.json. No CDN dependency,
    // works offline, browser-cached.
    external_scripts: [
        '/lib/graphology.umd.min.js',
        '/lib/sigma.min.js',
    ],

    requested_functions: [
        'store_declarative_knowledge',
        'retrieve_declarative_knowledge',
        'delete_declarative_knowledge',
        'get_knowledge_graph_entities',
        'get_entity_detail',
    ],

    html_templates: { main: HTML },

    state_schema: {
        entities:       { type: 'array',   default: [],    persist: false, description: 'List of entities with relation counts' },
        selected:       { type: 'string',  default: null,  persist: false, description: 'Currently selected entity name' },
        detail:         { type: 'object',  default: null,  persist: false, description: 'Selected entity detail {name, relations}' },
        search_query:   { type: 'string',  default: '',    persist: false, description: 'Current search query' },
        search_results: { type: 'object',  default: null,  persist: false, description: 'Search results {entities, relations}' },
        view:           { type: 'string',  default: 'list', persist: false, description: 'Current view: list | detail | search' },
        add_form:       { type: 'object',  default: null,  persist: false, description: 'Add triple form state' },
        loading:        { type: 'boolean', default: false, persist: false, description: 'Loading indicator' },
        error:          { type: 'string',  default: '',    persist: false, description: 'Error message' },
    },

    on_activate: 'on_activate',

    voice_hooks: {
        wants_transcripts: false,
    },

    modules: [{
        id: 'main',
        name: 'KG Explorer',
        position: 55,
        system_msg: `The Knowledge Graph Explorer app is active. It lets you browse, search, add, and delete knowledge graph facts.

Available functions:
- kg_explorer_load_entities: Refresh the entity list
- kg_explorer_select_entity: View an entity's relationships
- kg_explorer_back_to_list: Return to entity list
- kg_explorer_search: Semantic search the knowledge graph
- kg_explorer_add_triple: Add a new fact (subject, relation, object)
- kg_explorer_delete_triple: Delete a specific relationship
- kg_explorer_delete_entity: Delete an entity and all its relationships
- kg_explorer_open_add_form: Show the add triple form`,
        functions: [
            { name: 'on_activate', description: 'Initialize KG Explorer — loads entity list.', parameters: null, return_type: 'object', code: FN_ON_ACTIVATE },
            { name: 'load_entities', description: 'Refresh the entity list.', parameters: null, return_type: 'object', code: FN_LOAD_ENTITIES },
            { name: 'select_entity', description: 'Select an entity to view its relationships.', parameters: { entity: 'string' }, return_type: 'object', code: FN_SELECT_ENTITY },
            { name: 'back_to_list', description: 'Return to entity list view.', parameters: null, return_type: 'object', code: FN_BACK_TO_LIST },
            { name: 'search', description: 'Semantic search the knowledge graph.', parameters: { query: 'string' }, return_type: 'object', code: FN_SEARCH },
            { name: 'add_triple', description: 'Add a new knowledge triple.', parameters: { subject: 'string', relation: 'string', object: 'string' }, return_type: 'object', code: FN_ADD_TRIPLE },
            { name: 'delete_triple', description: 'Delete a specific relationship.', parameters: { source: 'string', relation: 'string', target: 'string' }, return_type: 'object', code: FN_DELETE_TRIPLE },
            { name: 'delete_entity', description: 'Delete an entity and all its relationships.', parameters: { entity: 'string' }, return_type: 'object', code: FN_DELETE_ENTITY },
            { name: 'edit_triple', description: 'Edit a triple — opens form pre-filled with existing values.', parameters: { source: 'string', relation: 'string', target: 'string' }, return_type: 'object', code: FN_EDIT_TRIPLE },
            { name: 'open_add_form', description: 'Show the add triple form.', parameters: { subject: 'string', relation: 'string', object: 'string' }, return_type: 'object', code: FN_OPEN_ADD_FORM },
            { name: 'dom_check', description: 'Check DOM state against app state.', parameters: null, return_type: 'object', code: FN_DOM_CHECK },
            { name: 'seed_test_data', description: 'Store test triples for testing.', parameters: null, return_type: 'object', code: FN_SEED_TEST_DATA },
            { name: 'cleanup_test_data', description: 'Delete test entities.', parameters: null, return_type: 'object', code: FN_CLEANUP_TEST_DATA },
        ],
    }],

    version_history: [
        { version: '1.0.0', published_at: new Date().toISOString() },
    ],
}
