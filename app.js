/* ================================================================
   AI GTM Internship Tracker — app.js
   Static, no-backend tracker. Roadmap definitions live in
   data/tasks_data.json; per-user progress (status/notes/reflection/
   completedAt) is layered on top from localStorage.
   ================================================================ */

const STORAGE_KEY = 'gtmTrackerState_v1';
const SETTINGS_KEY = 'gtmTrackerSettings_v1';

let DATA = null;          // { meta, objectives, tasks, ongoing }
let OBJ_BY_ID = {};        // objectiveId -> objective def
let currentView = 'dashboard';
let filters = { objective: '', week: '', status: '', search: '' };
let SETTINGS = { webAppUrl: '' };
let syncState = 'local'; // 'local' | 'connected' | 'error' | 'syncing'

/* ---------------- utils ---------------- */

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function todayISO() {
  const d = new Date();
  return localISO(d);
}
function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s) { return new Date(s + 'T00:00:00'); }

function formatDateLong(iso) {
  const d = parseISO(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function formatDateShort(iso) {
  const d = parseISO(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function parseHours(str) {
  if (!str) return 0;
  const m = String(str).match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function countWeekdaysInclusive(startISO, endISO) {
  let start = parseISO(startISO), end = parseISO(endISO);
  if (start > end) return 0;
  let count = 0, cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/* ---------------- state persistence ---------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Could not read saved progress:', e);
    return {};
  }
}

function persistState() {
  const state = {};
  [...DATA.tasks, ...DATA.ongoing].forEach(item => {
    state[item.id] = {
      status: item.status,
      notes: item.notes,
      reflection: item.reflection,
      completedAt: item.completedAt || null
    };
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Could not save progress — your browser storage may be full or disabled:', e);
  }
}

function applyState(state) {
  [...DATA.tasks, ...DATA.ongoing].forEach(item => {
    const s = state[item.id];
    if (s) {
      item.status = s.status || item.status;
      item.notes = s.notes || item.notes;
      item.reflection = s.reflection || item.reflection;
      item.completedAt = s.completedAt || null;
    }
  });
}

/* ---------------- Google Sheets sync (optional) ---------------- */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { webAppUrl: '' };
  } catch (e) {
    return { webAppUrl: '' };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS));
  } catch (e) {
    console.error('Could not save sync settings:', e);
  }
}

async function fetchRemoteData(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json || !json.tasks) throw new Error('Unexpected response shape');
  return json;
}

function pushUpdate(id, fields) {
  if (!SETTINGS.webAppUrl) return;
  // text/plain avoids a CORS preflight that Apps Script web apps don't handle
  fetch(SETTINGS.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ id, ...fields })
  }).then(res => {
    setSyncBadge(res.ok ? 'connected' : 'error');
  }).catch(() => {
    setSyncBadge('error');
  });
}

function setSyncBadge(state) {
  syncState = state;
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  badge.classList.remove('connected', 'error');
  if (state === 'connected') { badge.textContent = '⚙ Synced ✓'; badge.classList.add('connected'); }
  else if (state === 'error') { badge.textContent = '⚙ Sync error'; badge.classList.add('error'); }
  else if (state === 'syncing') { badge.textContent = '⚙ Syncing…'; }
  else { badge.textContent = '⚙ Settings'; }
}

function openSettings() {
  document.getElementById('webAppUrlInput').value = SETTINGS.webAppUrl || '';
  document.getElementById('settingsStatus').textContent = '';
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}

async function saveAndSyncNow() {
  const url = document.getElementById('webAppUrlInput').value.trim();
  const statusEl = document.getElementById('settingsStatus');
  SETTINGS.webAppUrl = url;
  saveSettings();
  if (!url) {
    setSyncBadge('local');
    statusEl.textContent = 'Disconnected — using this browser only.';
    return;
  }
  statusEl.textContent = 'Connecting…';
  setSyncBadge('syncing');
  try {
    const remote = await fetchRemoteData(url);
    DATA = remote;
    OBJ_BY_ID = {};
    DATA.objectives.forEach(o => { OBJ_BY_ID[o.id] = o; });
    setSyncBadge('connected');
    statusEl.textContent = `Connected — loaded ${remote.tasks.length} tasks from your sheet.`;
    renderAll();
  } catch (e) {
    setSyncBadge('error');
    statusEl.textContent = 'Could not reach that URL. Double-check it ends in /exec and the deployment access is set to "Anyone".';
  }
}

