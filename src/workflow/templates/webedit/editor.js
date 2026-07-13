// awok editor — navy redesign (ported from docs/dev/Awok Editor.dc.html).
// depends_on stays the source of truth; levels are a derived visual abstraction
// (compute_levels on the server). Drag rewires dependencies safely (anti-cycle
// preserved via safeDropDepends/blockedDependents) — NOT a persisted level.
import { safeDropDepends, blockedDependents, buildNotice,
         opportunisticMode, opportunisticGuidance, setOpportunistic,
         globalOpportunisticState, setGlobalOpportunistic, resolvedOppLabel,
         applyPhaseGroup, validateModel, classifyLinkSpan,
         aggregateInvocationIo, iterBlocks, blockConstruct, findBlock } from "./editlogic.js";
import { makeCard, helpNote, helpIcon, labelWithHelp } from "./render-helpers.js";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor, stringListEditor } from "./formfields.js";
import { createDataflow } from "./dataflow.js";
import * as orch from "./orchestration.js";

const $ = s => document.querySelector(s);
const api = (m, p, b) => fetch(p, { method: m, headers: { "Content-Type": "application/json" },
  body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, j: await r.json() }));

// Proto group palette — assigned by group declaration order (spec §2).
const GROUP_PALETTE = ["#60a5fa", "#4ade80", "#fbbf24", "#c084fc", "#f87171", "#38bdf8", "#fb923c", "#a3e635"];
function resolveGroupColors(model) {
  const colors = {};
  Object.keys((model && model.groups) || {}).forEach((g, i) => { colors[g] = GROUP_PALETTE[i % GROUP_PALETTE.length]; });
  return colors;
}
const TYPE_COLORS = {
  main_agent: "#38bdf8", agent: "#34d399", script: "#fbbf24", external: "#94a3b8", workflow_call: "#c084fc",
};

let state = {
  name: null, model: null, view: null, selected: null, workflows: [], agents: [],
  tab: "grid", drawerTab: "wiring", panelWidth: 480, showLinks: false,
  dragId: null, legendOpen: true,
  showOrch: false, selectedGate: null,
};

let dataflow = null;

// --- notice overlay --------------------------------------------------------
function showNotice(title, lines) {
  document.querySelectorAll(".notice-overlay").forEach(n => n.remove());
  const ov = document.createElement("div"); ov.className = "notice-overlay";
  const box = buildNotice(title, lines);
  const btn = document.createElement("button"); btn.textContent = "Got it";
  btn.addEventListener("click", () => ov.remove());
  box.appendChild(btn); ov.appendChild(box);
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
function setStatus(t) { $("#status").textContent = t; }

// --- load / view -----------------------------------------------------------
async function loadList() {
  state.workflows = (await api("GET", "/api/workflows")).j || [];
  state.agents = (await api("GET", "/api/agents")).j || [];
  renderWorkflowSelect();
  if (!state.workflows.length) return;
  const want = new URLSearchParams(location.search).get("workflow");
  const initial = (want && state.workflows.includes(want)) ? want : state.workflows[0];
  $("#wf-select").value = initial;
  await loadWorkflow(initial);
}
function renderWorkflowSelect() {
  const sel = $("#wf-select"); sel.replaceChildren();
  state.workflows.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
}
let _blkSeq = 0;
function hydrateBlockIds(model) {
  _blkSeq = 0;
  if (!model || !model.orchestration) return;
  iterBlocks(model.orchestration, b => { if (!b._id) b._id = "b" + (++_blkSeq); });
}
async function loadWorkflow(name) {
  const switching = name !== state.name;   // real switch vs. same-workflow reload (e.g. after Save)
  const { j } = await api("GET", "/api/workflow/" + name);
  state = { ...state, name, model: j.model, view: null, selected: null };
  hydrateBlockIds(state.model);
  state.showOrch = !!(state.model.orchestration && state.model.orchestration.length);
  state.selectedGate = null;
  $("#toggle-orch").classList.toggle("on", state.showOrch);
  $("#add-gate").hidden = !state.showOrch;
  state.savedSnapshot = snapshot();              // baseline for unsaved-changes detection
  if (switching && dataflow) dataflow.reset();   // drop the previous workflow's dataflow filters
  $("#edit-panel").hidden = true;
  applyDrawerLayout();
  await refreshView();
}
async function refreshView() {
  const { j } = await api("POST", "/api/view", state.model);
  state.view = j;
  renderHeader();
  renderGrid();
  renderYaml();
  renderIssues();
  if (state.tab === "dataflow") dataflow.render();
  setStatus(j.errors && j.errors.length ? "⚠ " + j.errors.length + " schema issue(s)" : "");
}

function renderHeader() {
  const m = state.model || {};
  const nP = (m.phases || []).length, nG = Object.keys(m.groups || {}).length;
  $("#grid-count").textContent = nP + " actions · " + nG + " groups";
  $("#settings-wf").textContent = state.name || "";
  const sub = ((m.skill && m.skill.description) || "").split("\n")[0] || "";
  $("#wf-subtitle").textContent = sub;
}
function renderIssues() {
  const v = validateModel(state.model);
  const badge = $("#issues-badge");
  if (!v.errors.length && !v.warnings.length) { badge.hidden = true; return; }
  badge.hidden = false; badge.replaceChildren();
  badge.title = v.errors.concat(v.warnings).join("\n");
  if (v.errors.length) { const s = document.createElement("span"); s.className = "err"; s.textContent = "⛔ " + v.errors.length; badge.appendChild(s); }
  if (v.warnings.length) { const s = document.createElement("span"); s.className = "warn"; s.textContent = "⚠ " + v.warnings.length; badge.appendChild(s); }
}

// --- grid ------------------------------------------------------------------
function rowsFromView() {
  const lv = (state.view && state.view.levels) || {};
  const max = Math.max(0, ...Object.values(lv));
  const rows = []; for (let i = 0; i <= max; i++) rows.push([]);
  (state.model.phases || []).forEach(p => rows[lv[p.id] || 0].push(p.id));
  return rows;
}
function renderGrid() {
  if (state.showOrch) { orch.renderProgram({ state, refreshView, selectPhase, resolveGroupColors,
      onDrop: () => {}, onSelectGate: selectGate, rerender: () => { renderGrid(); applyDrawerLayout(); } });
    renderLegend(resolveGroupColors(state.model)); schedulePaint(); return; }
  const grid = $("#grid"); grid.replaceChildren();
  const rows = rowsFromView();
  const byId = {}; (state.model.phases || []).forEach(p => byId[p.id] = p);
  const colors = resolveGroupColors(state.model);
  const oppPhases = (state.view && state.view.opportunistic && state.view.opportunistic.phases) || {};
  rows.forEach((ids, i) => {
    if (i > 0) grid.appendChild(makeDropZone(i)); // zone above each level after the first
    grid.appendChild(makeRow(ids, i, byId, colors, oppPhases));
  });
  grid.appendChild(makeDropZone(rows.length, true)); // trailing "new level"
  renderLegend(colors);
  schedulePaint();
}
function makeDropZone(level, isNew) {
  const z = document.createElement("div"); z.className = "drop-zone";
  const lbl = document.createElement("span"); lbl.className = "zone-label";
  lbl.textContent = isNew ? "+ drop here for a new level" : "+ drop here";
  z.appendChild(lbl);
  z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("hover"); });
  z.addEventListener("dragleave", () => z.classList.remove("hover"));
  z.addEventListener("drop", e => { z.classList.remove("hover"); onDrop(e, level); });
  return z;
}
function makeRow(ids, i, byId, colors, oppPhases) {
  const row = document.createElement("div"); row.className = "row"; row.dataset.level = i;
  // rail
  const rail = document.createElement("div"); rail.className = "rail";
  const top = document.createElement("div"); top.className = "rail-line" + (i === 0 ? " blank" : "");
  const nodeWrap = document.createElement("div"); nodeWrap.className = "rail-node-wrap";
  const cap = document.createElement("div"); cap.className = "rail-cap"; cap.textContent = "Lvl";
  const node = document.createElement("div"); node.className = "rail-node"; node.textContent = i + 1;
  const dotColor = ids.length ? (colors[byId[ids[0]].group] || "#243049") : "#243049";
  node.style.borderColor = dotColor;
  nodeWrap.appendChild(cap); nodeWrap.appendChild(node);
  const bot = document.createElement("div"); bot.className = "rail-line";
  rail.appendChild(top); rail.appendChild(nodeWrap); rail.appendChild(bot);
  row.appendChild(rail);
  // cards
  const cards = document.createElement("div"); cards.className = "row-cards";
  ids.forEach(id => {
    const p = byId[id];
    const oppMark = (oppPhases[id] || {}).mark;
    const card = makeCard(p, colors[p.group], oppMark);
    if (id === state.selected) card.classList.add("selected");
    card.addEventListener("dragstart", e => {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", id); } catch (_) {}
      state.dragId = id; document.body.classList.add("dragging");
      setTimeout(() => card.classList.add("dragging"), 0);
    });
    card.addEventListener("dragend", () => { state.dragId = null; document.body.classList.remove("dragging"); card.classList.remove("dragging"); });
    card.addEventListener("click", () => selectPhase(id));
    cards.appendChild(card);
  });
  cards.addEventListener("dragover", e => { e.preventDefault(); if (state.dragId) row.classList.add("drop-row"); });
  cards.addEventListener("dragleave", () => row.classList.remove("drop-row"));
  cards.addEventListener("drop", e => { row.classList.remove("drop-row"); onDrop(e, i); });
  row.appendChild(cards);
  return row;
}
async function onDrop(ev, level) {
  ev.preventDefault();
  const id = ev.dataTransfer.getData("text/plain") || state.dragId;
  state.dragId = null; document.body.classList.remove("dragging");
  const p = (state.model.phases || []).find(x => x.id === id); if (!p) return;
  const rows = rowsFromView();
  const blocked = blockedDependents(state.model.phases, rows, level, id);
  p.depends_on = safeDropDepends(state.model.phases, rows, level, id);
  if (!p.depends_on.length) delete p.depends_on;
  await refreshView();
  if (blocked.length) {
    setStatus("↪ " + id + ": constrained move (anti-cycle)");
    showNotice("Constrained move — " + id, [
      "These actions already depend on " + id + ": " + blocked.join(", ") + ".",
      id + " cannot depend on them (that would create a cycle).",
      "To place it lower, first remove those links (in their Wiring panel), then move it again.",
    ]);
  }
  if (state.selected) selectPhase(state.selected);
}

