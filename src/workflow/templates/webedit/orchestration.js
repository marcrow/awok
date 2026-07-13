// awok orchestration layer — program (block-tree) view + gate editor.
// Rendered ONLY when state.showOrch is on; the classic grid is untouched otherwise.
//
// Translated from the proto (docs/superpowers/specs/2026-07-13-orchestration-refs/
// orchestration-prototype.dc.html) to vanilla DOM, using the ENGINE block shape
// (construct name is the key: {if:{cond},then,else} / {while:{cond},cap,body} /
// {for_each:"sig",as,cap,body} / {ref:"PHASE"}) — no {type:'if',cond} mapping.
import { makeCard } from "./render-helpers.js";
import { iterBlocks, isLoopBlock, blockConstruct, condOf, signalsOf } from "./editlogic.js";

let CTX = null;   // set each render so drag/drop handlers can reach state + callbacks

// --- gate creation (＋ Gate toolbar button) ----------------------------------
// Counter starts at 1000 so freshly-created ids ("b1001", "b1002", ...) never
// collide with hydrateBlockIds' load-time stamping ("b1", "b2", ...).
let _seq = 1000;
const newId = () => "b" + (++_seq);

export function addGate(ctx, kind) {
  const m = ctx.state.model; m.orchestration = m.orchestration || [];
  const b = kind === "loop"
    ? { _id: newId(), while: { op: "==", left: "", right: "" }, cap: null, body: [] }
    : { _id: newId(), if: { op: "==", left: "", right: "" }, then: [], else: [] };
  m.orchestration.push(b); ctx.state.selectedGate = b._id; ctx.state.selected = null;
  ctx.rerender();
}

let _gateMenuEl = null;
function closeGateMenu() {
  if (_gateMenuEl) { _gateMenuEl.remove(); _gateMenuEl = null; }
  document.removeEventListener("mousedown", onGateMenuOutsideClick, true);
  document.removeEventListener("keydown", onGateMenuKeydown, true);
}
function onGateMenuOutsideClick(e) {
  if (_gateMenuEl && !_gateMenuEl.contains(e.target)) closeGateMenu();
}
function onGateMenuKeydown(e) {
  if (e.key === "Escape") closeGateMenu();
}

