/**
 * Todo Manager — browse, create, complete, edit, and delete todos.
 *
 * Single-panel sectioned list organized by urgency: overdue, due today,
 * upcoming, no date, recurring due. Inline create/edit form.
 * Hybrid interaction: tap to manage todos, voice to query and create.
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

  /* ── Shared Controls ── */
  select, input[type="text"], input[type="date"] {
    background: var(--sc-background, #0d1117);
    color: var(--sc-text, #e6edf3);
    border: 1px solid var(--sc-border, #30363d);
    border-radius: var(--sc-radius-sm, 4px);
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  select:focus, input:focus {
    border-color: var(--sc-primary, #58a6ff);
  }
  button {
    cursor: pointer; border: none; font-family: inherit; font-size: 12px;
    border-radius: var(--sc-radius-sm, 4px);
    transition: background 0.15s, opacity 0.15s;
  }
  button:active { opacity: 0.7; }

  .btn-primary {
    background: var(--sc-primary, #58a6ff); color: #fff; padding: 5px 14px; font-weight: 600;
  }
  .btn-secondary {
    background: var(--sc-surface, #161b22); color: var(--sc-text-muted, #8b949e); padding: 5px 14px;
    border: 1px solid var(--sc-border, #30363d);
  }
  .btn-icon {
    background: transparent; color: var(--sc-text-muted, #8b949e); padding: 4px;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-icon:hover { color: var(--sc-text, #e6edf3); }
  .btn-icon.danger:hover { color: var(--sc-danger, #f85149); }

  /* ── Filter Bar ── */
  #filters {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    flex-shrink: 0;
  }
  #filters select { flex: 0 0 auto; min-width: 100px; }
  #filters .spacer { flex: 1; }

  /* ── Create/Edit Form ── */
  #create-form {
    display: none;
    padding: 12px 14px;
    border-bottom: 1px solid var(--sc-border, #30363d);
    background: var(--sc-surface, #161b22);
    flex-shrink: 0;
  }
  #create-form.visible { display: block; }
  .form-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .form-row:last-child { margin-bottom: 0; }
  .form-row label { font-size: 11px; color: var(--sc-text-muted, #8b949e); min-width: 55px; }
  .form-row input, .form-row select { flex: 1; }
  #form-title { flex: 2; }
  .form-heading {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--sc-primary, #58a6ff);
    margin-bottom: 8px;
  }

  /* ── Todo List ── */
  #todo-list {
    flex: 1; overflow-y: auto; padding: 10px 14px;
  }
  #todo-empty {
    display: none;
    text-align: center; color: var(--sc-text-muted, #8b949e);
    padding: 40px 0; font-size: 13px;
  }
  #todo-spinner {
    display: none;
    text-align: center; color: var(--sc-text-muted, #8b949e);
    padding: 30px 0; font-size: 12px;
  }

  /* ── Sections ── */
  .section { margin-bottom: 14px; }
  .section:last-child { margin-bottom: 0; }
  .section-header {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 6px;
  }
  .section-header.overdue { color: var(--sc-danger, #f85149); }
  .section-header.due-today { color: var(--sc-primary, #58a6ff); }
  .section-header.upcoming { color: var(--sc-text-muted, #8b949e); }
  .section-header.no-date { color: var(--sc-text-muted, #8b949e); }
  .section-header.recurring { color: var(--sc-accent, #bc8cff); }

  /* ── Todo Item ── */
  .todo-item, .recurring-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px;
    background: var(--sc-surface, #161b22);
    border: 1px solid var(--sc-border, #30363d);
    border-radius: var(--sc-radius-sm, 4px);
    margin-bottom: 4px;
    transition: opacity 0.2s;
  }
  .todo-item:hover .todo-actions, .recurring-item:hover .todo-actions {
    opacity: 1;
  }
  .todo-item.completed { opacity: 0.45; }

  /* ── Checkbox ── */
  .todo-checkbox {
    width: 18px; height: 18px; flex-shrink: 0;
    border: 1.5px solid var(--sc-border, #30363d);
    border-radius: 3px; background: transparent;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.15s; padding: 0;
  }
  .todo-checkbox:hover { border-color: var(--sc-primary, #58a6ff); }
  .todo-checkbox.checked {
    background: var(--sc-success, #3fb950);
    border-color: transparent;
  }
  .todo-checkbox svg { display: none; }
  .todo-checkbox.checked svg { display: block; }

  /* ── Title / Meta ── */
  .todo-title {
    flex: 1; min-width: 0;
    font-size: 12px; color: var(--sc-text, #e6edf3);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .todo-item.completed .todo-title { text-decoration: line-through; }
  .todo-due {
    font-size: 10px; color: var(--sc-text-muted, #8b949e); flex-shrink: 0;
  }
  .todo-priority {
    font-size: 9px; font-weight: 600; text-transform: uppercase;
    padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
  }
  .todo-priority.urgent { background: var(--sc-danger, #f85149); color: #fff; }
  .todo-priority.high { background: var(--sc-warning, #d29922); color: #fff; }
  .todo-priority.medium { background: var(--sc-primary, #58a6ff); color: #fff; }
  .todo-priority.low { background: var(--sc-surface-alt, #21262d); color: var(--sc-text-muted, #8b949e); }

  /* ── Recurring ── */
  .recurring-progress {
    font-size: 10px; color: var(--sc-text-muted, #8b949e); flex-shrink: 0;
  }
  .recurring-pattern {
    font-size: 9px; font-weight: 600; text-transform: uppercase;
    padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
    background: var(--sc-accent, #bc8cff); color: #fff;
  }

  /* ── Actions ── */
  .todo-actions {
    display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0;
  }

  /* ── Status Bar ── */
  #status-bar {
    padding: 6px 14px;
    border-top: 1px solid var(--sc-border, #30363d);
    font-size: 11px; color: var(--sc-text-muted, #8b949e);
    flex-shrink: 0;
  }

  /* ── Error ── */
  #error-bar {
    display: none; padding: 6px 14px;
    background: var(--sc-danger, #f85149); color: #fff;
    font-size: 11px; flex-shrink: 0;
  }
  #error-bar.visible { display: block; }
</style>

<!-- ── Filter Bar ── -->
<div id="filters">
  <select id="filter-category"><option value="">All categories</option></select>
  <button class="btn-icon" id="btn-refresh" title="Refresh">&#x21bb;</button>
  <span class="spacer"></span>
  <button class="btn-primary" id="btn-new">+ Todo</button>
</div>

<!-- ── Create / Edit Form ── -->
<div id="create-form">
  <div class="form-heading" id="form-heading">New Todo</div>
  <div class="form-row">
    <label>Title</label>
    <input type="text" id="form-title" placeholder="What needs to be done?" />
  </div>
  <div class="form-row">
    <label>Priority</label>
    <select id="form-priority">
      <option value="low">Low</option>
      <option value="medium" selected>Medium</option>
      <option value="high">High</option>
      <option value="urgent">Urgent</option>
    </select>
    <label>Category</label>
    <input type="text" id="form-category" placeholder="general" />
  </div>
  <div class="form-row">
    <label>Due date</label>
    <input type="date" id="form-due-date" />
    <span class="spacer"></span>
    <button class="btn-primary" id="btn-save-form">Save</button>
    <button class="btn-secondary" id="btn-cancel-form">Cancel</button>
  </div>
</div>

<!-- ── Error Bar ── -->
<div id="error-bar"></div>

<!-- ── Todo List ── -->
<div id="todo-list">
  <div id="todo-spinner">Loading todos...</div>
  <div id="todo-empty">No todos right now. Tap + Todo to create one.</div>
  <div id="todo-sections"></div>
</div>

<!-- ── Status Bar ── -->
<div id="status-bar">
  <span id="total-count">0 active todos</span>
</div>

<script>
// ── Render helpers ──

function formatDueDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

function makeTodoRow(item, isCompleted) {
    var row = document.createElement('div');
    row.className = 'todo-item' + (isCompleted ? ' completed' : '');
    row.dataset.id = item.id;

    var cb = document.createElement('button');
    cb.className = 'todo-checkbox' + (isCompleted ? ' checked' : '');
    cb.innerHTML = '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    cb.onclick = function() {
        SmartChats.app.fns.complete_todo({ id: item.id, is_recurring: false }, SmartChats.app, SmartChats.util);
    };

    var title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = item.title;

    row.appendChild(cb);
    row.appendChild(title);

    if (item.due_date) {
        var due = document.createElement('span');
        due.className = 'todo-due';
        due.textContent = formatDueDate(item.due_date);
        row.appendChild(due);
    }

    if (item.priority) {
        var pri = document.createElement('span');
        pri.className = 'todo-priority ' + item.priority;
        pri.textContent = item.priority;
        row.appendChild(pri);
    }

    var actions = document.createElement('span');
    actions.className = 'todo-actions';

    var editBtn = document.createElement('button');
    editBtn.className = 'btn-icon';
    editBtn.innerHTML = '&#9998;';
    editBtn.title = 'Edit';
    editBtn.onclick = function(e) {
        e.stopPropagation();
        SmartChats.app.fns.edit_todo({ id: item.id }, SmartChats.app, SmartChats.util);
    };

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-icon danger';
    delBtn.innerHTML = '&#128465;';
    delBtn.title = 'Delete';
    delBtn.onclick = function(e) {
        e.stopPropagation();
        SmartChats.app.fns.delete_todo({ id: item.id }, SmartChats.app, SmartChats.util);
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);

    return row;
}

function makeRecurringRow(item, isCompleted) {
    var row = document.createElement('div');
    row.className = 'recurring-item' + (isCompleted ? ' completed' : '');
    row.dataset.id = item.id;

    var cb = document.createElement('button');
    cb.className = 'todo-checkbox' + (isCompleted ? ' checked' : '');
    cb.innerHTML = '<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    cb.onclick = function() {
        SmartChats.app.fns.complete_todo({ id: item.id, is_recurring: true }, SmartChats.app, SmartChats.util);
    };

    var title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = item.title;

    var progress = document.createElement('span');
    progress.className = 'recurring-progress';
    var done = item.done_this_period + (isCompleted ? 1 : 0);
    progress.textContent = item.target ? Math.min(done, item.target) + '/' + item.target : done + ' done';

    var pattern = document.createElement('span');
    pattern.className = 'recurring-pattern';
    pattern.textContent = item.pattern;

    var actions = document.createElement('span');
    actions.className = 'todo-actions';
    var delBtn = document.createElement('button');
    delBtn.className = 'btn-icon danger';
    delBtn.innerHTML = '&#128465;';
    delBtn.title = 'Delete';
    delBtn.onclick = function(e) {
        e.stopPropagation();
        SmartChats.app.fns.delete_todo({ id: item.id }, SmartChats.app, SmartChats.util);
    };
    actions.appendChild(delBtn);

    row.appendChild(cb);
    row.appendChild(title);
    row.appendChild(progress);
    row.appendChild(pattern);
    row.appendChild(actions);

    return row;
}

function renderSection(container, sectionClass, label, items, completedIds, makeRow) {
    if (!items || items.length === 0) return;
    var section = document.createElement('div');
    section.className = 'section';
    section.dataset.section = sectionClass;

    var header = document.createElement('div');
    header.className = 'section-header ' + sectionClass;
    header.textContent = label;
    section.appendChild(header);

    for (var i = 0; i < items.length; i++) {
        var isComp = completedIds.indexOf(items[i].id) !== -1;
        section.appendChild(makeRow(items[i], isComp));
    }
    container.appendChild(section);
}

function renderTodoList() {
    var state = SmartChats.app.state;
    var todos = state.todos || {};
    var completedIds = state.completed_ids || [];
    var loading = state.loading;

    var spinner = SmartChats.app.el('#todo-spinner');
    var empty = SmartChats.app.el('#todo-empty');
    var sections = SmartChats.app.el('#todo-sections');

    spinner.style.display = loading ? 'block' : 'none';
    if (loading) {
        empty.style.display = 'none';
        sections.innerHTML = '';
        return;
    }

    sections.innerHTML = '';

    var overdue = todos.overdue || [];
    var dueToday = todos.due_today || [];
    var upcoming = todos.upcoming_7d || [];
    var noDate = todos.no_date || [];
    var recurring = todos.recurring_due || [];

    var totalItems = overdue.length + dueToday.length + upcoming.length + noDate.length + recurring.length;

    if (totalItems === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    renderSection(sections, 'overdue', 'Overdue', overdue, completedIds, makeTodoRow);
    renderSection(sections, 'due-today', 'Due Today', dueToday, completedIds, makeTodoRow);
    renderSection(sections, 'upcoming', 'Upcoming', upcoming, completedIds, makeTodoRow);
    renderSection(sections, 'no-date', 'No Due Date', noDate, completedIds, makeTodoRow);
    renderSection(sections, 'recurring', 'Recurring Due', recurring, completedIds, makeRecurringRow);

    // Populate category filter
    var cats = {};
    var allItems = [].concat(overdue, dueToday, upcoming, noDate);
    for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].category) cats[allItems[i].category] = true;
    }
    var sel = SmartChats.app.el('#filter-category');
    var curVal = sel.value;
    sel.innerHTML = '<option value="">All categories</option>';
    var catKeys = Object.keys(cats).sort();
    for (var c = 0; c < catKeys.length; c++) {
        var opt = document.createElement('option');
        opt.value = catKeys[c];
        opt.textContent = catKeys[c];
        if (catKeys[c] === curVal) opt.selected = true;
        sel.appendChild(opt);
    }
}

function renderCreateForm() {
    var state = SmartChats.app.state;
    var form = SmartChats.app.el('#create-form');
    var heading = SmartChats.app.el('#form-heading');

    if (!state.create_form) {
        form.classList.remove('visible');
        return;
    }
    form.classList.add('visible');

    var isEditing = !!(state.editing_id);
    heading.textContent = isEditing ? 'Edit Todo' : 'New Todo';

    var cf = state.create_form;
    SmartChats.app.el('#form-title').value = cf.title || '';
    SmartChats.app.el('#form-priority').value = cf.priority || 'medium';
    SmartChats.app.el('#form-category').value = cf.category || '';
    SmartChats.app.el('#form-due-date').value = cf.due_date || '';
}

function renderStatusBar() {
    var state = SmartChats.app.state;
    var total = (state.todos && state.todos.total_active) || 0;
    SmartChats.app.el('#total-count').textContent = total + ' active todo' + (total !== 1 ? 's' : '');
}

function renderError() {
    var state = SmartChats.app.state;
    var bar = SmartChats.app.el('#error-bar');
    if (state.error) {
        bar.textContent = state.error;
        bar.classList.add('visible');
        setTimeout(function() {
            SmartChats.app.setState({ error: '' });
        }, 4000);
    } else {
        bar.classList.remove('visible');
    }
}

// ── onRender ──

SmartChats.app.onRender(function(state, changed) {
    if (changed.has('todos') || changed.has('loading') || changed.has('completed_ids')) renderTodoList();
    if (changed.has('create_form') || changed.has('editing_id')) renderCreateForm();
    if (changed.has('todos')) renderStatusBar();
    if (changed.has('error')) renderError();
});

// ── UI Event Listeners ──

document.getElementById('btn-new').onclick = function() {
    SmartChats.app.fns.open_create_form({}, SmartChats.app, SmartChats.util);
};

document.getElementById('btn-refresh').onclick = function() {
    SmartChats.app.fns.load_todos({}, SmartChats.app, SmartChats.util);
};

document.getElementById('btn-save-form').onclick = function() {
    var state = SmartChats.app.state;
    var title = document.getElementById('form-title').value;
    var priority = document.getElementById('form-priority').value;
    var category = document.getElementById('form-category').value;
    var due_date = document.getElementById('form-due-date').value;

    if (state.editing_id) {
        SmartChats.app.fns.save_edit({ title: title, priority: priority, category: category, due_date: due_date }, SmartChats.app, SmartChats.util);
    } else {
        SmartChats.app.fns.create_todo({ title: title, priority: priority, category: category, due_date: due_date }, SmartChats.app, SmartChats.util);
    }
};

document.getElementById('btn-cancel-form').onclick = function() {
    SmartChats.app.setState({ create_form: null, editing_id: '' });
};

document.getElementById('filter-category').onchange = function() {
    SmartChats.app.setState({ filter_category: this.value });
    SmartChats.app.fns.load_todos({}, SmartChats.app, SmartChats.util);
};
</script>
`

// ── App Function Code ──

const FN_ON_ACTIVATE = `async function(fnArgs, app, util) {
    return app.fns.load_todos({}, app, util);
}`

const FN_LOAD_TODOS = `async function(fnArgs, app, util) {
    app.setState({ loading: true, completed_ids: [] });
    try {
        var category = app.state.filter_category || undefined;
        var ctx = await util.smartchats.get_todos_context({ category: category });
        app.setState({ todos: ctx, loading: false });
        return { ok: true, total: ctx.total_active || 0 };
    } catch (e) {
        app.setState({ loading: false, error: 'Failed to load todos: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_CREATE_TODO = `async function(fnArgs, app, util) {
    var title = fnArgs.title;
    if (!title || !title.trim()) {
        app.setState({ error: 'Title is required' });
        return { ok: false, error: 'title required' };
    }
    try {
        var result = await util.smartchats.save_todo({
            title: title.trim(),
            priority: fnArgs.priority || 'medium',
            category: fnArgs.category || 'general',
            due_date: fnArgs.due_date || undefined,
        });
        app.setState({ create_form: null, editing_id: '' });
        await app.fns.load_todos({}, app, util);
        return { ok: true, id: result.id, title: title.trim() };
    } catch (e) {
        app.setState({ error: 'Failed to create todo: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_COMPLETE_TODO = `async function(fnArgs, app, util) {
    var id = fnArgs.id;
    if (!id) {
        // Use first visible todo from state
        var todos = app.state.todos || {};
        var all = [].concat(todos.overdue || [], todos.due_today || [], todos.upcoming_7d || [], todos.no_date || [], todos.recurring_due || []);
        if (all.length === 0) return { ok: false, error: 'No todos to complete' };
        id = all[0].id;
    }
    var isRecurring = !!(fnArgs.is_recurring);

    // Optimistic update
    var ids = (app.state.completed_ids || []).slice();
    if (ids.indexOf(id) === -1) ids.push(id);
    app.setState({ completed_ids: ids });

    try {
        await util.smartchats.manage_todo({ id: id, action: 'complete' });
        await app.fns.load_todos({}, app, util);
        return { ok: true, id: id };
    } catch (e) {
        // Revert
        var reverted = (app.state.completed_ids || []).filter(function(x) { return x !== id; });
        app.setState({ completed_ids: reverted, error: 'Failed to complete: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_DELETE_TODO = `async function(fnArgs, app, util) {
    var id = fnArgs.id;
    if (!id) return { ok: false, error: 'id required' };
    try {
        await util.smartchats.manage_todo({ id: id, action: 'delete' });
        await app.fns.load_todos({}, app, util);
        return { ok: true, id: id };
    } catch (e) {
        app.setState({ error: 'Failed to delete: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_EDIT_TODO = `async function(fnArgs, app, util) {
    var id = fnArgs.id;
    if (!id) return { ok: false, error: 'id required' };

    // Find the todo across all sections
    var todos = app.state.todos || {};
    var allItems = [].concat(todos.overdue || [], todos.due_today || [], todos.upcoming_7d || [], todos.no_date || []);
    var found = null;
    for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].id === id) { found = allItems[i]; break; }
    }
    if (!found) return { ok: false, error: 'Todo not found in state' };

    app.setState({
        create_form: {
            title: found.title || '',
            priority: found.priority || 'medium',
            category: found.category || '',
            due_date: found.due_date || '',
        },
        editing_id: id,
    });
    return { ok: true };
}`

const FN_SAVE_EDIT = `async function(fnArgs, app, util) {
    var id = app.state.editing_id;
    if (!id) return { ok: false, error: 'No todo being edited' };
    var title = fnArgs.title;
    if (!title || !title.trim()) {
        app.setState({ error: 'Title is required' });
        return { ok: false, error: 'title required' };
    }
    try {
        await util.smartchats.manage_todo({
            id: id,
            action: 'edit',
            updates: {
                title: title.trim(),
                priority: fnArgs.priority || 'medium',
                category: fnArgs.category || 'general',
                due_date: fnArgs.due_date || undefined,
            },
        });
        app.setState({ create_form: null, editing_id: '' });
        await app.fns.load_todos({}, app, util);
        return { ok: true, id: id };
    } catch (e) {
        app.setState({ error: 'Failed to save edit: ' + (e.message || e) });
        return { ok: false, error: e.message || String(e) };
    }
}`

const FN_OPEN_CREATE_FORM = `async function(fnArgs, app, util) {
    app.setState({
        create_form: { title: '', priority: 'medium', category: '', due_date: '' },
        editing_id: '',
    });
    return { ok: true };
}`

const FN_SEED_TEST_TODOS = `async function(fnArgs, app, util) {
    var now = Date.now();
    var day = 86400000;
    var ids = [];

    function dateStr(offset) {
        return new Date(now + offset).toISOString().slice(0, 10);
    }

    var todos = [
        { title: '__simi_overdue_1', priority: 'high', category: 'test', due_date: dateStr(-1 * day) },
        { title: '__simi_overdue_2', priority: 'urgent', category: 'test', due_date: dateStr(-3 * day) },
        { title: '__simi_today_1', priority: 'medium', category: 'test', due_date: dateStr(0) },
        { title: '__simi_today_2', priority: 'high', category: 'work', due_date: dateStr(0) },
        { title: '__simi_upcoming_1', priority: 'medium', category: 'test', due_date: dateStr(3 * day) },
        { title: '__simi_upcoming_2', priority: 'low', category: 'personal', due_date: dateStr(5 * day) },
        { title: '__simi_nodate_1', priority: 'low', category: 'test' },
    ];

    for (var i = 0; i < todos.length; i++) {
        try {
            var result = await util.smartchats.save_todo(todos[i]);
            if (result && result.id) ids.push(result.id);
        } catch (e) {
            util.log('seed_test_todos: failed to save ' + todos[i].title + ': ' + (e.message || e));
        }
    }

    return { seeded: true, count: ids.length, ids: ids };
}`

const FN_DOM_CHECK = `async function(fnArgs, app, util) {
    var todos = app.state.todos || {};
    var completedIds = app.state.completed_ids || [];

    var overdueItems = app.dom.querySelectorAll('.section[data-section="overdue"] .todo-item');
    var dueTodayItems = app.dom.querySelectorAll('.section[data-section="due-today"] .todo-item');
    var upcomingItems = app.dom.querySelectorAll('.section[data-section="upcoming"] .todo-item');
    var noDateItems = app.dom.querySelectorAll('.section[data-section="no-date"] .todo-item');
    var recurringItems = app.dom.querySelectorAll('.section[data-section="recurring"] .recurring-item');

    var overdueState = (todos.overdue || []).length;
    var dueTodayState = (todos.due_today || []).length;
    var upcomingState = (todos.upcoming_7d || []).length;
    var noDateState = (todos.no_date || []).length;
    var recurringState = (todos.recurring_due || []).length;

    var totalRendered = overdueItems.length + dueTodayItems.length + upcomingItems.length + noDateItems.length + recurringItems.length;
    var totalState = overdueState + dueTodayState + upcomingState + noDateState + recurringState;

    // Find first todo ID in state for test use
    var firstId = null;
    var allItems = [].concat(todos.overdue || [], todos.due_today || [], todos.upcoming_7d || [], todos.no_date || [], todos.recurring_due || []);
    if (allItems.length > 0) firstId = allItems[0].id;

    var completedEls = app.dom.querySelectorAll('.todo-item.completed');
    var formEl = app.dom.getElementById('create-form');
    var emptyEl = app.dom.getElementById('todo-empty');
    var statusEl = app.dom.getElementById('total-count');

    return {
        overdue_rendered: overdueItems.length,
        overdue_in_state: overdueState,
        overdue_match: overdueItems.length === overdueState,

        due_today_rendered: dueTodayItems.length,
        due_today_in_state: dueTodayState,
        due_today_match: dueTodayItems.length === dueTodayState,

        upcoming_rendered: upcomingItems.length,
        upcoming_in_state: upcomingState,
        upcoming_match: upcomingItems.length === upcomingState,

        no_date_rendered: noDateItems.length,
        no_date_in_state: noDateState,
        no_date_match: noDateItems.length === noDateState,

        recurring_rendered: recurringItems.length,
        recurring_in_state: recurringState,
        recurring_match: recurringItems.length === recurringState,

        total_rendered: totalRendered,
        total_in_state: totalState,
        total_match: totalRendered === totalState,

        loading: !!app.state.loading,
        create_form_visible: formEl ? formEl.classList.contains('visible') : false,
        empty_visible: emptyEl ? emptyEl.style.display !== 'none' : false,
        status_bar_text: statusEl ? statusEl.textContent : '',
        completed_count: completedEls.length,
        completed_ids_in_state: completedIds.length,
        first_todo_id: firstId,
    };
}`

// ── Manifest ──

export const todoApp: AppManifest = {
    id: 'todo',
    name: 'Todo Manager',
    version: '1.0.0',
    description: 'Browse, create, complete, edit, and delete todos. Organized by urgency: overdue, due today, upcoming, no date, and recurring due.',
    icon: '✅',
    source: 'builtin',
    categories: ['utility', 'productivity'],
    tags: ['todos', 'tasks', 'productivity', 'builtin'],
    interaction_mode: 'hybrid',
    display_mode: 'panel',
    permissions: DEFAULT_GRANTS.builtin as AppPermission[],
    requested_functions: ['get_todos_context', 'save_todo', 'manage_todo'],

    html_templates: { main: HTML },
    on_activate: 'on_activate',

    state_schema: {
        filter_category:  { type: 'string',  default: '',    description: 'Active category filter', persist: true },
        todos:            { type: 'object',  default: {},    description: 'Categorized todos from get_todos_context', persist: false },
        loading:          { type: 'boolean', default: false, description: 'Loading state', persist: false },
        create_form:      { type: 'object',  default: null,  description: 'Create/edit form state (null = hidden)', persist: false },
        editing_id:       { type: 'string',  default: '',    description: 'ID of todo being edited', persist: false },
        completed_ids:    { type: 'array',   default: [],    description: 'Optimistically completed todo IDs', persist: false },
        error:            { type: 'string',  default: '',    description: 'Error message', persist: false },
    },

    modules: [{
        id: 'main',
        name: 'Todo Manager',
        position: 60,
        functions: [
            {
                name: 'on_activate',
                description: 'Load todos on activation.',
                parameters: null,
                return_type: 'object',
                code: FN_ON_ACTIVATE,
            },
            {
                name: 'load_todos',
                description: 'Fetch categorized todos from the database. Respects the current category filter.',
                parameters: null,
                return_type: 'object',
                code: FN_LOAD_TODOS,
            },
            {
                name: 'create_todo',
                description: 'Create a new todo. Returns the saved todo ID.',
                parameters: { title: 'string', priority: 'string', category: 'string', due_date: 'string' },
                return_type: 'object',
                code: FN_CREATE_TODO,
            },
            {
                name: 'complete_todo',
                description: 'Mark a todo as complete. If no id provided, completes the first visible todo.',
                parameters: { id: 'string', is_recurring: 'boolean' },
                return_type: 'object',
                code: FN_COMPLETE_TODO,
            },
            {
                name: 'delete_todo',
                description: 'Delete a todo by ID.',
                parameters: { id: 'string' },
                return_type: 'object',
                code: FN_DELETE_TODO,
            },
            {
                name: 'edit_todo',
                description: 'Open the edit form pre-populated with a todo\'s data.',
                parameters: { id: 'string' },
                return_type: 'object',
                code: FN_EDIT_TODO,
            },
            {
                name: 'save_edit',
                description: 'Save edits to the currently-editing todo.',
                parameters: { title: 'string', priority: 'string', category: 'string', due_date: 'string' },
                return_type: 'object',
                code: FN_SAVE_EDIT,
            },
            {
                name: 'open_create_form',
                description: 'Open the create form for a new todo.',
                parameters: null,
                return_type: 'object',
                code: FN_OPEN_CREATE_FORM,
            },
            {
                name: 'seed_test_todos',
                description: 'Create test todos across all urgency buckets. For automated testing only.',
                parameters: null,
                return_type: 'object',
                code: FN_SEED_TEST_TODOS,
            },
            {
                name: 'dom_check',
                description: 'Check DOM state against app state. Returns whether UI elements match the data.',
                parameters: null,
                return_type: 'object',
                code: FN_DOM_CHECK,
            },
        ],
    }],

    version_history: [
        { version: '1.0.0', published_at: new Date().toISOString() },
    ],
}