// --- dependency overlay ----------------------------------------------------
let _paintScheduled = false;
function schedulePaint() {
  if (_paintScheduled) return; _paintScheduled = true;
  requestAnimationFrame(() => { _paintScheduled = false; paintDepLinks(); });
  setTimeout(paintDepLinks, 220); // catch the drawer/reflow transition
}
function paintDepLinks() {
  const svg = $("#dep-svg"); if (!svg) return;
  if (!state.showLinks || state.tab !== "grid" || !state.model) { svg.innerHTML = ""; return; }
  const root = $("#grid-inner"); const rr = root.getBoundingClientRect();
  const colors = resolveGroupColors(state.model);
  const lvl = (state.view && state.view.levels) || {};
  const rects = {};
  root.querySelectorAll(".phase-card").forEach(el => rects[el.dataset.id] = el.getBoundingClientRect());
  // Orchestration (ON) view: a dep crossing a top-level block boundary points at
  // the enclosing gate element (data-block-top), not at the nested ref card —
  // action->block. Same-block deps keep the classic action->action routing.
  let topOf = null, topEl = null;
  if (state.showOrch) {
    topEl = {};
    root.querySelectorAll("[data-block-top]").forEach(el => topEl[el.dataset.blockTop] = el);
    topOf = {};
    (state.model.orchestration || []).forEach(tb => iterBlocks([tb], b => {
      if (blockConstruct(b) === "ref" && !(b.ref in topOf)) topOf[b.ref] = tb._id;
    }));
  }
  const links = [];
  for (const p of state.model.phases || []) for (const dep of p.depends_on || []) {
    if (!(rects[dep] && rects[p.id])) continue;
    let aRect = rects[dep], bRect = rects[p.id];
    if (topOf && topOf[dep] !== topOf[p.id]) {
      const gate = topEl[topOf[p.id]];
      if (gate) bRect = gate.getBoundingClientRect();
    }
    links.push({ from: dep, to: p.id, color: colors[p.group] || "#38bdf8", aRect, bRect });
  }
  const direct = [], far = [], same = [];
  for (const l of links) {
    const cls = classifyLinkSpan(lvl[l.from], lvl[l.to]);
    (cls === "same" ? same : cls === "far" ? far : direct).push({ a: l.aRect, b: l.bRect, color: l.color });
  }
  const seg = (d, arrow, c) => '<path d="' + d + '" stroke="' + c + '" stroke-width="1.8" opacity="0.62"/>' +
    '<polygon points="' + arrow + '" fill="' + c + '" opacity="0.85"/>';
  const out = [];
  for (const it of direct) {
    const sx = it.a.left - rr.left + it.a.width / 2, sy = it.a.bottom - rr.top;
    const tx = it.b.left - rr.left + it.b.width / 2, ty = it.b.top - rr.top;
    const dy = Math.max(16, (ty - sy) / 2);
    out.push(seg("M " + sx + " " + sy + " C " + sx + " " + (sy + dy) + ", " + tx + " " + (ty - dy) + ", " + tx + " " + ty,
      (tx - 4) + "," + (ty - 8) + " " + (tx + 4) + "," + (ty - 8) + " " + tx + "," + (ty - 1), it.color));
  }
  const fi = far.map(it => {
    const sx = it.a.right - rr.left, sy = it.a.top - rr.top + it.a.height / 2;
    const tx = it.b.right - rr.left, ty = it.b.top - rr.top + it.b.height / 2;
    return { it, sx, sy, tx, ty, yMin: Math.min(sy, ty), yMax: Math.max(sy, ty) };
  });
  fi.sort((p, q) => p.yMin - q.yMin);
  const laneEnds = [];
  fi.forEach(f => { let lane = laneEnds.findIndex(end => end <= f.yMin + 6); if (lane < 0) lane = laneEnds.length; laneEnds[lane] = f.yMax; f.lane = lane; });
  for (const f of fi) {
    const gx = Math.max(f.sx, f.tx) + 28 + f.lane * 20;
    out.push(seg("M " + f.sx + " " + f.sy + " C " + gx + " " + f.sy + ", " + gx + " " + f.ty + ", " + f.tx + " " + f.ty,
      (f.tx + 8) + "," + (f.ty - 4) + " " + (f.tx + 8) + "," + (f.ty + 4) + " " + (f.tx + 1) + "," + f.ty, f.it.color));
  }
  for (const it of same) {
    const a = it.a, b = it.b;
    const aCx = a.left - rr.left + a.width / 2, aCy = a.top - rr.top + a.height / 2;
    const bCx = b.left - rr.left + b.width / 2, bCy = b.top - rr.top + b.height / 2;
    if (Math.abs(aCy - bCy) >= Math.abs(aCx - bCx)) {
      const down = aCy <= bCy;
      const sx = aCx, sy = down ? a.bottom - rr.top : a.top - rr.top;
      const tx = bCx, ty = down ? b.top - rr.top : b.bottom - rr.top;
      const dy = Math.max(12, Math.abs(ty - sy) / 2) * (down ? 1 : -1);
      const arrow = down ? (tx - 4) + "," + (ty - 8) + " " + (tx + 4) + "," + (ty - 8) + " " + tx + "," + (ty - 1)
        : (tx - 4) + "," + (ty + 8) + " " + (tx + 4) + "," + (ty + 8) + " " + tx + "," + (ty + 1);
      out.push(seg("M " + sx + " " + sy + " C " + sx + " " + (sy + dy) + ", " + tx + " " + (ty - dy) + ", " + tx + " " + ty, arrow, it.color));
    } else {
      const right = aCx <= bCx;
      const sx = right ? a.right - rr.left : a.left - rr.left;
      const tx = right ? b.left - rr.left : b.right - rr.left;
      const sy = aCy, ty = bCy, mx = (sx + tx) / 2;
      const arrow = right ? (tx - 7) + "," + (ty - 4) + " " + (tx - 7) + "," + (ty + 4) + " " + (tx - 1) + "," + ty
        : (tx + 7) + "," + (ty - 4) + " " + (tx + 7) + "," + (ty + 4) + " " + (tx + 1) + "," + ty;
      out.push(seg("M " + sx + " " + sy + " C " + mx + " " + sy + ", " + mx + " " + ty + ", " + tx + " " + ty, arrow, it.color));
    }
  }
  svg.innerHTML = out.join("");
}