export function openGateMenu(ctx, buttonEl) {
  closeGateMenu();
  const menu = document.createElement("div"); menu.className = "gate-menu";
  const items = [
    { label: "◆ Condition", kind: "if" },
    { label: "↻ Loop", kind: "loop" },
  ];
  items.forEach(it => {
    const item = document.createElement("button"); item.type = "button";
    item.className = "gate-menu-item"; item.textContent = it.label;
    item.addEventListener("click", e => {
      e.stopPropagation();
      closeGateMenu();
      addGate(ctx, it.kind);
    });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  const rect = buttonEl.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + "px";
  menu.style.left = rect.left + "px";
  _gateMenuEl = menu;
  // deferred so the click that opened the menu doesn't immediately close it
  setTimeout(() => {
    document.addEventListener("mousedown", onGateMenuOutsideClick, true);
    document.addEventListener("keydown", onGateMenuKeydown, true);
  }, 0);
}

export function renderProgram(ctx) {
  CTX = ctx;
  const { state } = ctx;
  const grid = document.querySelector("#grid"); grid.replaceChildren();
  grid.appendChild(renderPalette(ctx));            // "drag into a gate" strip
  const rows = document.createElement("div"); rows.className = "orch-rows";
  (state.model.orchestration || []).forEach((b, i) => rows.appendChild(topRow(b, i)));
  grid.appendChild(rows);
  grid.appendChild(renderTray(ctx));                // unused-actions library
}

// --- top-level rows ---------------------------------------------------------
function topRow(b, i) {
  const { state } = CTX;
  const row = document.createElement("div"); row.className = "orch-row";
  row.dataset.blockTop = b._id;

  const rail = document.createElement("div"); rail.className = "orch-rail";
  const node = document.createElement("div"); node.className = "node"; node.textContent = String(i + 1);
  rail.appendChild(node);
  row.appendChild(rail);

  const content = document.createElement("div"); content.style.flex = "1 1 auto"; content.style.minWidth = "0";
  if (blockConstruct(b) === "ref") {
    const vignette = refVignette(b);
    if (vignette) content.appendChild(vignette);
  } else {
    content.appendChild(gateEl(b, 0));
  }
  row.appendChild(content);
  return row;
}

// --- ref vignette (reuses the classic makeCard) -----------------------------
function refVignette(b) {
  const { state } = CTX;
  const p = (state.model.phases || []).find(x => x.id === b.ref);
  if (!p) {
    const miss = document.createElement("div"); miss.className = "help-note";
    miss.textContent = "Unknown ref: " + b.ref;
    return miss;
  }
  const colors = CTX.resolveGroupColors(state.model);
  const oppPhases = (state.view && state.view.opportunistic && state.view.opportunistic.phases) || {};
  const oppMark = (oppPhases[p.id] || {}).mark;
  const card = makeCard(p, colors[p.group], oppMark);
  card.addEventListener("dragstart", e => {
    try { e.dataTransfer.setData("text/refid", b._id); } catch (_) {}
  });
  card.addEventListener("click", e => { e.stopPropagation(); CTX.selectPhase(p.id); });
  return card;
}

// --- gate container ----------------------------------------------------------
function gateEl(b, depth) {
  const { state } = CTX;
  const kind = blockConstruct(b);
  const loop = isLoopBlock(b);
  const sigKeys = new Set(signalsOf(state.model).map(s => s.key));

  const gate = document.createElement("div");
  gate.className = "gate" + (loop ? " loop" : "");
  gate.dataset.blockId = b._id;
  if (state.selectedGate === b._id) gate.classList.add("selected");
  gate.addEventListener("click", e => { e.stopPropagation(); CTX.onSelectGate(b._id); });

  const head = document.createElement("div"); head.className = "gate-head";
  const icon = document.createElement("span");
  icon.className = loop ? "gate-icon-loop" : "gate-icon-if";
  if (loop) icon.textContent = "↻";
  head.appendChild(icon);

  const kw = document.createElement("span"); kw.className = "gate-kw";
  kw.textContent = kind.replace("_", " ");
  head.appendChild(kw);

  if (kind === "for_each") head.appendChild(forEachHeaderEl(b, sigKeys));
  else head.appendChild(condEl(condOf(b), sigKeys));

  if (loop) {
    const capOk = Number.isInteger(b.cap) && b.cap > 0;
    const chip = document.createElement("span"); chip.className = "cap-chip";
    if (capOk) chip.textContent = "cap " + b.cap;
    else { chip.classList.add("bad"); chip.textContent = "cap required"; }
    head.appendChild(chip);
  }

  const edit = document.createElement("span"); edit.className = "gate-edit";
  edit.textContent = state.selectedGate === b._id ? "✎ editing" : "✎";
  edit.addEventListener("click", e => { e.stopPropagation(); CTX.onSelectGate(b._id); });
  head.appendChild(edit);
  gate.appendChild(head);

  const body = document.createElement("div"); body.className = "gate-body";
  if (kind === "if") {
    body.classList.add("branches");
    body.appendChild(laneEl(b, "then", depth));
    body.appendChild(laneEl(b, "else", depth));
  } else if (kind === "parallel") {
    // parallel is deferred from the UX (not rendered/edited) — show a minimal,
    // non-crashing placeholder rather than pretending it has a then/body slot.
    const note = document.createElement("div"); note.className = "help-note";
    note.textContent = "parallel block (" + (b.parallel || []).length + " branch(es)) — not editable in this view yet.";
    body.appendChild(note);
  } else {
    listEl(b.body, depth + 1).forEach(el => body.appendChild(el));
    body.appendChild(dropSlot(b._id, "body"));
  }
  gate.appendChild(body);

  return gate;
}

function laneEl(b, slot, depth) {
  const lane = document.createElement("div"); lane.className = "lane" + (slot === "then" ? " then" : "");
  const label = document.createElement("div"); label.className = "lane-label"; label.textContent = slot;
  lane.appendChild(label);
  listEl(b[slot], depth + 1).forEach(el => lane.appendChild(el));
  lane.appendChild(dropSlot(b._id, slot));
  return lane;
}

// --- condition rendering -----------------------------------------------------
// Engine cond shape: {op, left, right} (left/right untyped) or an escape-hatch
// string. Operand kind is inferred (no {kind,value} tagging in the engine):
// object -> builtin ({name: arg}); string matching a known signal key -> signal;
// anything else -> literal. Mirrors _operand_type()/orchestrationIssues().
function operandEl(op, sigKeys) {
  const span = document.createElement("span");
  if (op && typeof op === "object" && !Array.isArray(op)) {
    const entry = Object.entries(op)[0];
    span.className = "cond-builtin";
    span.textContent = entry ? entry[0] + "(" + entry[1] + ")" : "builtin(…)";
  } else if (typeof op === "string" && sigKeys.has(op)) {
    span.className = "cond-sig";
    span.textContent = "◈ " + op;
  } else {
    span.className = "cond-lit";
    span.textContent = (op === undefined || op === null || op === "") ? "…" : String(op);
  }
  return span;
}

function condEl(cond, sigKeys) {
  const pill = document.createElement("span"); pill.className = "cond-pill";
  if (typeof cond === "string") {
    const bolt = document.createElement("span"); bolt.className = "cond-lit"; bolt.textContent = "⚡";
    const txt = document.createElement("span"); txt.style.fontStyle = "italic";
    txt.textContent = cond || "free predicate";
    pill.appendChild(bolt); pill.appendChild(txt);
    return pill;
  }
  if (!cond || typeof cond !== "object") return pill;
  pill.appendChild(operandEl(cond.left, sigKeys));
  const op = document.createElement("span"); op.className = "cond-op"; op.textContent = cond.op || "";
  pill.appendChild(op);
  if (cond.op !== "exists") pill.appendChild(operandEl(cond.right, sigKeys));
  return pill;
}

function forEachHeaderEl(b, sigKeys) {
  const wrap = document.createElement("span");
  wrap.style.display = "inline-flex"; wrap.style.alignItems = "center";
  wrap.style.gap = "7px"; wrap.style.flexWrap = "wrap";
  wrap.appendChild(operandEl(b.for_each, sigKeys));
  const as = document.createElement("span"); as.className = "cond-op"; as.textContent = "as";
  wrap.appendChild(as);
  const name = document.createElement("span"); name.className = "cond-builtin";
  name.textContent = b.as || "item";
  wrap.appendChild(name);
  return wrap;
}

// --- block list (ref vignettes + nested gates) ------------------------------
function listEl(arr, depth) {
  return (arr || []).map(b => blockConstruct(b) === "ref" ? refVignette(b) : gateEl(b, depth));
}

// --- drop target -------------------------------------------------------------
function dropSlot(containerId, slot) {
  const el = document.createElement("div"); el.className = "drop-slot";
  el.textContent = "＋ drag an action here";
  el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("hover"); });
  el.addEventListener("dragleave", () => el.classList.remove("hover"));
  el.addEventListener("drop", e => {
    e.preventDefault(); el.classList.remove("hover");
    CTX.onDrop(containerId, slot, e);
  });
  return el;
}