function disconnectSync() {
  SETTINGS.webAppUrl = '';
  saveSettings();
  document.getElementById('webAppUrlInput').value = '';
  setSyncBadge('local');
  document.getElementById('settingsStatus').textContent = 'Disconnected — switch back to the bundled roadmap file on next reload.';
}

function findItem(id) {
  return DATA.tasks.find(t => t.id === id) || DATA.ongoing.find(t => t.id === id);
}

function setStatus(id, status) {
  const item = findItem(id);
  if (!item) return;
  item.status = status;
  if (status === 'Completed' && !item.completedAt) {
    item.completedAt = new Date().toISOString();
  } else if (status !== 'Completed') {
    item.completedAt = null;
  }
  persistState();
  pushUpdate(id, { status: item.status, completedAt: item.completedAt });
  renderAll();
}

function toggleComplete(id) {
  const item = findItem(id);
  if (!item) return;
  setStatus(id, item.status === 'Completed' ? 'Not Started' : 'Completed');
}

function setNotes(id, text) {
  const item = findItem(id);
  if (!item) return;
  item.notes = text;
  persistState();
  pushUpdate(id, { notes: text });
}

function setReflection(id, text) {
  const item = findItem(id);
  if (!item) return;
  item.reflection = text;
  persistState();
  pushUpdate(id, { reflection: text });
}

/* ---------------- computed stats ---------------- */