// --- groups legend ---------------------------------------------------------
function renderLegend(colors) {
  const root = $("#groups-legend"); root.replaceChildren();
  const m = state.model; const groups = m.groups || {};
  const head = document.createElement("div"); head.className = "legend-head";
  const left = document.createElement("span");
  left.appendChild(document.createTextNode("Groups"));
  const cnt = document.createElement("span"); cnt.className = "count"; cnt.textContent = Object.keys(groups).length;
  left.appendChild(cnt); head.appendChild(left);
  const caret = document.createElement("span"); caret.style.color = "#64748b"; caret.style.fontSize = "10px";
  caret.textContent = state.legendOpen ? "▾" : "▸"; head.appendChild(caret);
  head.style.cursor = "pointer";
  head.addEventListener("click", () => { state.legendOpen = !state.legendOpen; renderLegend(colors); });
  root.appendChild(head);
  if (!state.legendOpen) return;
  const body = document.createElement("div"); body.className = "legend-body";
  const rows = document.createElement("div"); rows.className = "legend-rows";
  const RISK = ["none", "low", "medium", "high"];
  Object.keys(groups).forEach((g, i) => {
    const row = document.createElement("div"); row.className = "legend-row";
    const sw = document.createElement("div"); sw.className = "legend-swatch"; sw.style.background = colors[g] || GROUP_PALETTE[i % GROUP_PALETTE.length];
    row.appendChild(sw);
    const fields = document.createElement("div"); fields.className = "legend-fields";
    const top = document.createElement("div"); top.className = "top";
    const nameIn = document.createElement("input"); nameIn.className = "legend-name"; nameIn.value = g;
    nameIn.addEventListener("change", () => renameGroup(g, nameIn.value));
    top.appendChild(nameIn);
    const risk = groups[g].risk || "none";
    const rb = document.createElement("button"); rb.className = "risk-btn risk-" + risk; rb.textContent = risk; rb.title = "Click to change risk";
    rb.addEventListener("click", () => { groups[g].risk = RISK[(RISK.indexOf(risk) + 1) % 4]; refreshView(); });
    top.appendChild(rb);
    fields.appendChild(top);
    const desc = document.createElement("input"); desc.className = "legend-desc"; desc.value = groups[g].description || ""; desc.placeholder = "description";
    desc.addEventListener("change", () => { groups[g].description = desc.value; refreshView(); });
    fields.appendChild(desc);
    row.appendChild(fields);
    rows.appendChild(row);
  });
  body.appendChild(rows);
  const add = document.createElement("button"); add.className = "legend-add"; add.textContent = "+ group";
  add.addEventListener("click", addGroup); body.appendChild(add);
  root.appendChild(body);
}
function renameGroup(old, raw) {
  const v = (raw || "").trim(); if (!v || v === old) return;
  const m = state.model;
  if (m.groups[v] && v !== old) { setStatus("group " + v + " already exists"); return; }
  m.groups[v] = m.groups[old]; delete m.groups[old];
  (m.phases || []).forEach(p => { if (p.group === old) p.group = v; });
  refreshView().then(() => { if (state.selected) selectPhase(state.selected); });
}
function addGroup() {
  const m = state.model; m.groups = m.groups || {};
  let n = "group", i = 1; while (m.groups[n]) n = "group" + (++i);
  m.groups[n] = { description: "", risk: "none" };
  refreshView();
}