// --- palette + library tray --------------------------------------------------
function phaseChip(p, colors) {
  const chip = document.createElement("div"); chip.className = "phase-chip";
  chip.draggable = true; chip.dataset.id = p.id;
  const color = colors[p.group] || "var(--accent)";
  chip.style.borderLeftColor = color;
  const dot = document.createElement("span");
  dot.style.width = "6px"; dot.style.height = "6px"; dot.style.borderRadius = "50%";
  dot.style.background = color; dot.style.display = "inline-block"; dot.style.flex = "0 0 auto";
  chip.appendChild(dot);
  const id = document.createElement("span"); id.textContent = p.id;
  chip.appendChild(id);
  chip.addEventListener("dragstart", e => { try { e.dataTransfer.setData("text/phase", p.id); } catch (_) {} });
  return chip;
}

export function renderPalette(ctx) {
  const { state } = ctx;
  const colors = ctx.resolveGroupColors(state.model);
  const wrap = document.createElement("div"); wrap.className = "orch-palette";
  const label = document.createElement("span"); label.className = "tray-head"; label.textContent = "drag into a gate";
  wrap.appendChild(label);
  (state.model.phases || []).forEach(p => wrap.appendChild(phaseChip(p, colors)));
  return wrap;
}

export function renderTray(ctx) {
  const { state } = ctx;
  const colors = ctx.resolveGroupColors(state.model);
  const refIds = new Set();
  iterBlocks(state.model.orchestration || [], b => { if (blockConstruct(b) === "ref") refIds.add(b.ref); });
  const unused = (state.model.phases || []).filter(p => !refIds.has(p.id));
  const wrap = document.createElement("div"); wrap.className = "orch-tray";
  const label = document.createElement("span"); label.className = "tray-head"; label.textContent = "Library — unused actions";
  wrap.appendChild(label);
  unused.forEach(p => wrap.appendChild(phaseChip(p, colors)));
  return wrap;
}