function computeStreak() {
  const activityDays = new Set();
  [...DATA.tasks, ...DATA.ongoing].forEach(t => {
    if (t.completedAt) activityDays.add(t.completedAt.slice(0, 10));
  });
  const today = todayISO();
  let cursor = parseISO(today);
  if (!activityDays.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activityDays.has(localISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeDaysCompleted() {
  const activityDays = new Set();
  [...DATA.tasks, ...DATA.ongoing].forEach(t => {
    if (t.completedAt) activityDays.add(t.completedAt.slice(0, 10));
  });
  return activityDays.size;
}

function computeHoursLearned() {
  return DATA.tasks
    .filter(t => t.status === 'Completed')
    .reduce((sum, t) => sum + parseHours(t.estimatedTime), 0);
}

function computeDaysRemaining() {
  const today = todayISO();
  const last = DATA.meta.lastDueDate;
  if (today > last) return 0;
  const start = today > DATA.meta.internshipStartDate ? today : DATA.meta.internshipStartDate;
  return countWeekdaysInclusive(start, last);
}

function objectiveProgress(objId) {
  const isContent = objId === 'content-marketing';
  const items = isContent
    ? [...DATA.tasks.filter(t => t.objectiveId === objId), ...DATA.ongoing]
    : DATA.tasks.filter(t => t.objectiveId === objId);
  const total = items.length;
  const completed = items.filter(t => t.status === 'Completed').length;
  return { total, completed, pct: total ? Math.round((completed / total) * 100) : 0 };
}

function overallProgress() {
  const total = DATA.tasks.length;
  const completed = DATA.tasks.filter(t => t.status === 'Completed').length;
  return { total, completed, pct: total ? Math.round((completed / total) * 100) : 0 };
}

/* ---------------- rendering: shared ---------------- */

function objColor(objId) {
  const o = OBJ_BY_ID[objId];
  return o ? o.color : '#4C8DFF';
}

function taskCardHTML(t, opts = {}) {
  const overdue = t.status !== 'Completed' && t.dueDate < todayISO();
  const completed = t.status === 'Completed';
  const classes = ['task-card'];
  if (completed) classes.push('completed');
  if (overdue) classes.push('overdue');
  const objName = OBJ_BY_ID[t.objectiveId] ? OBJ_BY_ID[t.objectiveId].name : '';
  const subLabel = t.subtrackLabel ? ` · ${esc(t.subtrackLabel)}` : '';
  return `
    <div class="${classes.join(' ')}" style="--obj-color:${objColor(t.objectiveId)}" data-id="${t.id}">
      <div class="task-top">
        <button class="task-check ${completed ? 'checked' : ''}" data-action="toggle" data-id="${t.id}" aria-label="Mark complete">${completed ? '✓' : ''}</button>
        <div class="task-main" data-action="open" data-id="${t.id}">
          <div class="task-obj-label" style="color:${objColor(t.objectiveId)}">${esc(objName)}${subLabel}</div>
          <div class="task-topic">${esc(t.topic)}</div>
          <div class="task-meta-row">
            <span class="badge priority-${t.priority}">${esc(t.priority)}</span>
            <span class="badge">${esc(t.estimatedTime || '')}</span>
            <span class="badge due-date">${opts.hideDue ? '' : formatDateShort(t.dueDate)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------- rendering: dashboard ---------------- */

function renderStatStrip() {
  const streak = computeStreak();
  const hours = computeHoursLearned();
  const daysCompleted = computeDaysCompleted();
  const daysRemaining = computeDaysRemaining();
  const overall = overallProgress();

  document.getElementById('statStrip').innerHTML = `
    <div class="stat-card streak">
      <div class="stat-label">Current Streak</div>
      <div class="stat-value">${streak}<span class="stat-unit">days</span></div>
    </div>
    <div class="stat-card hours">
      <div class="stat-label">Hours Learned</div>
      <div class="stat-value">${hours}<span class="stat-unit">hrs</span></div>
    </div>
    <div class="stat-card days-done">
      <div class="stat-label">Days Completed</div>
      <div class="stat-value">${daysCompleted}<span class="stat-unit">days</span></div>
    </div>
    <div class="stat-card days-left">
      <div class="stat-label">Weekdays Left</div>
      <div class="stat-value">${daysRemaining}<span class="stat-unit">days</span></div>
    </div>
    <div class="stat-card ring-card">
      <div class="progress-ring" style="--pct:${overall.pct}"><div class="progress-ring-inner">${overall.pct}%</div></div>
      <div>
        <div class="stat-label">Overall Progress</div>
        <div class="stat-value" style="font-size:15px">${overall.completed}/${overall.total}<span class="stat-unit">tasks</span></div>
      </div>
    </div>`;
}

function renderObjectiveStrip() {
  const html = DATA.objectives
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(o => {
      const prog = objectiveProgress(o.id);
      return `
        <div class="obj-pill" style="--obj-color:${o.color}" data-action="filter-objective" data-id="${o.id}">
          <div class="obj-name">${esc(o.name)}</div>
          <div class="obj-bar-track"><div class="obj-bar-fill" style="width:${prog.pct}%"></div></div>
          <div class="obj-meta">${prog.completed}/${prog.total} tasks · ${prog.pct}%</div>
        </div>`;
    }).join('');
  document.getElementById('objectiveStrip').innerHTML = html;
}

function renderStartBanner() {
  const banner = document.getElementById('startBanner');
  const today = todayISO();
  const start = DATA.meta.internshipStartDate;
  const last = DATA.meta.lastDueDate;

  if (today < start) {
    const daysAway = countWeekdaysInclusive(today, start) - 1;
    banner.classList.remove('hidden');
    banner.innerHTML = `Your roadmap starts <strong>${formatDateLong(start)}</strong> (${daysAway} weekday${daysAway === 1 ? '' : 's'} from now). Showing a preview of the first day's tasks below.`;
  } else if (today > last) {
    banner.classList.remove('hidden');
    banner.innerHTML = `🎉 You've reached the end of the current roadmap (last scheduled day: <strong>${formatDateLong(last)}</strong>). Nice work — check the Roadmap tab for anything still open.`;
  } else {
    banner.classList.add('hidden');
  }
}

function renderBoard() {
  const today = todayISO();
  const start = DATA.meta.internshipStartDate;
  const preview = today < start;

  let todaysAll, carried, upcoming;

  if (preview) {
    todaysAll = DATA.tasks.filter(t => t.dueDate === start);
    carried = [];
    upcoming = DATA.tasks.filter(t => t.dueDate > start).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
  } else {
    todaysAll = DATA.tasks.filter(t => t.dueDate === today);
    carried = DATA.tasks.filter(t => t.dueDate < today && t.status !== 'Completed')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    upcoming = DATA.tasks.filter(t => t.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
  }

  const todaysPending = todaysAll.filter(t => t.status !== 'Completed');
  const todaysDone = todaysAll.filter(t => t.status === 'Completed');

  document.getElementById('todayCount').textContent = todaysAll.length;
  document.getElementById('carriedCount').textContent = carried.length;
  document.getElementById('upcomingCount').textContent = upcoming.length;

  const todayList = document.getElementById('todayList');
  if (todaysAll.length === 0) {
    todayList.innerHTML = `<div class="empty-note">No tasks scheduled for this date.</div>`;
  } else {
    const progressLine = `<div class="empty-note" style="margin-bottom:2px;border-style:solid;">Today's progress: ${todaysDone.length}/${todaysAll.length} complete</div>`;
    todayList.innerHTML = progressLine + todaysAll.map(t => taskCardHTML(t)).join('');
  }

  const carriedList = document.getElementById('carriedList');
  carriedList.innerHTML = carried.length
    ? carried.map(t => taskCardHTML(t)).join('')
    : `<div class="empty-note">Nothing carried over — you're caught up.</div>`;

  const upcomingList = document.getElementById('upcomingList');
  upcomingList.innerHTML = upcoming.length
    ? upcoming.map(t => taskCardHTML(t, { hideDue: false })).join('')
    : `<div class="empty-note">Nothing further out yet.</div>`;
}

function renderDashboard() {
  renderStatStrip();
  renderObjectiveStrip();
  renderStartBanner();
  renderBoard();
}

/* ---------------- rendering: analytics ---------------- */

function computeHoursByObjective(objId) {
  return DATA.tasks
    .filter(t => t.objectiveId === objId && t.status === 'Completed')
    .reduce((sum, t) => sum + parseHours(t.estimatedTime), 0);
}

function computePriorityBreakdown() {
  const byPriority = {};
  DATA.tasks.forEach(t => {
    const p = t.priority || 'Medium';
    if (!byPriority[p]) byPriority[p] = { total: 0, completed: 0 };
    byPriority[p].total++;
    if (t.status === 'Completed') byPriority[p].completed++;
  });
  return byPriority;
}

function getWeekStartISO(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as week start
  date.setDate(date.getDate() + diff);
  return localISO(date);
}

function computeWeeklyCompletions(numWeeks = 8) {
  const counts = {};
  [...DATA.tasks, ...DATA.ongoing].forEach(t => {
    if (t.completedAt) {
      const wk = getWeekStartISO(parseISO(t.completedAt.slice(0, 10)));
      counts[wk] = (counts[wk] || 0) + 1;
    }
  });
  const todayWeekStart = parseISO(getWeekStartISO(todayISO()));
  const weeks = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const d = new Date(todayWeekStart);
    d.setDate(d.getDate() - i * 7);
    const iso = localISO(d);
    weeks.push({ weekStart: iso, count: counts[iso] || 0 });
  }
  return weeks;
}

function computePace() {
  const today = todayISO();
  const expected = DATA.tasks.filter(t => t.dueDate <= today).length;
  const actual = DATA.tasks.filter(t => t.status === 'Completed').length;
  return { expected, actual, diff: actual - expected };
}

function renderAnalyticsTopStats() {
  const overall = overallProgress();
  const hours = computeHoursLearned();
  const pace = computePace();
  const streak = computeStreak();

  let paceClass = 'ontrack', paceText = "You're exactly on pace with today's schedule.";
  if (pace.diff > 0) { paceClass = 'ahead'; paceText = `You're ${pace.diff} task${pace.diff === 1 ? '' : 's'} ahead of schedule.`; }
  else if (pace.diff < 0) { paceClass = 'behind'; paceText = `You're ${Math.abs(pace.diff)} task${Math.abs(pace.diff) === 1 ? '' : 's'} behind schedule.`; }

  document.getElementById('analyticsTopStats').innerHTML = `
    <div class="stat-card ring-card">
      <div class="progress-ring" style="--pct:${overall.pct}"><div class="progress-ring-inner">${overall.pct}%</div></div>
      <div>
        <div class="stat-label">Overall Progress</div>
        <div class="stat-value" style="font-size:15px">${overall.completed}/${overall.total}<span class="stat-unit">tasks</span></div>
      </div>
    </div>
    <div class="stat-card hours">
      <div class="stat-label">Hours Learned</div>
      <div class="stat-value">${hours}<span class="stat-unit">hrs</span></div>
    </div>
    <div class="stat-card streak">
      <div class="stat-label">Current Streak</div>
      <div class="stat-value">${streak}<span class="stat-unit">days</span></div>
    </div>
    <div class="stat-card" style="grid-column: span 2; display:flex; align-items:center;">
      <div class="pace-banner ${paceClass}" style="width:100%;">${paceText}<br><span style="opacity:.7">Expected by today: ${pace.expected} · Actually completed: ${pace.actual}</span></div>
    </div>`;
}

function renderObjectiveBarChart() {
  const html = DATA.objectives.slice().sort((a, b) => a.order - b.order).map(o => {
    const prog = objectiveProgress(o.id);
    const hrs = computeHoursByObjective(o.id);
    return `
      <div class="bar-row">
        <div class="bar-row-label">
          <span class="brl-name">${esc(o.name)}</span>
          <span class="brl-meta">${prog.completed}/${prog.total} · ${hrs} hrs</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${prog.pct}%;background:${o.color}"></div></div>
      </div>`;
  }).join('');
  document.getElementById('objBarChart').innerHTML = html;
}

function renderPriorityChart() {
  const breakdown = computePriorityBreakdown();
  const colors = { High: 'var(--overdue)', Medium: 'var(--accent-analytics)', Low: 'var(--text-tertiary)' };
  const order = ['High', 'Medium', 'Low'].filter(p => breakdown[p]);
  const html = order.map(p => {
    const d = breakdown[p];
    const pct = d.total ? Math.round((d.completed / d.total) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-row-label">
          <span class="brl-name">${p} priority</span>
          <span class="brl-meta">${d.completed}/${d.total} · ${pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[p]}"></div></div>
      </div>`;
  }).join('');
  document.getElementById('priorityChart').innerHTML = html || '<div class="empty-note">No priority data yet.</div>';
}

function renderWeeklyChart() {
  const weeks = computeWeeklyCompletions(8);
  const max = Math.max(1, ...weeks.map(w => w.count));
  const html = `<div class="weekly-chart">${weeks.map(w => `
    <div class="weekly-col">
      <div class="weekly-count">${w.count || ''}</div>
      <div class="weekly-bar" style="height:${(w.count / max) * 100}%"></div>
      <div class="weekly-label">${formatDateShort(w.weekStart)}</div>
    </div>`).join('')}</div>`;
  document.getElementById('weeklyChart').innerHTML = html;
}

function renderAnalytics() {
  renderAnalyticsTopStats();
  renderObjectiveBarChart();
  renderPriorityChart();
  renderWeeklyChart();
}

/* ---------------- rendering: roadmap ---------------- */

function populateFilterSelects() {
  const objSel = document.getElementById('filterObjective');
  objSel.innerHTML = '<option value="">All objectives</option>' +
    DATA.objectives.slice().sort((a, b) => a.order - b.order)
      .map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  objSel.value = filters.objective;
  refreshWeekOptions();
}

function refreshWeekOptions() {
  const weekSel = document.getElementById('filterWeek');
  const pool = filters.objective ? DATA.tasks.filter(t => t.objectiveId === filters.objective) : DATA.tasks;
  const weeks = [...new Set(pool.map(t => t.week).filter(Boolean))];
  weekSel.innerHTML = '<option value="">All weeks</option>' +
    weeks.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
  weekSel.value = filters.week && weeks.includes(filters.week) ? filters.week : '';
  if (!weeks.includes(filters.week)) filters.week = '';
}

function matchesSearch(t, term) {
  if (!term) return true;
  const blob = [t.topic, t.deliverable, t.miniProject, t.resources, t.notes, t.reflection, t.tools, t.week]
    .filter(Boolean).join(' ').toLowerCase();
  return blob.includes(term.toLowerCase());
}

function filteredTasks() {
  return DATA.tasks.filter(t =>
    (!filters.objective || t.objectiveId === filters.objective) &&
    (!filters.week || t.week === filters.week) &&
    (!filters.status || t.status === filters.status) &&
    matchesSearch(t, filters.search)
  );
}

function taskRowHTML(t) {
  const overdue = t.status !== 'Completed' && t.dueDate < todayISO();
  return `
    <div class="task-row" data-id="${t.id}">
      <div class="row-day">D${t.day}</div>
      <div class="row-topic" data-action="open" data-id="${t.id}">
        ${esc(t.topic)}
        <span class="row-week">${esc(t.week || '')}</span>
      </div>
      <div class="row-due" style="${overdue ? 'color:var(--overdue)' : ''}">${formatDateShort(t.dueDate)}</div>
      <div class="row-time">${esc(t.estimatedTime || '')}</div>
      <select class="status-select" data-action="status" data-id="${t.id}">
        ${['Not Started', 'In Progress', 'Completed'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>`;
}

function ongoingItemHTML(o) {
  return `
    <div class="ongoing-item" data-id="${o.id}">
      <div class="oi-title" data-action="open" data-id="${o.id}" style="cursor:pointer">${esc(o.topic)}</div>
      <div class="oi-meta">${esc(o.cadence || '')} · ${esc(o.estimatedTime || '')}</div>
      <select class="status-select" data-action="status" data-id="${o.id}" style="margin-top:6px">
        ${['Not Started', 'In Progress', 'Completed'].map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>`;
}

function renderRoadmap() {
  populateFilterSelects();
  const tasks = filteredTasks();
  const objectives = DATA.objectives.slice().sort((a, b) => a.order - b.order);

  const container = document.getElementById('roadmapContainer');
  container.innerHTML = objectives.map(o => {
    const objTasks = tasks.filter(t => t.objectiveId === o.id);
    if (objTasks.length === 0 && (filters.objective || filters.week || filters.status || filters.search)) return '';

    const prog = objectiveProgress(o.id);
    let body = '';

    if (o.id === 'content-marketing') {
      const sub1 = objTasks.filter(t => t.subtrack === 'content');
      const sub2 = objTasks.filter(t => t.subtrack === 'seo-geo-aeo');
      if (sub1.length) body += `<div class="subtrack-label">${esc(sub1[0].subtrackLabel)}</div>` + sub1.map(taskRowHTML).join('');
      if (sub2.length) body += `<div class="subtrack-label">${esc(sub2[0].subtrackLabel)}</div>` + sub2.map(taskRowHTML).join('');
      if (!filters.week && !filters.status && !filters.search && (!filters.objective || filters.objective === o.id)) {
        body += `<div class="subtrack-label">Ongoing Practice Loop (after Day 14 capstone)</div><div class="ongoing-block">${DATA.ongoing.map(ongoingItemHTML).join('')}</div>`;
      }
    } else {
      body = objTasks.map(taskRowHTML).join('');
    }

    if (!body) body = '<div class="empty-note" style="margin:10px 0;">No tasks match the current filters.</div>';

    return `
      <div class="objective-section" data-obj="${o.id}">
        <div class="objective-header" style="--obj-color:${o.color}" data-action="toggle-section">
          <h3>${esc(o.name)}</h3>
          <span class="obj-progress-text">${prog.completed}/${prog.total} · ${prog.pct}%</span>
          <span class="chevron">▾</span>
        </div>
        <div class="objective-body">${body}</div>
      </div>`;
  }).join('');
}

/* ---------------- modal ---------------- */

function openModal(id) {
  const item = findItem(id);
  if (!item) return;
  const isOngoing = DATA.ongoing.includes(item);
  const objName = OBJ_BY_ID[item.objectiveId] ? OBJ_BY_ID[item.objectiveId].name : '';

  let gridItems = '';
  if (!isOngoing) {
    gridItems = `
      <div class="mg-item"><div class="mg-label">Week</div><div class="mg-value">${esc(item.week || '—')}</div></div>
      <div class="mg-item"><div class="mg-label">Due Date</div><div class="mg-value">${formatDateShort(item.dueDate)}</div></div>
      <div class="mg-item"><div class="mg-label">Priority</div><div class="mg-value">${esc(item.priority)}</div></div>
      <div class="mg-item"><div class="mg-label">Est. Time</div><div class="mg-value">${esc(item.estimatedTime || '—')}</div></div>
      <div class="mg-item"><div class="mg-label">Tools</div><div class="mg-value">${esc(item.tools || '—')}</div></div>
      <div class="mg-item"><div class="mg-label">Day</div><div class="mg-value">Day ${item.day}</div></div>`;
  } else {
    gridItems = `
      <div class="mg-item"><div class="mg-label">Cadence</div><div class="mg-value">${esc(item.cadence || '—')}</div></div>
      <div class="mg-item"><div class="mg-label">Est. Time</div><div class="mg-value">${esc(item.estimatedTime || '—')}</div></div>
      <div class="mg-item"><div class="mg-label">Tools</div><div class="mg-value">${esc(item.tools || '—')}</div></div>`;
  }

  const promptsHTML = (item.reflectionPrompts && item.reflectionPrompts.length)
    ? `<ul class="reflection-prompts">${item.reflectionPrompts.map(p => `<li>· ${esc(p)}</li>`).join('')}</ul>`
    : '';

  document.getElementById('modalBody').innerHTML = `
    <div class="modal-obj-label" style="color:${objColor(item.objectiveId)}">${esc(objName)}${item.subtrackLabel ? ' · ' + esc(item.subtrackLabel) : ''}</div>
    <h2>${esc(item.topic)}</h2>
    <div class="modal-grid">${gridItems}</div>
    ${!isOngoing ? `
    <div class="modal-field"><div class="mf-label">Learning Resources</div><div class="mf-value">${esc(item.resources || '—')}</div></div>
    <div class="modal-field"><div class="mf-label">Mini Project</div><div class="mf-value">${esc(item.miniProject || '—')}</div></div>
    ` : `
    <div class="modal-field"><div class="mf-label">Review Focus</div><div class="mf-value">${esc(item.reviewFocus || '—')}</div></div>
    `}
    <div class="modal-field"><div class="mf-label">Deliverable</div><div class="mf-value">${esc(item.deliverable || '—')}</div></div>
    ${item.notes && item.notes.startsWith('Skills focus') ? `<div class="modal-field"><div class="mf-label">Skills Focus</div><div class="mf-value">${esc(item.notes)}</div></div>` : ''}

    <div class="modal-field">
      <div class="mf-label">Status</div>
      <select class="status-select-modal" id="modalStatus">
        ${['Not Started', 'In Progress', 'Completed'].map(s => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>

    <div class="modal-field">
      <div class="mf-label">Notes</div>
      <textarea id="modalNotes" rows="3" placeholder="Any notes on this task…">${item.notes && !item.notes.startsWith('Skills focus') ? esc(item.notes) : ''}</textarea>
    </div>

    <div class="modal-field">
      <div class="mf-label">Reflection</div>
      ${promptsHTML}
      <textarea id="modalReflection" rows="4" placeholder="What did you learn? What would you do differently?">${esc(item.reflection)}</textarea>
    </div>

    <div class="save-note" id="saveNote"></div>
  `;

  document.getElementById('modalStatus').addEventListener('change', e => {
    setStatus(item.id, e.target.value);
    flashSaved();
    openModal(item.id); // refresh grid/status in place
  });
  document.getElementById('modalNotes').addEventListener('input', debounce(e => {
    setNotes(item.id, e.target.value);
    flashSaved();
  }, 400));
  document.getElementById('modalReflection').addEventListener('input', debounce(e => {
    setReflection(item.id, e.target.value);
    flashSaved();
  }, 400));

  document.getElementById('taskModal').classList.remove('hidden');
}

function flashSaved() {
  const note = document.getElementById('saveNote');
  if (!note) return;
  note.textContent = 'Saved ✓';
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => { note.textContent = ''; }, 1500);
}

function closeModal() {
  document.getElementById('taskModal').classList.add('hidden');
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------------- view switching ---------------- */

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-dashboard').classList.toggle('active', view === 'dashboard');
  document.getElementById('view-roadmap').classList.toggle('active', view === 'roadmap');
  document.getElementById('view-analytics').classList.toggle('active', view === 'analytics');
  if (view === 'roadmap') renderRoadmap();
  if (view === 'analytics') renderAnalytics();
}

/* ---------------- render everything ---------------- */

function renderAll() {
  renderDashboard();
  if (currentView === 'roadmap') renderRoadmap();
  if (currentView === 'analytics') renderAnalytics();
}

/* ---------------- event delegation ---------------- */

function wireEvents() {
  document.getElementById('todayLabel').textContent = formatDateLong(todayISO());

  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchView(btn.dataset.view);
  });

  document.body.addEventListener('click', e => {
    const toggleBtn = e.target.closest('[data-action="toggle"]');
    if (toggleBtn) { toggleComplete(toggleBtn.dataset.id); return; }

    const openEl = e.target.closest('[data-action="open"]');
    if (openEl) { openModal(openEl.dataset.id); return; }

    const objPill = e.target.closest('[data-action="filter-objective"]');
    if (objPill) {
      filters.objective = objPill.dataset.id;
      filters.week = '';
      switchView('roadmap');
      return;
    }

    const sectionHeader = e.target.closest('[data-action="toggle-section"]');
    if (sectionHeader) {
      sectionHeader.closest('.objective-section').classList.toggle('collapsed');
      return;
    }

    if (e.target.id === 'modalClose' || e.target.id === 'taskModal') closeModal();
  });

  document.body.addEventListener('change', e => {
    const sel = e.target.closest('[data-action="status"]');
    if (sel) setStatus(sel.dataset.id, sel.value);
  });

  document.getElementById('filterObjective').addEventListener('change', e => {
    filters.objective = e.target.value;
    filters.week = '';
    renderRoadmap();
  });
  document.getElementById('filterWeek').addEventListener('change', e => {
    filters.week = e.target.value;
    renderRoadmap();
  });
  document.getElementById('filterStatus').addEventListener('change', e => {
    filters.status = e.target.value;
    renderRoadmap();
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    filters = { objective: '', week: '', status: '', search: '' };
    document.getElementById('globalSearch').value = '';
    renderRoadmap();
  });

  document.getElementById('globalSearch').addEventListener('input', debounce(e => {
    filters.search = e.target.value;
    if (filters.search && currentView !== 'roadmap') switchView('roadmap');
    renderRoadmap();
  }, 250));

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('taskModal').addEventListener('click', e => {
    if (e.target.id === 'taskModal') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeSettings(); }
  });

  document.getElementById('syncBadge').addEventListener('click', openSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target.id === 'settingsModal') closeSettings();
  });
  document.getElementById('syncNowBtn').addEventListener('click', saveAndSyncNow);
  document.getElementById('clearSyncBtn').addEventListener('click', disconnectSync);
}

/* ---------------- init ---------------- */

async function init() {
  SETTINGS = loadSettings();
  let remoteLoaded = false;

  if (SETTINGS.webAppUrl) {
    try {
      DATA = await fetchRemoteData(SETTINGS.webAppUrl);
      remoteLoaded = true;
    } catch (e) {
      console.error('Could not reach Google Sheet, falling back to local file:', e);
    }
  }

  if (!DATA) {
    try {
      const res = await fetch('data/tasks_data.json');
      DATA = await res.json();
    } catch (e) {
      document.getElementById('app').innerHTML = `<p style="padding:40px;color:#FF6B5E">Could not load data/tasks_data.json — make sure you're serving this folder over HTTP (not opening index.html directly from disk), e.g. via GitHub Pages or a local dev server.</p>`;
      return;
    }
  }

  DATA.objectives.forEach(o => { OBJ_BY_ID[o.id] = o; });

  if (remoteLoaded) {
    setSyncBadge('connected');
  } else if (SETTINGS.webAppUrl) {
    setSyncBadge('error'); // URL configured but unreachable this session — using local cache below
    const savedState = loadState();
    applyState(savedState);
  } else {
    setSyncBadge('local');
    // Local mode still layers saved progress from this browser on top of the bundled file
    const savedState = loadState();
    applyState(savedState);
  }

  wireEvents();
  renderAll();
}

init();