// --- drawer (action editor) ------------------------------------------------
function applyDrawerLayout() {
  // The drawer only belongs to the Grid view — hide it (without losing the
  // selection) when the user switches to Dataflow/Settings/YAML.
  const open = (!!state.selected || !!state.selectedGate) && state.tab === "grid";
  document.body.classList.toggle("drawer-open", open);
  $("#edit-panel").hidden = !open;
  $("#panel-grid").style.marginRight = open ? state.panelWidth + "px" : "";
  schedulePaint();
}
function curPhase() { return (state.model.phases || []).find(x => x.id === state.selected); }

function selectPhase(id) {
  state.selected = id; state.selectedGate = null;
  const p = curPhase(); if (!p) return;
  const panel = $("#edit-panel"); panel.hidden = false; panel.replaceChildren();
  panel.style.width = state.panelWidth + "px";
  ensureResizeGrip(panel);
  const colors = resolveGroupColors(state.model);

  // header
  const head = document.createElement("div"); head.className = "drawer-head";
  const top = document.createElement("div"); top.className = "top";
  const badge = document.createElement("span"); badge.className = "badge"; badge.dataset.type = p.type || "agent"; badge.textContent = p.type || "agent";
  top.appendChild(badge);
  const grp = document.createElement("span"); grp.className = "group-label"; grp.style.marginLeft = "0"; grp.textContent = p.group || ""; grp.style.color = colors[p.group] || "#94a3b8";
  top.appendChild(grp);
  const close = document.createElement("button"); close.className = "drawer-close"; close.textContent = "×";
  close.addEventListener("click", closeDrawer); top.appendChild(close);
  head.appendChild(top);
  const idIn = document.createElement("input"); idIn.className = "drawer-id"; idIn.value = p.id;
  idIn.addEventListener("change", () => renamePhase(idIn.value));
  head.appendChild(idIn);
  panel.appendChild(head);

  // body
  const body = document.createElement("div"); body.className = "drawer-body";
  drawPriorityFields(body, p);
  drawSegmented(body, p);
  panel.appendChild(body);

  // footer
  const foot = document.createElement("div"); foot.className = "drawer-foot";
  const del = document.createElement("button"); del.className = "btn-del"; del.textContent = "Delete action";
  del.addEventListener("click", deletePhase); foot.appendChild(del);
  const done = document.createElement("button"); done.className = "btn-done"; done.textContent = "Done";
  done.addEventListener("click", closeDrawer); foot.appendChild(done);
  panel.appendChild(foot);

  applyDrawerLayout();
  renderGrid();
}
function closeDrawer() { state.selected = null; state.selectedGate = null; $("#edit-panel").hidden = true; applyDrawerLayout(); renderGrid(); }

// --- drawer (gate editor — Task 10) -----------------------------------------
// Selecting an ON-path gate (orchestration block) opens the gate panel instead
// of the phase drawer; selecting an action still goes through selectPhase
// unchanged. Mutually exclusive with state.selected (only one drawer at a time).
function selectGate(id) {
  state.selectedGate = id; state.selected = null;
  const f = findBlock(state.model.orchestration || [], id); if (!f) return;
  const panel = $("#edit-panel"); panel.hidden = false; panel.replaceChildren();
  panel.style.width = state.panelWidth + "px"; ensureResizeGrip(panel);
  panel.appendChild(orch.gatePanel({ state, refreshView, rerender: () => { renderGrid(); }, close: closeGate,
    setStatus, reselectGate: () => selectGate(id) }, f.block));
  applyDrawerLayout(); renderGrid();
}
function closeGate() { state.selectedGate = null; $("#edit-panel").hidden = true; applyDrawerLayout(); renderGrid(); }

function drawPriorityFields(body, p) {
  body.appendChild(fieldText("Name", p.name || "", v => { p.name = v; refreshView(); }));
  const row2 = document.createElement("div"); row2.className = "row-2";
  const typeR = fieldSelect("Type", p.type || "agent", ["main_agent", "agent", "script", "external", "workflow_call"],
    v => { p.type = v; refreshView().then(() => selectPhase(p.id)); });
  typeR.querySelector("label").appendChild(helpIcon("main_agent = driven by the main agent · agent = invokes sub-agents · script = shell command · external = produced outside the workflow · workflow_call = calls another workflow."));
  const grpR = fieldDatalist("Group", p.group || "", Object.keys(state.model.groups || {}), v => { if (applyPhaseGroup(state.model, p, v)) refreshView().then(() => selectPhase(p.id)); });
  const c1 = document.createElement("div"); c1.appendChild(typeR);
  const c2 = document.createElement("div"); c2.appendChild(grpR);
  row2.appendChild(c1); row2.appendChild(c2); body.appendChild(row2);

  body.appendChild(toggleRow("Interactive", "Pauses for the maintainer instead of running straight through",
    !!p.interactive, false, () => { p.interactive = !p.interactive; if (!p.interactive) delete p.interactive; refreshView().then(() => selectPhase(p.id)); }));

  body.appendChild(fieldTextarea("Description", p.description || "", v => { if (v) p.description = v; else delete p.description; refreshView(); }));

  if (p.type === "script") {
    const box = document.createElement("div"); box.className = "cmd-box";
    box.appendChild(fieldTextarea("Command", p.cmd || "", v => { if (v) p.cmd = v; else delete p.cmd; refreshView(); }));
    box.appendChild(helpNote("Shell commands run when this action executes. Reference input artifacts via env vars."));
    body.appendChild(box);
  }
  if (p.type === "workflow_call") {
    const opts = ["", ...(state.workflows || []).filter(n => n !== state.name)];
    const w = fieldSelect("Workflow", p.workflow || "", opts, v => { if (v) p.workflow = v; else delete p.workflow; refreshView(); });
    w.querySelector("label").appendChild(helpIcon("Workflow to dispatch as a sub-step (must exist in src/workflows/)."));
    body.appendChild(w);
  }
}
function toggleRow(title, sub, on, warn, onClick) {
  const r = document.createElement("div"); r.className = "toggle-row";
  const sw = document.createElement("div"); sw.className = "switch" + (warn ? " warn" : "") + (on ? " on" : "");
  const knob = document.createElement("div"); knob.className = "knob"; sw.appendChild(knob);
  r.appendChild(sw);
  const txt = document.createElement("div"); txt.className = "toggle-text";
  const t = document.createElement("div"); t.className = "t"; t.textContent = title;
  const s = document.createElement("div"); s.className = "s"; s.textContent = sub;
  txt.appendChild(t); txt.appendChild(s); r.appendChild(txt);
  r.style.cursor = "pointer";
  r.addEventListener("click", onClick);
  return r;
}

