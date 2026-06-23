// Interactive Dataflow canvas (navy redesign — replaces the mermaid diagram).
// Files + action columns laid out by level, with focus, click-to-wire link mode,
// issue-focus and an inline namespaces manager. All computed in the browser via
// the DOM-free helpers in editlogic.js (mirrors bb-workflow's dataflow). Wiring
// is written onto the action (phase inputs/outputs) — single source with the grid.
import { dataflowFiles, validateModel, parseRole, ioLabel, nsColor, computeLevels } from "./editlogic.js";

const KINDS = ["md", "text", "json", "jsonl", "yaml", "dir", "sqlite", "binary"];
const TC = {
  main_agent: ["#38bdf8", "rgba(56,189,248,0.14)"], agent: ["#34d399", "rgba(52,211,153,0.14)"],
  script: ["#fbbf24", "rgba(251,191,36,0.14)"], external: ["#94a3b8", "rgba(148,163,184,0.14)"],
  workflow_call: ["#c084fc", "rgba(192,132,252,0.14)"],
};
const GROUP_PALETTE = ["#60a5fa", "#4ade80", "#fbbf24", "#c084fc", "#f87171", "#38bdf8", "#fb923c", "#a3e635"];
const $ = s => document.querySelector(s);

export function createDataflow({ getModel, refreshView, setStatus }) {
  const ui = { focus: null, link: null, editFile: null, issues: false, nsPanel: false };
  // Link-visibility state (plain mutable — never triggers a re-render, only a repaint):
  // restOpacity = slider value (edge opacity at rest); hoverId = block whose edges are isolated.
  let restOpacity = 0.3;
  let hoverId = null;

  const groupColor = (model, g) => { const i = Object.keys(model.groups || {}).indexOf(g); return GROUP_PALETTE[(i < 0 ? 0 : i) % GROUP_PALETTE.length]; };
  const byId = model => { const m = {}; (model.phases || []).forEach(p => m[p.id] = p); return m; };
  // Every io label an action touches (phase-level + invocation-level).
  const actionLabels = p => {
    const out = [];
    const grab = s => ["inputs", "outputs"].forEach(k => (s[k] || []).forEach(io => { const l = ioLabel(io); if (l) out.push(l); }));
    grab(p); (p.invocations || []).forEach(grab); return out;
  };
  const ioCount = (p, side) => {
    let n = (p[side] || []).length; (p.invocations || []).forEach(iv => n += (iv[side] || []).length); return n;
  };

  // ---- model mutations ----
  const commit = msg => { if (msg) setStatus(msg); refreshView(); };
  function addFile() {
    const model = getModel(); const used = new Set();
    (model.phases || []).forEach(p => actionLabels(p).forEach(l => used.add(l)));
    (model.files || []).forEach(f => used.add(f.label));
    const ns0 = Object.keys(model.namespaces || {})[0] || "work";
    let n = 1, label = ns0 + ":new-artifact"; while (used.has(label)) { n++; label = ns0 + ":new-artifact-" + n; }
    model.files = [...(model.files || []), { label, kind: "md" }];
    ui.editFile = label; ui.focus = null; ui.link = null;
    commit("File block created — edit its name & namespace");
  }
  function relabel(old, v) {
    v = (v || "").trim(); if (!v || v === old) return;
    const model = getModel();
    model.files = (model.files || []).map(f => f.label === old ? { ...f, label: v } : f);
    const fix = io => { if ((io.role || "") === old) io.role = v; else if ((io.path || "") === old) io.path = v; };
    (model.phases || []).forEach(p => { ["inputs", "outputs"].forEach(k => (p[k] || []).forEach(fix)); (p.invocations || []).forEach(iv => ["inputs", "outputs"].forEach(k => (iv[k] || []).forEach(fix))); });
    if (ui.editFile === old) ui.editFile = v; if (ui.focus === "file:" + old) ui.focus = "file:" + v;
    commit();
  }
  const setFileNs = (label, newNs) => { const { name } = parseRole({ role: label }); relabel(label, newNs ? newNs + ":" + name : name); };
  const setFileName = (label, newName) => { const { ns } = parseRole({ role: label }); relabel(label, ns ? ns + ":" + newName.trim() : newName.trim()); };
  function setFileKind(label, kind) {
    const model = getModel();
    model.files = (model.files || []).map(f => f.label === label ? { ...f, kind } : f);
    const fix = io => { if ((io.role || io.path || "") === label) io.kind = kind; };
    (model.phases || []).forEach(p => { ["inputs", "outputs"].forEach(k => (p[k] || []).forEach(fix)); (p.invocations || []).forEach(iv => ["inputs", "outputs"].forEach(k => (iv[k] || []).forEach(fix))); });
    commit();
  }
  function removeFile(label) {
    const model = getModel();
    model.files = (model.files || []).filter(f => f.label !== label);
    const strip = arr => (arr || []).filter(io => (io.role || io.path || "") !== label);
    (model.phases || []).forEach(p => { p.inputs = strip(p.inputs); p.outputs = strip(p.outputs); if (!p.inputs.length) delete p.inputs; if (!p.outputs.length) delete p.outputs; });
    if (ui.focus === "file:" + label) ui.focus = null;
    commit("Artifact removed");
  }
  function toggleWire(actId, side, label, kind) {
    const model = getModel(); const p = (model.phases || []).find(x => x.id === actId); if (!p) return;
    p[side] = p[side] || [];
    const i = p[side].findIndex(io => (io.role || io.path || "") === label);
    if (i >= 0) { p[side].splice(i, 1); if (!p[side].length) delete p[side]; }
    else { const isPath = label.indexOf("/") >= 0 && label.indexOf(":") < 0; p[side].push(isPath ? { path: label, kind: kind || "md" } : { role: label, kind: kind || "md" }); }
    commit((i >= 0 ? "Unlinked " : "Linked ") + label + " (" + side + ")");
  }
  // namespaces
  function nsAdd() { const model = getModel(); model.namespaces = model.namespaces || {}; let n = 1, k = "ns"; while (model.namespaces[k] != null) { n++; k = "ns" + n; } model.namespaces[k] = ""; commit("Namespace added — " + k); }
  function nsSetBase(k, v) { getModel().namespaces[k] = v; commit(); }
  function nsRemove(k) { const m = getModel(); delete m.namespaces[k]; commit("Namespace removed — " + k); }
  function nsRename(old, v) {
    v = (v || "").trim(); if (!v || v === old) return;
    const m = getModel(); const map = {}; Object.keys(m.namespaces).forEach(k => { map[k === old ? v : k] = m.namespaces[k]; }); m.namespaces = map;
    const fix = io => { const r = io.role || ""; const ci = r.indexOf(":"); if (ci >= 0 && r.slice(0, ci) === old) io.role = v + ":" + r.slice(ci + 1); };
    (m.phases || []).forEach(p => { ["inputs", "outputs"].forEach(s => (p[s] || []).forEach(fix)); (p.invocations || []).forEach(iv => ["inputs", "outputs"].forEach(s => (iv[s] || []).forEach(fix))); });
    commit("Namespace renamed → " + v);
  }

  // ---- render ----
  function render() {
    const model = getModel(); if (!model) return;
    const files = dataflowFiles(model);
    const valid = validateModel(model);
    const levels = computeLevels(model);
    const id2p = byId(model);
    const fileByLabel = {}; files.forEach(f => fileByLabel[f.label] = f);
    $("#df-count").textContent = files.length + " files · " + (model.phases || []).length + " actions";
    $("#df-ns-count").textContent = Object.keys(model.namespaces || {}).length;

    const issueByFile = {}, issueByAction = {};
    valid.items.forEach(it => { const map = it.type === "file" ? issueByFile : issueByAction; (map[it.key] = map[it.key] || []).push(it); });
    const issuesOn = ui.issues && valid.items.length > 0;

    // focus visibility set
    let vis = null;
    if (ui.focus && !ui.link) {
      vis = new Set([ui.focus]);
      if (ui.focus.indexOf("file:") === 0) {
        const f = fileByLabel[ui.focus.slice(5)];
        if (f) { f.producers.forEach(id => vis.add("act:" + id)); f.consumers.forEach(id => vis.add("act:" + id)); }
      } else {
        const p0 = id2p[ui.focus.slice(4)];
        if (p0) actionLabels(p0).forEach(l => { vis.add("file:" + l); const f = fileByLabel[l]; if (f) { f.producers.forEach(id => vis.add("act:" + id)); f.consumers.forEach(id => vis.add("act:" + id)); } });
      }
    }
    const actVis = id => !vis || vis.has("act:" + id);
    const fileVis = l => !vis || vis.has("file:" + l);
    const linkA = ui.link ? id2p[ui.link.actionId] : null;
    const linkedSet = linkA ? new Set((linkA[ui.link.side] || []).map(ioLabel)) : null;

    // columns
    const fileLevel = f => (f.external || !f.producers.length) ? 0
      : Math.min(...f.producers.map(id => (levels[id] != null ? levels[id] : 0)));
    const cols = {};
    const getCol = (order, isFiles, caption) => { if (!cols[order]) cols[order] = { order, isFiles, caption, files: [], actions: [] }; return cols[order]; };
    files.forEach(f => { if (!fileVis(f.label)) return; const L = fileLevel(f); getCol(L * 100 + 50, true, L === 0 ? "Sources" : "").files.push(f); });
    const phaseLevels = [...new Set((model.phases || []).map(p => levels[p.id] || 0))].sort((a, b) => a - b);
    phaseLevels.forEach(L => { const acts = (model.phases || []).filter(p => (levels[p.id] || 0) === L && actVis(p.id)); if (!acts.length) return; const col = getCol(L * 100, false, "Lvl " + (L + 1)); acts.forEach(p => col.actions.push(p)); });
    const ordered = Object.values(cols).filter(c => c.isFiles ? c.files.length : c.actions.length).sort((a, b) => a.order - b.order);

    const host = $("#df-columns"); host.replaceChildren();
    ordered.forEach(col => {
      const cEl = document.createElement("div"); cEl.className = "df-col";
      if (col.caption) { const cap = document.createElement("div"); cap.className = "df-cap"; cap.textContent = col.caption; cEl.appendChild(cap); }
      if (col.isFiles) col.files.forEach(f => cEl.appendChild(fileCard(model, f, fileByLabel, { issuesOn, issues: issueByFile[f.label] || [], linkedSet })));
      else col.actions.forEach(p => cEl.appendChild(actionCard(model, p, { issuesOn, issues: issueByAction[p.id] || [] })));
      host.appendChild(cEl);
    });
    $("#df-empty").hidden = ordered.length !== 0;

    renderModebar(valid, files);
    renderNsPanel(model);
    requestAnimationFrame(() => paintEdges());
  }

  function actionCard(model, p, { issuesOn, issues }) {
    const a = groupColor(model, p.group); const [tc, tbg] = TC[p.type] || TC.external;
    const focused = ui.focus === "act:" + p.id;
    const isTarget = ui.link && ui.link.actionId === p.id;
    const el = document.createElement("div"); el.className = "df-action"; el.dataset.dfId = "act:" + p.id;
    el.style.borderLeftColor = a;
    if (issuesOn && issues.length) el.classList.add("has-issue");
    else if (focused) el.classList.add("focused");
    else if (isTarget) el.classList.add("target");
    if (issuesOn && !issues.length) el.style.opacity = "0.28";
    else if (ui.link && !isTarget) el.style.opacity = "0.4";
    if (issuesOn && issues.length) vignette(el, issues);
    const top = document.createElement("div"); top.className = "top";
    const id = document.createElement("span"); id.className = "pid"; id.textContent = p.id; top.appendChild(id);
    const badge = document.createElement("span"); badge.className = "badge"; badge.dataset.type = p.type || "agent"; badge.textContent = p.type || "agent"; top.appendChild(badge);
    const gl = document.createElement("span"); gl.className = "group-label"; gl.style.color = a; gl.textContent = p.group || ""; top.appendChild(gl);
    el.appendChild(top);
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = p.name || ""; el.appendChild(nm);
    const io = document.createElement("div"); io.className = "df-io";
    const inC = document.createElement("span"); inC.className = "in"; inC.textContent = "in · " + ioCount(p, "inputs"); io.appendChild(inC);
    const outC = document.createElement("span"); outC.className = "out"; outC.textContent = "out · " + ioCount(p, "outputs"); io.appendChild(outC);
    const link = document.createElement("button"); link.className = "df-link-btn" + (isTarget ? " on" : ""); link.textContent = isTarget ? "✓ done" : "+ link files";
    link.addEventListener("click", e => { e.stopPropagation(); ui.link = isTarget ? null : { actionId: p.id, side: (ui.link && ui.link.actionId === p.id) ? ui.link.side : "inputs" }; ui.focus = null; render(); });
    io.appendChild(link); el.appendChild(io);
    el.addEventListener("click", e => { e.stopPropagation(); if (ui.link) return; ui.focus = ui.focus === "act:" + p.id ? null : "act:" + p.id; ui.link = null; render(); });
    return el;
  }

  function fileCard(model, f, fileByLabel, { issuesOn, issues, linkedSet }) {
    const { ns, name } = parseRole({ role: f.label });
    const col = nsColor(ns, model.namespaces);
    const editing = ui.editFile === f.label;
    const focused = ui.focus === "file:" + f.label;
    const isLinked = linkedSet ? linkedSet.has(f.label) : false;
    const linkColor = ui.link && ui.link.side === "inputs" ? "#38bdf8" : "#4ade80";
    const el = document.createElement("div"); el.className = "df-file"; el.dataset.dfId = "file:" + f.label;
    if (editing) el.classList.add("editing");
    if (f.nsBad) el.classList.add("bad");
    else if (focused) el.classList.add("focused");
    el.style.borderColor = editing ? col : (f.nsBad ? "var(--bad)" : (ui.link && isLinked ? linkColor : (focused ? "#fde047" : col)));
    if (issuesOn && !issues.length && !editing) el.style.opacity = "0.28";
    else if (ui.link && !isLinked) el.style.opacity = "0.3";
    if (issuesOn && issues.length && !editing) vignette(el, issues);

    const top = document.createElement("div"); top.className = "top";
    const dia = document.createElement("span"); dia.className = "df-diamond"; dia.style.background = f.nsBad ? "var(--bad)" : col; top.appendChild(dia);
    const tag = document.createElement("span"); tag.className = "ftag"; tag.textContent = "File"; top.appendChild(tag);
    if (ns) { const c = document.createElement("span"); c.className = "nschip"; c.style.color = col; c.style.background = "color-mix(in srgb," + col + " 18%,#0b1120)"; c.textContent = ns; top.appendChild(c); }
    if (f.external) top.appendChild(flag("ext", "ext"));
    if (f.terminal) top.appendChild(flag("term", "term"));
    if (f.optional) top.appendChild(flag("opt", "opt"));
    const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = f.kind; top.appendChild(kind);
    el.appendChild(top);

    if (!editing) {
      const label = document.createElement("div"); label.className = "label"; label.textContent = f.label; el.appendChild(label);
      if (!f.nsBad && f.path) { const pt = document.createElement("div"); pt.className = "pathtext"; pt.textContent = "→ " + f.path; el.appendChild(pt); }
      if (f.nsBad) { const b = document.createElement("div"); b.className = "nsbad"; b.textContent = '⛔ namespace "' + ns + ':" not declared'; el.appendChild(b); }
      const counts = document.createElement("div"); counts.className = "counts";
      const prod = document.createElement("span"); prod.className = "prod"; prod.title = "produced by"; prod.textContent = "↑ " + f.producers.length; counts.appendChild(prod);
      const cons = document.createElement("span"); cons.className = "cons"; cons.title = "consumed by"; cons.textContent = "↓ " + f.consumers.length; counts.appendChild(cons);
      const btns = document.createElement("div"); btns.className = "fbtns";
      const edit = document.createElement("button"); edit.className = "fedit"; edit.textContent = "✎ edit";
      edit.addEventListener("click", e => { e.stopPropagation(); ui.editFile = ui.editFile === f.label ? null : f.label; ui.focus = null; ui.link = null; render(); });
      const rm = document.createElement("button"); rm.className = "frm"; rm.textContent = "🗑"; rm.title = "Delete file block";
      rm.addEventListener("click", e => { e.stopPropagation(); removeFile(f.label); });
      btns.appendChild(edit); btns.appendChild(rm); counts.appendChild(btns); el.appendChild(counts);
      if (ui.link) { const h = document.createElement("div"); h.className = "fhint"; h.style.color = isLinked ? linkColor : "var(--dim)"; h.textContent = isLinked ? ("linked · " + (ui.link.side === "inputs" ? "input" : "output")) : "click to " + (ui.link.side === "inputs" ? "add as input" : "add as output"); el.appendChild(h); }
    } else {
      const ed = document.createElement("div"); ed.className = "df-fedit";
      const hint = document.createElement("div"); hint.className = "hint"; hint.textContent = "Pick a namespace (a base folder) + a short name. The path is derived for you."; ed.appendChild(hint);
      const selrow = document.createElement("div"); selrow.className = "selrow";
      const nsSel = document.createElement("select"); nsSel.style.color = col;
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "— ns —"; nsSel.appendChild(o0);
      Object.keys(model.namespaces || {}).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = k; if (k === ns) o.selected = true; nsSel.appendChild(o); });
      nsSel.addEventListener("change", () => setFileNs(f.label, nsSel.value));
      const kSel = document.createElement("select");
      KINDS.forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = k; if (k === f.kind) o.selected = true; kSel.appendChild(o); });
      kSel.addEventListener("change", () => setFileKind(f.label, kSel.value));
      selrow.appendChild(nsSel); selrow.appendChild(kSel); ed.appendChild(selrow);
      const nameIn = document.createElement("input"); nameIn.value = name; nameIn.placeholder = "file name";
      nameIn.addEventListener("change", () => setFileName(f.label, nameIn.value));
      ed.appendChild(nameIn);
      if (!f.nsBad && f.path) { const pt = document.createElement("div"); pt.className = "pathtext"; pt.textContent = "→ " + f.path; ed.appendChild(pt); }
      if (f.nsBad) { const b = document.createElement("div"); b.className = "nsbad"; b.textContent = '⛔ namespace "' + ns + ':" not declared'; ed.appendChild(b); }
      const brow = document.createElement("div"); brow.style.cssText = "display:flex;gap:6px;align-items:center";
      const done = document.createElement("button"); done.className = "done"; done.textContent = "Done";
      done.addEventListener("click", e => { e.stopPropagation(); ui.editFile = null; setStatus("File saved"); render(); });
      const rm = document.createElement("button"); rm.className = "frm"; rm.textContent = "🗑";
      rm.addEventListener("click", e => { e.stopPropagation(); removeFile(f.label); });
      brow.appendChild(done); brow.appendChild(rm); ed.appendChild(brow);
      el.appendChild(ed);
    }
    el.addEventListener("click", e => {
      e.stopPropagation(); if (editing) return;
      if (ui.link) toggleWire(ui.link.actionId, ui.link.side, f.label, f.kind);
      else { ui.focus = ui.focus === "file:" + f.label ? null : "file:" + f.label; ui.link = null; render(); }
    });
    return el;
  }

  function flag(cls, text) { const s = document.createElement("span"); s.className = "flag " + cls; s.textContent = text; return s; }
  function vignette(host, issues) {
    const v = document.createElement("div"); v.className = "df-vignette";
    issues.forEach(it => { const b = document.createElement("div"); b.className = "v " + (it.level === "error" ? "err" : "warn");
      const ic = document.createElement("span"); ic.textContent = it.level === "error" ? "⛔" : "⚠"; const msg = document.createElement("span"); msg.textContent = it.msg;
      b.appendChild(ic); b.appendChild(msg); v.appendChild(b); });
    host.appendChild(v);
  }

  function renderModebar(valid, files) {
    const bar = $("#df-modebar"); bar.replaceChildren();
    if (ui.issues && valid.items.length) {
      const m = document.createElement("div"); m.className = "df-mode issue";
      m.appendChild(document.createTextNode("Issue focus"));
      const x = document.createElement("button"); x.textContent = "✕"; x.title = "Exit issue focus"; x.addEventListener("click", () => { ui.issues = false; render(); });
      m.appendChild(x); bar.appendChild(m);
    }
    if (ui.focus && !ui.link) {
      const model = getModel(); const title = ui.focus.indexOf("file:") === 0 ? ui.focus.slice(5) : ((byId(model)[ui.focus.slice(4)] || {}).name || ui.focus.slice(4));
      const m = document.createElement("div"); m.className = "df-mode focus";
      const lbl = document.createElement("span"); lbl.textContent = "Focus · " + title; m.appendChild(lbl);
      const x = document.createElement("button"); x.textContent = "✕"; x.title = "Back to full view"; x.addEventListener("click", () => { ui.focus = null; render(); });
      m.appendChild(x); bar.appendChild(m);
    }
    if (ui.link) {
      const m = document.createElement("div"); m.className = "df-mode link";
      const idl = document.createElement("span"); idl.style.cssText = "font:11.5px/1 var(--mono);font-weight:700;color:#7dd3fc"; idl.textContent = ui.link.actionId; m.appendChild(idl);
      const w = document.createElement("span"); w.style.color = "var(--dim)"; w.textContent = "wire its"; m.appendChild(w);
      const seg = document.createElement("div"); seg.className = "seg2";
      ["inputs", "outputs"].forEach(side => { const b = document.createElement("button"); b.textContent = side === "inputs" ? "Inputs" : "Outputs"; if (ui.link.side === side) b.classList.add("on"); b.addEventListener("click", () => { ui.link.side = side; render(); }); seg.appendChild(b); });
      m.appendChild(seg);
      const done = document.createElement("button"); done.className = "done"; done.textContent = "Done"; done.addEventListener("click", () => { ui.link = null; render(); });
      m.appendChild(done); bar.appendChild(m);
    }
  }

  function renderNsPanel(model) {
    const panel = $("#df-nspanel"); panel.hidden = !ui.nsPanel; if (!ui.nsPanel) { panel.replaceChildren(); return; }
    panel.replaceChildren();
    const head = document.createElement("div"); head.className = "nsp-head";
    const t = document.createElement("span"); t.className = "t"; t.textContent = "Namespaces"; const s = document.createElement("span"); s.className = "s"; s.textContent = "role prefix → base folder";
    head.appendChild(t); head.appendChild(s); panel.appendChild(head);
    const body = document.createElement("div"); body.className = "nsp-body";
    Object.keys(model.namespaces || {}).forEach(k => {
      const row = document.createElement("div"); row.className = "nsp-row";
      const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = nsColor(k, model.namespaces); row.appendChild(sw);
      const key = document.createElement("input"); key.className = "nskey"; key.value = k; key.addEventListener("change", () => nsRename(k, key.value)); row.appendChild(key);
      const arr = document.createElement("span"); arr.className = "arrow"; arr.textContent = "→"; row.appendChild(arr);
      const base = document.createElement("input"); base.className = "nsbase"; base.value = model.namespaces[k] || ""; base.placeholder = "base/path"; base.addEventListener("change", () => nsSetBase(k, base.value)); row.appendChild(base);
      const rm = document.createElement("button"); rm.textContent = "×"; rm.addEventListener("click", () => nsRemove(k)); row.appendChild(rm);
      body.appendChild(row);
    });
    const add = document.createElement("button"); add.className = "nsp-add"; add.textContent = "+ namespace"; add.addEventListener("click", nsAdd);
    body.appendChild(add); panel.appendChild(body);
  }

  // ---- edges painted to #df-svg ----
  function paintEdges() {
    const svg = $("#df-svg"); const root = $("#df-inner"); if (!svg || !root) return;
    const model = getModel(); if (!model) { svg.innerHTML = ""; return; }
    const rr = root.getBoundingClientRect();
    const rects = {}; root.querySelectorAll("[data-df-id]").forEach(el => rects[el.dataset.dfId] = el.getBoundingClientRect());
    const edges = [];
    (model.phases || []).forEach(p => {
      const grab = s => { ["inputs", "outputs"].forEach(k => (s[k] || []).forEach(io => { const l = ioLabel(io); if (!l) return; if (k === "inputs") edges.push({ from: "file:" + l, to: "act:" + p.id, color: "#38bdf8" }); else edges.push({ from: "act:" + p.id, to: "file:" + l, color: "#4ade80" }); })); };
      grab(p); (p.invocations || []).forEach(grab);
    });
    const parts = [];
    edges.forEach(e => {
      const a = rects[e.from], b = rects[e.to]; if (!a || !b) return;
      // Hover isolation: a hovered block's incident edges go full opacity (slider
      // ignored); every other edge fades. At rest, all edges use the slider value.
      const incident = hoverId && (e.from === hoverId || e.to === hoverId);
      const op = hoverId ? (incident ? 0.98 : 0.06) : restOpacity;
      const w = incident ? 2.6 : 1.5;
      let sx = a.right - rr.left, sy = a.top - rr.top + a.height / 2;
      let tx = b.left - rr.left, ty = b.top - rr.top + b.height / 2;
      let dir = 1;
      if (tx < sx) { sx = a.left - rr.left; tx = b.right - rr.left; dir = -1; }
      const dx = Math.max(26, Math.abs(tx - sx) / 2);
      const c1 = sx + dx * dir, c2 = tx - dx * dir;
      const arrow = dir > 0 ? (tx - 7) + "," + (ty - 4) + " " + (tx - 7) + "," + (ty + 4) + " " + (tx - 1) + "," + ty
        : (tx + 7) + "," + (ty - 4) + " " + (tx + 7) + "," + (ty + 4) + " " + (tx + 1) + "," + ty;
      const d = "M " + sx + " " + sy + " C " + c1 + " " + sy + ", " + c2 + " " + ty + ", " + tx + " " + ty;
      parts.push({ incident, html:
        '<path d="' + d + '" stroke="' + e.color + '" stroke-width="' + w + '" fill="none" opacity="' + op + '" stroke-linecap="round"/>' +
        '<polygon points="' + arrow + '" fill="' + e.color + '" opacity="' + Math.min(1, op + 0.3) + '"/>' });
    });
    // incident (emphasized) edges painted last → on top of the dimmed ones
    parts.sort((x, y) => x.incident === y.incident ? 0 : (x.incident ? 1 : -1));
    svg.innerHTML = parts.map(p => p.html).join("");
  }

  function openIssues() { ui.issues = true; ui.focus = null; ui.link = null; ui.editFile = null; render(); }

  // toolbar buttons (wired once)
  $("#df-add-file").addEventListener("click", addFile);
  $("#df-ns").addEventListener("click", () => { ui.nsPanel = !ui.nsPanel; $("#df-ns").classList.toggle("on", ui.nsPanel); render(); });
  $("#df-scroll").addEventListener("click", () => { if (ui.focus) { ui.focus = null; render(); } });

  // link-opacity slider → resting edge opacity (live, no debounce)
  const slider = $("#df-link-opacity");
  if (slider) {
    restOpacity = parseFloat(slider.value) || restOpacity;
    slider.addEventListener("input", () => {
      restOpacity = parseFloat(slider.value);
      $("#df-link-pct").textContent = Math.round(restOpacity * 100) + "%";
      paintEdges();
    });
  }
  // hover isolation: one delegated listener; closest()→null in the gaps clears it
  const inner = $("#df-inner");
  if (inner) {
    inner.addEventListener("mouseover", e => {
      const el = e.target.closest ? e.target.closest("[data-df-id]") : null;
      const next = el ? el.dataset.dfId : null;
      if (next !== hoverId) { hoverId = next; paintEdges(); }
    });
    inner.addEventListener("mouseleave", () => { if (hoverId) { hoverId = null; paintEdges(); } });
  }

  return { render, paintEdges, openIssues };
}