function drawSegmented(body, p) {
  const tabs = [
    { key: "wiring", label: "Wiring", render: b => tabWiring(b, p) },
    { key: "autonomy", label: "Autonomy", render: b => tabAutonomy(b, p) },
    { key: "invocations", label: "Invocations", render: b => tabInvocations(b, p) },
    { key: "triggers", label: "Triggers", render: b => tabTriggers(b, p) },
  ];
  if (!tabs.some(t => t.key === state.drawerTab)) state.drawerTab = "wiring";
  const seg = document.createElement("div"); seg.className = "seg";
  const content = document.createElement("div");
  const draw = () => {
    content.replaceChildren();
    (tabs.find(t => t.key === state.drawerTab) || tabs[0]).render(content);
    [...seg.children].forEach(b => b.classList.toggle("active", b.dataset.k === state.drawerTab));
  };
  tabs.forEach(t => { const b = document.createElement("button"); b.dataset.k = t.key; b.textContent = t.label;
    b.addEventListener("click", () => { state.drawerTab = t.key; draw(); }); seg.appendChild(b); });
  body.appendChild(seg); body.appendChild(content); draw();
}

function tabWiring(body, p) {
  // depends_on
  const head = labelWithHelp("Depends on", "Actions that must finish before this one. You can also drag the card onto another level (the dependency is rewired safely — no cycles).");
  head.className = "sub-head"; head.style.margin = "0 0 8px"; body.appendChild(head);
  const chips = document.createElement("div"); chips.className = "dep-chips";
  const deps = p.depends_on || [];
  if (!deps.length) { const m = document.createElement("span"); m.className = "muted-note"; m.textContent = "No dependencies — runs first."; chips.appendChild(m); }
  deps.forEach(d => {
    const chip = document.createElement("span"); chip.className = "dep-chip"; chip.appendChild(document.createTextNode(d));
    const x = document.createElement("button"); x.textContent = "×";
    x.addEventListener("click", () => { p.depends_on = (p.depends_on || []).filter(v => v !== d); if (!p.depends_on.length) delete p.depends_on; refreshView().then(() => selectPhase(p.id)); });
    chip.appendChild(x); chips.appendChild(chip);
  });
  body.appendChild(chips);
  // add dep — exclude self, current deps, and descendants (anti-cycle)
  const desc = descendantSet(p.id);
  const avail = (state.model.phases || []).filter(x => x.id !== p.id && !deps.includes(x.id) && !desc.has(x.id)).map(x => x.id);
  if (avail.length) {
    const sel = document.createElement("select"); sel.style.marginTop = "9px";
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "+ add dependency…"; sel.appendChild(o0);
    avail.forEach(a => { const o = document.createElement("option"); o.value = a; o.textContent = a; sel.appendChild(o); });
    sel.addEventListener("change", () => { if (!sel.value) return; p.depends_on = p.depends_on || []; p.depends_on.push(sel.value); refreshView().then(() => selectPhase(p.id)); });
    body.appendChild(sel);
  }
  // inputs / outputs (the io editor labels itself; coloured via .io-in/.io-out wrappers)
  const inWrap = document.createElement("div"); inWrap.className = "io-in"; inWrap.style.marginTop = "18px";
  inWrap.appendChild(ioRefEditor("inputs", p.inputs || [], next => { if (next.length) p.inputs = next; else delete p.inputs; refreshView(); }, state.model.namespaces));
  body.appendChild(inWrap);
  const outWrap = document.createElement("div"); outWrap.className = "io-out"; outWrap.style.marginTop = "16px";
  outWrap.appendChild(ioRefEditor("outputs", p.outputs || [], next => { if (next.length) p.outputs = next; else delete p.outputs; refreshView(); }, state.model.namespaces));
  body.appendChild(outWrap);

  // Agent actions usually declare their files per-invocation — surface them here
  // (read-only) so the Wiring tab is never misleadingly empty. They're editable
  // in the Invocations tab → Advanced.
  const agg = aggregateInvocationIo(p);
  if (agg.length) {
    const roll = document.createElement("div"); roll.className = "io-rollup";
    const h = document.createElement("div"); h.className = "sub-head";
    h.appendChild(document.createTextNode("From invocations "));
    h.appendChild(helpIcon("These files are declared per-invocation (this is an agent action). They're editable in the Invocations tab under “Advanced”."));
    roll.appendChild(h);
    agg.forEach(g => {
      const c = document.createElement("div"); c.className = "rollup-card";
      const t = document.createElement("div"); t.className = "rollup-agent"; t.textContent = "▸ " + g.agent; c.appendChild(t);
      const line = (cls, label, items) => { if (!items.length) return; const d = document.createElement("div"); d.className = "rollup-line " + cls; d.textContent = label + " " + items.map(io => (io.role || io.path || "") + (io.optional ? "?" : "")).join(", "); c.appendChild(d); };
      line("in", "in ", g.inputs); line("out", "out", g.outputs);
      roll.appendChild(c);
    });
    body.appendChild(roll);
  }
}
function descendantSet(id) {
  const dependents = {};
  for (const p of state.model.phases || []) for (const d of p.depends_on || []) (dependents[d] = dependents[d] || []).push(p.id);
  const out = new Set(); const stack = [...(dependents[id] || [])];
  while (stack.length) { const c = stack.pop(); if (out.has(c)) continue; out.add(c); for (const n of dependents[c] || []) stack.push(n); }
  return out;
}

function tabAutonomy(body, p) {
  const mode = opportunisticMode(p);
  const g = opportunisticGuidance(p);
  // 3-state segmented control (inherit / enabled / locked) — friendly + faithful.
  const seg = document.createElement("div"); seg.className = "seg";
  [["inherit", "Inherit"], ["enabled", "Enabled"], ["locked", "Locked"]].forEach(([k, lbl]) => {
    const b = document.createElement("button"); b.textContent = lbl; if (k === mode) b.classList.add("active");
    b.addEventListener("click", () => { setOpportunistic(p, k, g.when, g.examples); if (k === "inherit") delete p.opportunistic; refreshView().then(() => selectPhase(p.id)); });
    seg.appendChild(b);
  });
  body.appendChild(seg);
  const help = helpNote("inherit = use the workflow default · enabled = the main agent may author & launch an ad-hoc sub-agent here · locked = explicitly forbid it on this deterministic/sensitive action.");
  body.appendChild(help);
  if (mode === "enabled") {
    body.appendChild(fieldTextarea("When", g.when, v => { setOpportunistic(p, "enabled", v, g.examples); refreshView().then(() => selectPhase(p.id)); }));
    body.appendChild(stringListEditor("Examples", g.examples, arr => { setOpportunistic(p, "enabled", g.when, arr); refreshView().then(() => selectPhase(p.id)); }));
  }
  const prev = document.createElement("div"); prev.className = "opp-resolved";
  prev.textContent = "Resolved: " + (resolvedOppLabel(state.view && state.view.opportunistic, p.id) || "—");
  body.appendChild(prev);
}

function tabTriggers(body, p) {
  body.appendChild(helpNote("What makes this action run. By default it fires when the previous stage completes — add triggers to fire on a produced artifact, an event, or a threshold."));
  body.appendChild(triggerEditor("triggers", p.triggers || [], next => { if (next.length) p.triggers = next; else delete p.triggers; refreshView(); }));
}

function tabInvocations(body, p) {
  if (p.type !== "agent") {
    const note = document.createElement("div"); note.className = "help-note";
    note.style.cssText = "padding:14px;background:var(--well);border:1px dashed var(--border);border-radius:8px;font-size:12.5px;color:var(--dim)";
    note.textContent = "Invocations apply to agent-type actions. Switch the type to agent to wire sub-agents here.";
    body.appendChild(note); return;
  }
  (p.invocations || []).forEach((inv, idx) => body.appendChild(invocationCard(p, inv, idx)));
  if ((state.agents || []).length) {
    const pick = document.createElement("select"); pick.className = "inv-add"; pick.style.cssText = "";
    const wrap = document.createElement("div");
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "+ add invocation (existing agent)…"; pick.appendChild(o0);
    state.agents.forEach(a => { const o = document.createElement("option"); o.value = a; o.textContent = a; pick.appendChild(o); });
    pick.addEventListener("change", () => { if (!pick.value) return; p.invocations = p.invocations || []; if (!p.invocations.some(i => i.agent === pick.value)) p.invocations.push({ agent: pick.value }); refreshView().then(() => selectPhase(p.id)); });
    wrap.appendChild(pick); body.appendChild(wrap);
  } else { body.appendChild(helpNote("No agent in src/agents/.")); }
  const create = document.createElement("button"); create.className = "add-mini"; create.style.marginTop = "8px"; create.textContent = "+ create a new agent…";
  create.addEventListener("click", openAgentForm); body.appendChild(create);
}
function invocationCard(p, inv, idx) {
  const box = document.createElement("div"); box.className = "inv-card";
  const top = document.createElement("div"); top.className = "inv-top";
  const ag = document.createElement("select"); ag.className = "inv-agent";
  const names = [...new Set([...(state.agents || []), inv.agent].filter(Boolean))];
  names.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; if (n === inv.agent) o.selected = true; ag.appendChild(o); });
  const oNew = document.createElement("option"); oNew.value = "__new"; oNew.textContent = "+ new agent…"; ag.appendChild(oNew);
  ag.addEventListener("change", () => {
    if (ag.value === "__new") { openAgentForm(); selectPhase(p.id); return; }
    inv.agent = ag.value; refreshView().then(() => selectPhase(p.id));
  });
  top.appendChild(ag);
  const model = document.createElement("select"); model.className = "inv-model"; model.title = "Model for this sub-agent. “inherit” = the session/main-agent model.";
  ["inherit", "haiku", "sonnet", "opus"].forEach(mm => { const o = document.createElement("option"); o.value = mm; o.textContent = mm; if (mm === (inv.model || "inherit")) o.selected = true; model.appendChild(o); });
  model.addEventListener("change", () => {
    if (model.value === "inherit") delete inv.model; else inv.model = model.value;
    if (model.value === "haiku") delete inv.effort;   // haiku errors on effort — drop the dead pin
    refreshView().then(() => selectPhase(p.id));       // rebuild the card so the effort select re-gates
  });
  top.appendChild(model);
  // Reasoning effort, configured per-invocation alongside the model. At `awok deploy` it's
  // written into the sub-agent's frontmatter (the Task tool has no effort arg), where it
  // overrides the session effort. Absent / "inherit" → the sub-agent runs at the main agent's
  // effort (kept out of the YAML). haiku can't run effort, so the selector is disabled there.
  const effortOff = inv.model === "haiku";
  const effort = document.createElement("select"); effort.className = "inv-effort"; effort.disabled = effortOff;
  const effortTip = effortOff
    ? "Haiku doesn't support reasoning effort — switch the model to sonnet/opus to set it."
    : "Reasoning effort — written into the sub-agent's frontmatter at deploy (overrides the session effort; the Task tool has no effort argument). “inherit” = the session/main-agent effort.";
  ["inherit", "low", "medium", "high", "xhigh", "max"].forEach(ef => { const o = document.createElement("option"); o.value = ef; o.textContent = ef === "inherit" ? "effort: inherit" : "effort: " + ef; if (ef === (inv.effort || "inherit")) o.selected = true; effort.appendChild(o); });
  effort.addEventListener("change", () => { if (effort.value === "inherit") delete inv.effort; else inv.effort = effort.value; refreshView(); });
  if (effortOff) {
    // The disabled <select> is greyed by CSS; the wrapper holds the hover message
    // (a disabled control doesn't show its own title tooltip).
    const wrap = document.createElement("span"); wrap.className = "inv-effort-wrap"; wrap.title = effortTip;
    wrap.appendChild(effort); top.appendChild(wrap);
  } else {
    effort.title = effortTip; top.appendChild(effort);
  }
  const rm = document.createElement("button"); rm.className = "inv-rm"; rm.textContent = "×";
  rm.addEventListener("click", () => { p.invocations.splice(idx, 1); if (!p.invocations.length) delete p.invocations; refreshView().then(() => selectPhase(p.id)); });
  top.appendChild(rm); box.appendChild(top);

  box.appendChild(fieldTextarea("", inv.description || "", v => { if (v) inv.description = v; else delete inv.description; refreshView(); }));
  box.querySelector("textarea").placeholder = "what this sub-agent does in this action";

  const prow = document.createElement("div"); prow.className = "prompt-row";
  const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = "✎ Prompt";
  const prev = document.createElement("span"); prev.className = "prev"; prev.textContent = "agent system prompt + invocation snippet";
  prow.appendChild(lbl); prow.appendChild(prev);
  prow.addEventListener("click", () => openPrompt(inv.agent)); box.appendChild(prow);

  // advanced (awok-specific richness): background / skip_if / depends_on_invocation / per-invocation triggers & io
  const adv = document.createElement("details"); adv.className = "inv-advanced";
  const sum = document.createElement("summary"); sum.textContent = "Advanced"; adv.appendChild(sum);
  adv.appendChild(fieldCheckbox("background (run the agent in the background)", inv.background, v => { if (v) inv.background = true; else delete inv.background; refreshView(); }));
  const conds = ["", ...Object.keys(state.model.conditions || {})];
  adv.appendChild(fieldSelect("skip_if (skip when the condition is true)", inv.skip_if || "", conds, v => { if (v) inv.skip_if = v; else delete inv.skip_if; refreshView(); }));
  if (conds.length === 1) adv.appendChild(helpNote("No condition defined — add one in Settings › conditions."));
  const others = ["", ...(p.invocations || []).filter(x => x !== inv).map(x => x.agent)];
  adv.appendChild(fieldSelect("depends_on_invocation (wait for another invocation here)", inv.depends_on_invocation || "", others, v => { if (v) inv.depends_on_invocation = v; else delete inv.depends_on_invocation; refreshView(); }));
  adv.appendChild(triggerEditor("invocation triggers", inv.triggers || [], next => { if (next.length) inv.triggers = next; else delete inv.triggers; refreshView(); }));
  adv.appendChild(ioRefEditor("invocation inputs", inv.inputs || [], next => { if (next.length) inv.inputs = next; else delete inv.inputs; refreshView(); }, state.model.namespaces));
  adv.appendChild(ioRefEditor("invocation outputs", inv.outputs || [], next => { if (next.length) inv.outputs = next; else delete inv.outputs; refreshView(); }, state.model.namespaces));
  box.appendChild(adv);
  return box;
}

function renamePhase(newId) {
  const p = curPhase(); if (!p || !newId || newId === p.id) return;
  const old = p.id;
  (state.model.phases || []).forEach(x => { if (x.depends_on) x.depends_on = x.depends_on.map(d => d === old ? newId : d); });
  p.id = newId; state.selected = newId; refreshView().then(() => selectPhase(newId));
}
function uniqueId(base) {
  const ids = new Set((state.model.phases || []).map(p => p.id));
  if (!ids.has(base)) return base; let n = 2; while (ids.has(base + "-" + n)) n++; return base + "-" + n;
}
function addPhase() {
  if (!state.model) return;
  const id = uniqueId("NEW-ACTION");
  const group = Object.keys(state.model.groups || {})[0] || "setup";
  // default: depend on the deepest level's actions (sits one level lower)
  const rows = rowsFromView();
  const prev = rows.length ? rows[rows.length - 1].filter(Boolean) : [];
  state.model.phases = state.model.phases || [];
  const ph = { id, name: "New action", group, type: "main_agent" };
  if (prev.length) ph.depends_on = prev;
  state.model.phases.push(ph);
  refreshView().then(() => selectPhase(id));
}
function deletePhase() {
  const p = curPhase(); if (!p) return;
  if (!confirm("Delete " + p.id + "?")) return;
  const id = p.id;
  state.model.phases = state.model.phases.filter(x => x.id !== id);
  (state.model.phases || []).forEach(x => { if (x.depends_on) x.depends_on = x.depends_on.filter(d => d !== id); });
  closeDrawer(); refreshView();
}

// --- resize grip -----------------------------------------------------------
function ensureResizeGrip(panel) {
  const grip = document.createElement("div"); grip.className = "resize-grip"; panel.appendChild(grip);
  grip.addEventListener("mousedown", e => {
    e.preventDefault();
    const move = ev => {
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth * 0.96);
      state.panelWidth = w; panel.style.width = w + "px"; $("#panel-grid").style.marginRight = w + "px"; schedulePaint();
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  });
}

// --- prompt + agent editors (two artifacts: agent body + invocation snippet) -
async function refreshAgents() { state.agents = (await api("GET", "/api/agents")).j || []; }
async function openPrompt(agent) {
  const ag = await api("GET", "/api/agent/" + agent);
  const iv = await api("GET", "/api/invocation/" + agent);
  const agentExists = ag.status === 200;
  const sources = [
    { label: "Agent prompt — src/agents/" + agent + ".md", value: (ag.j && ag.j.body) || "", disabled: !agentExists,
      hint: agentExists ? "The agent's full system prompt (frontmatter preserved)." : "Agent not found — create it via « + new agent ».",
      save: v => api("PUT", "/api/agent/" + agent, { body: v }) },
    { label: "Invocation snippet — included in the SKILL", value: (iv.j && iv.j.prompt) || "", disabled: false,
      hint: "The Task block injected into the generated SKILL.md for this action.",
      save: v => api("PUT", "/api/invocation/" + agent, { prompt: v }) },
  ];
  document.querySelectorAll(".notice-overlay").forEach(n => n.remove());
  const ov = document.createElement("div"); ov.className = "notice-overlay";
  const box = document.createElement("div"); box.className = "prompt-box";
  const h = document.createElement("div"); h.className = "notice-title"; h.textContent = "Prompts — " + agent; box.appendChild(h);
  const tabs = document.createElement("div"); tabs.className = "panel-tabs"; box.appendChild(tabs);
  const hint = document.createElement("div"); hint.className = "muted";
  const ta = document.createElement("textarea"); ta.className = "prompt-textarea"; ta.spellcheck = false;
  const st = document.createElement("span"); st.className = "muted";
  let active = sources[0];
  const activate = s => { active = s; [...tabs.children].forEach((b, i) => b.classList.toggle("active", sources[i] === s)); ta.value = s.value; ta.disabled = !!s.disabled; hint.textContent = s.hint || ""; st.textContent = ""; };
  sources.forEach(s => { const tb = document.createElement("button"); tb.className = "ptab"; tb.textContent = s.label;
    tb.addEventListener("click", () => { if (!active.disabled) active.value = ta.value; activate(s); }); tabs.appendChild(tb); });
  box.appendChild(hint); box.appendChild(ta);
  const bar = document.createElement("div"); bar.className = "prompt-bar";
  const save = document.createElement("button"); save.textContent = "Save";
  save.addEventListener("click", async () => { if (active.disabled) { st.textContent = "nothing to save"; return; } active.value = ta.value; const r = await active.save(ta.value); st.textContent = r.status === 200 ? "✓ saved" : "✗ " + (((r.j && r.j.errors) || ["error"]).join("; ")); });
  const close = document.createElement("button"); close.textContent = "Close"; close.addEventListener("click", () => ov.remove());
  bar.appendChild(save); bar.appendChild(st); bar.appendChild(close); box.appendChild(bar);
  ov.appendChild(box); ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov); activate(sources[0]); ta.focus();
}
function openAgentForm() {
  document.querySelectorAll(".notice-overlay").forEach(n => n.remove());
  const ov = document.createElement("div"); ov.className = "notice-overlay";
  const box = document.createElement("div"); box.className = "notice-box"; box.style.width = "min(560px,100%)";
  const h = document.createElement("div"); h.className = "notice-title"; h.textContent = "New agent"; box.appendChild(h);
  const draft = { name: "", description: "", tools: "", model: "inherit", prompt: "" };
  box.appendChild(fieldText("name (lowercase slug, e.g. my-agent)", "", v => draft.name = v));
  box.appendChild(fieldText("description", "", v => draft.description = v));
  box.appendChild(fieldText("tools (e.g. Read, Grep, Bash)", "", v => draft.tools = v));
  box.appendChild(fieldSelect("model", "inherit", ["inherit", "haiku", "sonnet", "opus"], v => draft.model = v));
  const plabel = document.createElement("label"); plabel.textContent = "prompt"; plabel.style.cssText = "display:block;font-size:11px;color:var(--dim);margin:8px 0 4px"; box.appendChild(plabel);
  const ta = document.createElement("textarea"); ta.spellcheck = false; ta.style.cssText = "width:100%;min-height:160px;background:var(--well);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:10px;font:13px/1.6 var(--mono);outline:none"; box.appendChild(ta);
  const bar = document.createElement("div"); bar.className = "prompt-bar"; bar.style.background = "transparent"; bar.style.borderTop = "none"; bar.style.padding = "12px 0 0";
  const st = document.createElement("span"); st.className = "muted";
  const save = document.createElement("button"); save.textContent = "Create agent";
  save.addEventListener("click", async () => {
    draft.prompt = ta.value;
    const { status, j } = await api("POST", "/api/agent", draft);
    if (status === 200 && (!j.errors || !j.errors.length)) { await refreshAgents(); ov.remove(); if (state.selected) selectPhase(state.selected); }
    else st.textContent = "✗ " + ((j.errors || ["error"]).join("; "));
  });
  const close = document.createElement("button"); close.textContent = "Close"; close.addEventListener("click", () => ov.remove());
  bar.appendChild(save); bar.appendChild(st); bar.appendChild(close); box.appendChild(bar);
  ov.appendChild(box); ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

// --- yaml view -------------------------------------------------------------
function renderYaml() { $("#yaml-src").textContent = JSON.stringify(state.model, null, 2); }

// --- settings --------------------------------------------------------------
import { renderSettings } from "./settings.js";
function settingsCtx() {
  return { getModel: () => state.model, getAgents: () => state.agents, getWorkflows: () => state.workflows,
           currentName: () => state.name, refreshView, helpers: { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, helpIcon, helpNote, stringListEditor,
           globalOpportunisticState, setGlobalOpportunistic } };
}

// --- save / new / clone ----------------------------------------------------
function modelForSave() {
  // Strip editor-only transient keys (standalone file blocks, block _id) so they
  // never leak into the persisted YAML.
  const m = JSON.parse(JSON.stringify(state.model)); delete m.files;
  (function strip(bs){ (bs||[]).forEach(b=>{ delete b._id; delete b._leftKind; delete b._rightKind; ["then","else","body"].forEach(s=>strip(b[s])); }); })(m.orchestration);
  return m;
}
// Canonical string of what would be persisted — the unit of unsaved-changes
// detection (compares against the snapshot taken at load/save time, so it
// matches the YAML on disk, not transient editor-only file blocks).
function snapshot() { return state.model ? JSON.stringify(modelForSave()) : null; }
function isDirty() { return state.savedSnapshot != null && snapshot() !== state.savedSnapshot; }
// Gate a workflow change behind an explicit confirm when there's unsaved work.
// Returns true to proceed, false to stay put.
function confirmDiscard() {
  if (!isDirty()) return true;
  return confirm("Unsaved changes in “" + state.name + "” will be lost.\nSwitch without saving?");
}
async function save() {
  const { status, j } = await api("PUT", "/api/workflow/" + state.name, { model: modelForSave() });
  setStatus(status === 200 ? "✓ saved · " + new Date().toLocaleTimeString() : "✗ " + ((j.errors || []).join("; ") || "error"));
  if (status === 200) loadWorkflow(state.name);
}
async function newWf() {
  if (!confirmDiscard()) return;
  const name = prompt("New workflow name (slug):"); if (!name) return;
  const { status, j } = await api("POST", "/api/workflow", { name });
  if (status === 200) { await loadList(); $("#wf-select").value = name; loadWorkflow(name); } else alert((j.errors || ["error"]).join("; "));
}
async function cloneWf() {
  if (!confirmDiscard()) return;
  const name = prompt("Name of the copy (slug) — duplicates " + state.name + ":"); if (!name) return;
  const { status, j } = await api("POST", "/api/workflow", { name, from: state.name });
  if (status === 200) { await loadList(); $("#wf-select").value = name; loadWorkflow(name); } else alert((j.errors || ["error"]).join("; "));
}

// --- tabs / boot -----------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(pn => pn.classList.toggle("active", pn.id === "panel-" + tab));
  applyDrawerLayout();
  if (tab === "grid") schedulePaint();
  if (tab === "settings") renderSettings($("#settings"), settingsCtx());
  if (tab === "dataflow") dataflow.render();
}

window.addEventListener("resize", () => { if (state.tab === "grid") schedulePaint(); if (state.tab === "dataflow") dataflow.paintEdges(); });
document.addEventListener("DOMContentLoaded", () => {
  dataflow = createDataflow({ getModel: () => state.model, getAgents: () => state.agents, refreshView, setStatus });
  loadList();
  $("#wf-select").addEventListener("change", e => {
    const next = e.target.value;
    if (next === state.name) return;
    if (!confirmDiscard()) { e.target.value = state.name; return; }  // keep the dropdown on the current workflow
    loadWorkflow(next);
  });
  $("#wf-new").addEventListener("click", newWf);
  $("#wf-clone").addEventListener("click", cloneWf);
  $("#wf-save").addEventListener("click", save);
  $("#add-phase").addEventListener("click", addPhase);
  $("#add-gate").addEventListener("click", (e) => orch.openGateMenu({ state, selectGate, rerender: () => { renderGrid(); applyDrawerLayout(); } }, e.currentTarget));
  $("#toggle-links").addEventListener("click", () => { state.showLinks = !state.showLinks; $("#toggle-links").classList.toggle("on", state.showLinks); schedulePaint(); });
  $("#toggle-orch").addEventListener("click", () => {
    state.showOrch = !state.showOrch; state.selectedGate = null;
    $("#toggle-orch").classList.toggle("on", state.showOrch);
    $("#add-gate").hidden = !state.showOrch;
    if (!state.showOrch && state.selected == null) $("#edit-panel").hidden = true;
    renderGrid(); applyDrawerLayout();
  });
  $("#issues-badge").addEventListener("click", () => { switchTab("dataflow"); dataflow.openIssues(); });
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
});
