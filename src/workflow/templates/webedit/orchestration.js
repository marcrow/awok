// awok orchestration layer — program (block-tree) view + gate editor.
// Rendered ONLY when state.showOrch is on; the classic grid is untouched otherwise.
//
// Translated from the proto (docs/superpowers/specs/2026-07-13-orchestration-refs/
// orchestration-prototype.dc.html) to vanilla DOM, using the ENGINE block shape
// (construct name is the key: {if:{cond},then,else} / {while:{cond},cap,body} /
// {for_each:"sig",as,cap,body} / {ref:"PHASE"}) — no {type:'if',cond} mapping.
import { makeCard } from "./render-helpers.js";
import { iterBlocks, isLoopBlock, blockConstruct, condOf, signalsOf, findBlock, containerArray, laneEntryDeps, orchestrationIssues, condKind, isGroupCond,
  getCondAt, setCondAt, toggleNotAt, toggleConnectorAt, addComparisonAt, addSubgroupAt, removeCondAt } from "./editlogic.js";

let CTX = null;   // set each render so drag/drop handlers can reach state + callbacks

// --- gate creation (＋ Gate toolbar button) ----------------------------------
// Counter starts at 1000 so freshly-created ids ("b1001", "b1002", ...) never
// collide with hydrateBlockIds' load-time stamping ("b1", "b2", ...).
let _seq = 1000;
const newId = () => "b" + (++_seq);

// A readable, unique block id (COND_1 / LOOP_1, …) disjoint from phase ids and
// existing block ids — matches the engine's uniqueness/disjointness rule.
function freshBlockId(model, kind) {
  const taken = new Set((model.phases || []).map(p => p.id));
  iterBlocks(model.orchestration || [], b => { if (b.id) taken.add(b.id); });
  const base = kind === "loop" ? "LOOP" : "COND";
  let n = 1; while (taken.has(base + "_" + n)) n++;
  return base + "_" + n;
}

// Ensure a block has a persisted id (assigning one on demand — e.g. the first
// time an action is made to depend on it) and return it.
export function ensureBlockId(model, block) {
  if (!block.id) block.id = freshBlockId(model, isLoopBlock(block) ? "loop" : "if");
  return block.id;
}

export function addGate(ctx, kind) {
  const m = ctx.state.model; m.orchestration = m.orchestration || [];
  // No `cap` key on creation — unset-and-OK is ABSENT, never `cap: null`
  // (the schema requires cap to be an integer >= 1 when present; null fails
  // validate_schema's blocking structural check, whereas an absent key only
  // trips validate_orchestration's warning-only "missing mandatory cap").
  // Assign a readable, persisted block id on creation so an action can depend on
  // the whole block right away (depends_on references the persisted id, not _id).
  const id = freshBlockId(m, kind);
  const b = kind === "loop"
    ? { _id: newId(), id, while: { op: "==", left: "", right: "" }, body: [] }
    : { _id: newId(), id, if: { op: "==", left: "", right: "" }, then: [], else: [] };
  m.orchestration.push(b);
  if (ctx.selectGate) {
    ctx.selectGate(b._id);
  } else {
    // fallback for callers that don't wire selectGate through ctx
    ctx.state.selectedGate = b._id; ctx.state.selected = null;
    ctx.rerender();
  }
  // Structural mutation (a new, possibly-invalid gate just entered the model):
  // refresh the server-backed view so the issues badge + toast pick it up right
  // away, instead of lagging until the next operand/cap edit routes through
  // applyGateEdit -> refreshView. Plain gate SELECTION (selectGate alone, e.g.
  // clicking an existing gate) must NOT do this — only creation is a model change.
  if (ctx.refreshView) ctx.refreshView();
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

// Orchestration view = the full content DAG. An ungated action is a card at its
// depends_on level; a gate is a FRAME at its level with then/else (if) or body
// (loop) LANES you drop actions and nested gates into. Levels are indicative
// (awok orders by depends_on, shown as arrows); a gated action lives in its
// frame, not on a level row.
export function renderProgram(ctx) {
  CTX = ctx;
  const { state } = ctx;
  const grid = document.querySelector("#grid"); grid.replaceChildren();
  const colors = ctx.resolveGroupColors(state.model);
  const blocks = state.model.orchestration || [];
  const phases = state.model.phases || [];
  const lv = (state.view && state.view.levels) || {};
  const oppPhases = (state.view && state.view.opportunistic && state.view.opportunistic.phases) || {};
  const sigKeys = new Set(signalsOf(state.model).map(s => s.key));
  const byId = {}; phases.forEach(p => byId[p.id] = p);

  // A phase referenced anywhere in the tree is gated — it renders inside its gate
  // frame, never as a bare card. Everything else is a bare card at its level.
  const gated = new Set();
  iterBlocks(blocks, b => { if (blockConstruct(b) === "ref") gated.add(b.ref); });

  // A gate is evaluated when its condition's SIGNALS are available — i.e. after
  // the phases that emit them — so it sits one level below its signal producers,
  // independent of what its branches contain (adding a loosely-bound action to a
  // branch must NOT pull the gate up). Fallback for a signal-less condition
  // (literal / escape-hatch): the deepest action it contains, so it never floats
  // above its own body.
  const sigPhase = {};
  signalsOf(state.model).forEach(s => { sigPhase[s.key] = s.phase; });
  const condSignalKeys = (b) => {
    const k = blockConstruct(b);
    if (k === "for_each") return (typeof b.for_each === "string" && b.for_each in sigPhase) ? [b.for_each] : [];
    const c = condOf(b);
    if (!c || typeof c !== "object") return [];
    return [c.left, c.right].filter(v => typeof v === "string" && v in sigPhase);
  };
  const gateLevel = (b) => {
    let lvl = -1;
    for (const key of condSignalKeys(b)) {
      const ph = sigPhase[key];
      if (ph in lv) lvl = Math.max(lvl, lv[ph]);
    }
    if (lvl >= 0) return lvl + 1;
    let max = -1;
    iterBlocks([b], x => { if (blockConstruct(x) === "ref" && (x.ref in lv)) max = Math.max(max, lv[x.ref]); });
    return max < 0 ? 0 : max;
  };

  const topGates = blocks.filter(b => blockConstruct(b) !== "ref");
  const maxLv = Math.max(0, ...phases.map(p => lv[p.id] || 0), ...topGates.map(gateLevel));
  const rows = Array.from({ length: maxLv + 1 }, () => ({ cards: [], gates: [] }));
  phases.forEach(p => { if (!gated.has(p.id)) rows[lv[p.id] || 0].cards.push(p.id); });
  topGates.forEach(b => rows[gateLevel(b)].gates.push(b));

  const dag = document.createElement("div"); dag.className = "orch-dag";
  rows.forEach((row, i) => {
    if (!row.cards.length && !row.gates.length) return;
    if (i > 0) dag.appendChild(gridDropZone(ctx, i, false));
    const el = document.createElement("div"); el.className = "orch-row"; el.dataset.level = i;
    const rail = document.createElement("div"); rail.className = "orch-rail";
    const node = document.createElement("div"); node.className = "node"; node.textContent = String(i + 1);
    rail.appendChild(node); el.appendChild(rail);
    const cards = document.createElement("div"); cards.className = "orch-cards";
    row.cards.forEach(id => cards.appendChild(phaseCardEl(ctx, byId[id], colors, oppPhases)));
    row.gates.forEach(b => cards.appendChild(gateFrame(ctx, b, colors, oppPhases, sigKeys, 0)));
    el.appendChild(cards);
    dag.appendChild(el);
  });
  dag.appendChild(gridDropZone(ctx, rows.length, true));
  grid.appendChild(dag);
}

// A drop target between/after levels. Dropping an action here moves its
// depends_on to that level; dropping a ref/gate here pulls it OUT of its gate
// (ungate / move gate to top level). Handled by editor.js via ctx.onGridDrop.
function gridDropZone(ctx, level, isNew) {
  const z = document.createElement("div"); z.className = "drop-zone orch-drop-zone";
  const lbl = document.createElement("span"); lbl.className = "zone-label";
  lbl.textContent = isNew ? "＋ drop here for a new level (or to pull an action out of a gate)" : "＋ drop here";
  z.appendChild(lbl);
  z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("hover"); });
  z.addEventListener("dragleave", () => z.classList.remove("hover"));
  z.addEventListener("drop", e => { e.preventDefault(); z.classList.remove("hover"); ctx.onGridDrop(level, e); });
  return z;
}

// An ungated action card on the grid. Draggable two ways at once: text/phase to
// REFERENCE it into a gate lane, text/plain to move its depends_on level.
function phaseCardEl(ctx, p, colors, oppPhases) {
  const { state } = ctx;
  const card = makeCard(p, colors[p.group], (oppPhases[p.id] || {}).mark);
  card.draggable = true;
  card.addEventListener("dragstart", e => {
    try { e.dataTransfer.setData("text/phase", p.id); e.dataTransfer.setData("text/plain", p.id); } catch (_) {}
    state.dragId = p.id; document.body.classList.add("dragging");
  });
  card.addEventListener("dragend", () => { state.dragId = null; document.body.classList.remove("dragging"); });
  card.addEventListener("click", () => ctx.selectPhase(p.id));
  if (p.id === state.selected) card.classList.add("selected");
  return card;
}

// A gate rendered as a FRAME with header + lanes (then/else for if, body for a
// loop). Draggable (text/refid) so it can be moved or nested into another lane.
function gateFrame(ctx, b, colors, oppPhases, sigKeys, depth) {
  const kind = blockConstruct(b), loop = isLoopBlock(b);
  const gate = document.createElement("div");
  gate.className = "gate" + (loop ? " loop" : "");
  gate.dataset.blockId = b._id;                 // transient handle (selection/drag)
  if (b.id) gate.dataset.blockKey = b.id;       // persisted id — what depends_on points at
  gate.draggable = true;
  // body.dragging is what expands the grid drop zones from 4px to a hittable
  // band — without it a gate/ref can be picked up but has nowhere to land.
  gate.addEventListener("dragstart", e => {
    e.stopPropagation();
    try { e.dataTransfer.setData("text/refid", b._id); } catch (_) {}
    document.body.classList.add("dragging");
  });
  gate.addEventListener("dragend", () => document.body.classList.remove("dragging"));
  if (ctx.state.selectedGate === b._id) gate.classList.add("selected");

  const head = document.createElement("div"); head.className = "gate-head";
  head.addEventListener("click", e => { e.stopPropagation(); ctx.onSelectGate(b._id); });
  const icon = document.createElement("span"); icon.className = loop ? "gate-icon-loop" : "gate-icon-if";
  if (loop) icon.textContent = "↻";
  head.appendChild(icon);
  const kw = document.createElement("span"); kw.className = "gate-kw"; kw.textContent = kind.replace("_", " ");
  head.appendChild(kw);
  // The block id — what tells two identical conditions apart, and what a phase's
  // depends_on points at. Always shown so the graph and the Wiring list agree.
  if (b.id) {
    const bid = document.createElement("span"); bid.className = "gate-id"; bid.textContent = b.id;
    head.appendChild(bid);
  }
  if (kind === "for_each") head.appendChild(forEachHeaderEl(b, sigKeys));
  else head.appendChild(condEl(condOf(b), sigKeys));
  if (loop) {
    const ok = Number.isInteger(b.cap) && b.cap > 0;
    const cap = document.createElement("span"); cap.className = "cap-chip";
    if (ok) cap.textContent = "cap " + b.cap; else { cap.classList.add("bad"); cap.textContent = "cap required"; }
    head.appendChild(cap);
  }
  const edit = document.createElement("span"); edit.className = "gate-edit";
  edit.textContent = ctx.state.selectedGate === b._id ? "✎ editing" : "✎";
  head.appendChild(edit);
  gate.appendChild(head);

  const body = document.createElement("div"); body.className = "gate-body";
  if (kind === "if") {
    body.classList.add("branches");
    body.appendChild(laneEl(ctx, b, "then", colors, oppPhases, sigKeys, depth));
    body.appendChild(laneEl(ctx, b, "else", colors, oppPhases, sigKeys, depth));
  } else {
    listBlocks(ctx, b.body, colors, oppPhases, sigKeys, depth + 1).forEach(el => body.appendChild(el));
    body.appendChild(dropSlot(ctx, b._id, "body"));
  }
  gate.appendChild(body);
  return gate;
}

function laneEl(ctx, b, slot, colors, oppPhases, sigKeys, depth) {
  const lane = document.createElement("div"); lane.className = "lane" + (slot === "then" ? " then" : "");
  const label = document.createElement("div"); label.className = "lane-label"; label.textContent = slot;
  lane.appendChild(label);
  listBlocks(ctx, b[slot], colors, oppPhases, sigKeys, depth + 1).forEach(el => lane.appendChild(el));
  lane.appendChild(dropSlot(ctx, b._id, slot));
  return lane;
}

// The children of a lane/body: a ref renders as its action card, a nested gate
// as another frame (recursion — this is how gates nest).
function listBlocks(ctx, arr, colors, oppPhases, sigKeys, depth) {
  return (arr || []).map(b => blockConstruct(b) === "ref"
    ? refCardEl(ctx, b, colors, oppPhases)
    : gateFrame(ctx, b, colors, oppPhases, sigKeys, depth));
}

// A ref (a gated action) inside a lane. Draggable as text/refid so it MOVES
// (out to the grid, or into another lane) rather than duplicating.
function refCardEl(ctx, b, colors, oppPhases) {
  const { state } = ctx;
  const p = (state.model.phases || []).find(x => x.id === b.ref);
  if (!p) { const miss = document.createElement("div"); miss.className = "help-note"; miss.textContent = "Unknown ref: " + b.ref; return miss; }
  const card = makeCard(p, colors[p.group], (oppPhases[p.id] || {}).mark);
  card.draggable = true;
  // body.dragging expands the grid drop zones so this card can be pulled OUT of
  // its gate onto the graph (ungate); without it there is nowhere to drop.
  card.addEventListener("dragstart", e => {
    e.stopPropagation();
    try { e.dataTransfer.setData("text/refid", b._id); } catch (_) {}
    state.dragId = p.id; document.body.classList.add("dragging");
  });
  card.addEventListener("dragend", () => { state.dragId = null; document.body.classList.remove("dragging"); });
  card.addEventListener("click", e => { e.stopPropagation(); ctx.selectPhase(p.id, b._id); });
  if (p.id === state.selected) card.classList.add("selected");
  return card;
}

function dropSlot(ctx, containerId, slot) {
  const el = document.createElement("div"); el.className = "drop-slot";
  el.textContent = "＋ drag an action here";
  el.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); el.classList.add("hover"); });
  el.addEventListener("dragleave", () => el.classList.remove("hover"));
  el.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); el.classList.remove("hover"); ctx.onDrop(ctx, containerId, slot, e); });
  return el;
}

// --- condition rendering -----------------------------------------------------
// On-disk cond shape (see editlogic.js condKind): string (escape-hatch) |
// {op, left, right?} (leaf) | {and:[…]} | {or:[…]} | {not:cond}. Operand kind
// is inferred (no {kind,value} tagging in the engine): object -> builtin
// ({name: arg}); string matching a known signal key -> signal; anything else
// -> literal. Mirrors _operand_type()/orchestrationIssues().
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

// notBadgeRead/connReadEl mirror the prototype's notBadge(active=true, ro=true)
// and connRead(bool) — read-only, no click handler, colors/radii copied verbatim.
function notBadgeRead() {
  const b = document.createElement("span");
  b.className = "cond-not";
  b.textContent = "NOT";
  return b;
}
function connReadEl(word) {                 // word: "and" | "or"
  const s = document.createElement("span");
  s.className = "cond-conn cond-conn-" + word;
  s.textContent = word.toUpperCase();
  return s;
}

// condEl recurses over the condition tree (readNode in the prototype). A
// leaf is a "cond-pill" (reuses operandEl); an and/or group at depth 0 is a
// flat wrapping row ("cond-row" — no outer parens, it's already the block's
// only condition); an and/or group at depth > 0 is a translucent bordered
// box tinted by its connector ("cond-group cond-group-and|or") that ALSO
// carries literal colored "(" "/" ")" glyphs ("cond-paren cond-paren-and|or")
// bracketing its members, mirroring the prototype's readNode; "not" prefixes
// a NOT badge and recurses into the negated node at the same depth.
function condEl(cond, sigKeys, depth = 0) {
  const kind = condKind(cond);
  if (kind === "escape") {
    const pill = document.createElement("span"); pill.className = "cond-pill";
    const bolt = document.createElement("span"); bolt.className = "cond-lit"; bolt.textContent = "⚡";
    const txt = document.createElement("span"); txt.style.fontStyle = "italic";
    txt.textContent = cond || "free predicate";
    pill.appendChild(bolt); pill.appendChild(txt);
    return pill;
  }
  if (kind === "empty") {
    const pill = document.createElement("span"); pill.className = "cond-pill";
    return pill;
  }
  if (kind === "not") {
    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex"; wrap.style.alignItems = "center"; wrap.style.gap = "6px";
    wrap.appendChild(notBadgeRead());
    wrap.appendChild(condEl(cond.not, sigKeys, depth));
    return wrap;
  }
  if (isGroupCond(cond)) {
    const members = cond[kind];
    const box = document.createElement("span");
    box.className = depth === 0 ? "cond-row" : "cond-group cond-group-" + kind;
    if (depth > 0) {
      const open = document.createElement("span");
      open.className = "cond-paren cond-paren-" + kind;
      open.textContent = "(";
      box.appendChild(open);
    }
    members.forEach((m, i) => {
      if (i > 0) box.appendChild(connReadEl(kind));
      box.appendChild(condEl(m, sigKeys, depth + 1));
    });
    if (depth > 0) {
      const close = document.createElement("span");
      close.className = "cond-paren cond-paren-" + kind;
      close.textContent = ")";
      box.appendChild(close);
    }
    return box;
  }
  // leaf: {op, left, right?}. A builtin left (file_exists/dir_exists, an
  // object) is a self-contained predicate — no op/right rendered at all,
  // even though it is stored as op:"exists" on disk. A non-builtin
  // op:"exists" (e.g. a signal existence check) still shows the "exists"
  // word, just no right operand. Mirrors leafRead()'s isB handling and the
  // python _render_condition().
  const pill = document.createElement("span"); pill.className = "cond-pill";
  const isBuiltin = cond.left && typeof cond.left === "object";
  pill.appendChild(operandEl(cond.left, sigKeys));
  if (!isBuiltin) {
    const op = document.createElement("span"); op.className = "cond-op"; op.textContent = cond.op || "";
    pill.appendChild(op);
    if (cond.op !== "exists") pill.appendChild(operandEl(cond.right, sigKeys));
  }
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

// Two explicit drag gestures, distinguished by dataTransfer payload (never by
// container/slot): a ref vignette drags "text/refid" (its own `_id`) → MOVE —
// splice it out of its current parent array and push it into the target, no
// duplicate; a palette/tray chip drags "text/phase" (a phase id) → REFERENCE —
// push a brand-new {_id, ref} block, leaving the palette/tray source untouched
// (the palette is a source of references, not a slot something is removed from).
export function orchDrop(ctx, containerId, slot, ev) {
  ev.preventDefault();
  const refId = ev.dataTransfer.getData("text/refid");
  const phase = ev.dataTransfer.getData("text/phase");
  const bs = ctx.state.model.orchestration;
  const target = containerArray(bs, containerId, slot); if (!target) return;
  let dropped = null;
  if (refId) {                                   // MOVE an existing ref or gate
    const f = findBlock(bs, refId); if (!f) return;
    const moved = f.block;
    // Guard: never nest a gate into its own subtree (would detach/loop it).
    if (blockConstruct(moved) !== "ref") {
      let intoSelf = moved._id === containerId;
      iterBlocks([moved], x => { if (x._id === containerId) intoSelf = true; });
      if (intoSelf) return;
    }
    f.parent.splice(f.index, 1); target.push(moved); dropped = moved;
  } else if (phase) {                            // REFERENCE an action into a gate
    dropped = { _id: newId(), ref: phase }; target.push(dropped);
  }
  // Renew dependencies to the new block context. A dropped ACTION: recompute its
  // own deps. A dropped GATE (moved with its subtree): recompute the ENTRY action
  // of each of its lanes — those are the ones whose deps pointed at the gate's old
  // predecessors; deeper actions depend on siblings that moved along.
  if (dropped && blockConstruct(dropped) === "ref") {
    const p = (ctx.state.model.phases || []).find(x => x.id === dropped.ref);
    if (p) {
      const deps = laneEntryDeps(ctx.state.model, containerId, slot, dropped._id);
      if (deps.length) p.depends_on = deps; else delete p.depends_on;
    }
  } else if (dropped) {
    renewGateEntryDeps(ctx.state.model, dropped._id);
  }
  ctx.refreshView().then(() => ctx.rerender());
}

// After a gate moves, its lanes' ENTRY actions still carry the gate's OLD
// predecessors as deps. Recompute the first item of each lane to the new context
// (recursing when the first item is itself a nested gate).
function renewGateEntryDeps(model, gateUid) {
  for (const slot of ["then", "else", "body"]) {
    const lane = containerArray(model.orchestration, gateUid, slot);
    if (!lane || !lane.length) continue;
    const first = lane[0];
    if (blockConstruct(first) === "ref") {
      const p = (model.phases || []).find(x => x.id === first.ref);
      if (p) {
        const deps = laneEntryDeps(model, gateUid, slot, first._id);
        if (deps.length) p.depends_on = deps; else delete p.depends_on;
      }
    } else {
      renewGateEntryDeps(model, first._id);
    }
  }
}

// ============================================================================
// Gate edit panel (Task 10) — construct, condition builder, cap, for_each.
// Translated from the proto's gatePanel/operandCtrl/setConstruct/setOp/
// setOperand/setCap/setList/setAs/toggleEscape (docs/superpowers/specs/
// 2026-07-13-orchestration-refs/orchestration-prototype.dc.html, class
// Component extends DCLogic) to vanilla DOM + the ENGINE block shape:
// construct name IS the key ({if:{cond},then,else} / {while:{cond},cap,body} /
// {for_each:"sig",as,cap,body}) — no {type,cond} tagging as in the proto.
//
// Condition shape on disk: {op, left, right} (schema: left/right are
// UNTYPED — `{}` in orchestration.schema.json — not constrained to scalars).
// A signal operand is the signal-key string ("recon.endpoints"); a literal is
// its text; a builtin is a ONE-KEY OBJECT ({file_exists: "path"} /
// {dir_exists: "path"}) — confirmed against bb-workflow's _operand_type()
// (isinstance(operand, dict) -> "builtin") and the existing fixture
// {"if": {"op": "exists", "left": {"file_exists": "x.txt"}}} in
// test_workflow_orchestration.py, and already how condEl()/operandEl() above
// render a builtin. The escape-hatch condition is a bare string in place of
// the {op,left,right} object.
// ============================================================================
const OPS = ["==", "!=", "<", ">", "<=", ">=", "contains", "matches", "exists"];
const BUILTINS = ["file_exists", "dir_exists"];
function defaultCond() { return { op: "==", left: "", right: "" }; }

// Reshape `block`'s keys IN PLACE to the target construct kind, preserving the
// condition (if/while/until — structured or escape-hatch string) and the child
// blocks (then+else <-> body) across the switch. `_id` is left untouched.
export function setConstruct(block, kind) {
  if (blockConstruct(block) === kind) return;
  const cond = condOf(block);                                                  // existing if/while/until condition, or null
  const kids = (block.then || block.body || []).concat(block.else || []);      // preserved children
  const oldForEach = typeof block.for_each === "string" ? block.for_each : "";
  const oldAs = block.as;
  // Preserve an existing VALID integer cap across the switch; otherwise the
  // cap key stays ABSENT (never re-introduced as `cap: null`) — unset-and-OK
  // is absent, not null (see addGate's comment for why).
  const oldCap = Number.isInteger(block.cap) && block.cap > 0 ? block.cap : undefined;

  delete block.if; delete block.while; delete block.until; delete block.for_each;
  delete block.then; delete block.else; delete block.body; delete block.as; delete block.cap;

  if (kind === "if") {
    block.if = cond != null ? cond : defaultCond();
    block.then = kids;
    block.else = [];
  } else if (kind === "for_each") {
    block.for_each = oldForEach;
    block.as = oldAs || "item";
    if (oldCap !== undefined) block.cap = oldCap;  // else leave absent — never auto-fill, never null
    block.body = kids;
  } else { // while / until
    block[kind] = cond != null ? cond : defaultCond();
    if (oldCap !== undefined) block.cap = oldCap;  // else leave absent — never auto-fill, never null
    block.body = kids;
  }
}

export function setOp(block, op) {
  const k = blockConstruct(block);
  const cond = block[k];
  if (!cond || typeof cond !== "object") block[k] = { op, left: "", right: "" };
  else cond.op = op;
}
export function setOperand(block, side, value) {
  const cond = block[blockConstruct(block)];
  if (!cond || typeof cond !== "object") return;
  cond[side] = value;
}
export function toggleEscape(block) {
  const k = blockConstruct(block);
  block[k] = (typeof block[k] === "string") ? defaultCond() : "";
}
export function setCap(block, raw) {
  const n = parseInt(raw, 10);
  // Empty/invalid/<=0 -> DELETE the key (absent, never `cap: null` — null
  // fails validate_schema's blocking check; absent only trips the
  // warning-only "missing mandatory cap" semantic check). No auto-fill;
  // empty/bad stays an unset, warning-flagged cap on purpose.
  if (raw === "" || Number.isNaN(n) || n <= 0) delete block.cap;
  else block.cap = n;
}
export function setList(block, v) { block.for_each = v; }
export function setAs(block, v) { block.as = v; }

// Splice `block` out of whatever array (top-level or a nested then/else/body)
// currently holds it, via findBlock — which returns the real parent array
// reference regardless of nesting depth.
export function removeBlock(ctx, block) {
  const roots = ctx.state.model.orchestration || [];
  const f = findBlock(roots, block._id);
  if (f) f.parent.splice(f.index, 1);
  ctx.state.selectedGate = null;
  ctx.refreshView();
  ctx.close();
}

// Every gate-panel edit follows the same aftermath: mutate the block in
// place (above), refresh the server-side warnings/overlay, rerender the grid
// (so the gate chip updates live), and redraw the panel itself (structural
// changes — construct switch, op flipping to/from "exists" — change what the
// panel shows next).
function applyGateEdit(ctx) {
  ctx.refreshView();
  ctx.rerender();
  ctx.redraw();
}

// --- operand kind (transient, UI-only — NOT serialized) ---------------------
// Recursive nesting (Task 8) means an operand lives at a PATH inside the
// condition tree, not at a fixed `block[side]` slot — so the kind selection
// can no longer be cached on the block itself (`_leftKind`/`_rightKind`, one
// slot per block). Instead each gatePanel() call owns one `opKinds` Map, keyed
// by "path:side", threaded through every builder function below. Never
// touches the model, so there is nothing to strip at save time.
function deriveOperandKind(value, sigKeys) {
  if (value && typeof value === "object" && !Array.isArray(value)) return "builtin";
  if (typeof value === "string" && sigKeys.has(value)) return "signal";
  return "literal";
}
function opKindMapKey(path, side) { return path.join(",") + ":" + side; }
// Read the cached kind for (path, side), deriving + caching it on first use
// so flipping through kinds in the UI doesn't re-derive from a value the user
// is actively editing away from (e.g. picking "signal" before choosing one).
function operandKindAt(opKinds, path, side, cond, sigKeys) {
  const key = opKindMapKey(path, side);
  if (!opKinds.has(key)) opKinds.set(key, deriveOperandKind(cond ? cond[side] : undefined, sigKeys));
  return opKinds.get(key);
}

// --- signal picker popover (grouped by emitting phase). Selection-only —
// declaration lives on the producing action's Wiring → Signals (Task 7). One
// popover instance at a time, closed on outside click / Escape — same idiom
// as openGateMenu above.
let _sigPopEl = null;
function closeSigPopover() {
  if (_sigPopEl) { _sigPopEl.remove(); _sigPopEl = null; }
  document.removeEventListener("mousedown", onSigPopOutsideClick, true);
  document.removeEventListener("keydown", onSigPopKeydown, true);
}
function onSigPopOutsideClick(e) {
  if (_sigPopEl && !_sigPopEl.contains(e.target)) closeSigPopover();
}
function onSigPopKeydown(e) {
  if (e.key === "Escape") closeSigPopover();
}

// Signal list grouped by phase — the picker's default view. `path` addresses
// the LEAF (its condition lives at getCondAt(root, path)); `side` is left/right.
function renderSignalList(pop, ctx, block, path, side, commit) {
  pop.replaceChildren();
  const root = block[blockConstruct(block)];
  const cond = getCondAt(root, path);
  const sigs = signalsOf(ctx.state.model);
  const groups = {};
  sigs.forEach(s => { (groups[s.phase] = groups[s.phase] || []).push(s); });
  const phaseIds = Object.keys(groups);
  if (!phaseIds.length) {
    const empty = document.createElement("div"); empty.className = "sig-pop-empty";
    empty.textContent = "No signals declared. Declare one in the producing action's Wiring → Signals.";
    pop.appendChild(empty);
  }
  phaseIds.forEach(phaseId => {
    const s0 = groups[phaseId][0];
    const head = document.createElement("div"); head.className = "sig-pop-group";
    head.textContent = (s0.phaseName && s0.phaseName !== phaseId)
      ? `${s0.phaseName} (${phaseId})` : phaseId;      // emitter: human name + id
    pop.appendChild(head);
    groups[phaseId].forEach(s => {
      const item = document.createElement("button"); item.type = "button"; item.className = "sig-pop-item";
      if (cond && cond[side] === s.key) item.classList.add("active");
      item.textContent = `${s.name} · ${s.type}` + (s.source ? ` · ${s.source}` : "");  // + how it's produced
      item.addEventListener("click", e => {
        e.stopPropagation();
        closeSigPopover();
        commit(setCondAt(root, path.concat([side]), s.key));
      });
      pop.appendChild(item);
    });
  });
  // NO "＋ Declare a new signal" — declaration lives on the producing action's Wiring.
}

function openSignalPicker(ctx, block, path, side, commit, buttonEl) {
  closeSigPopover();
  const pop = document.createElement("div"); pop.className = "sig-popover";
  renderSignalList(pop, ctx, block, path, side, commit);
  document.body.appendChild(pop);
  const rect = buttonEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + "px";
  pop.style.left = rect.left + "px";
  _sigPopEl = pop;
  // deferred so the click that opened the popover doesn't immediately close it
  setTimeout(() => {
    document.addEventListener("mousedown", onSigPopOutsideClick, true);
    document.addEventListener("keydown", onSigPopKeydown, true);
  }, 0);
}

// Grouped-by-phase signal picker: a button showing the current operand (or
// a placeholder) opens a popover listing signalsOf(model) grouped by their
// emitting phase (each headed by phase name+id) for selection only. Signal
// declaration happens in the producing action's Wiring tab. Path-aware
// (Task 8) so it addresses a leaf at ANY depth, not just the block's own
// top-level condition — the signal-selection UX itself is unchanged.
function signalOperandControl(ctx, block, path, side, cond, commit) {
  const wrap = document.createElement("div"); wrap.className = "sig-picker";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "sig-picker-btn";
  const cur = cond ? cond[side] : "";
  btn.textContent = cur ? "◈ " + cur : "◈ pick a signal…";
  btn.addEventListener("click", e => { e.stopPropagation(); openSignalPicker(ctx, block, path, side, commit, btn); });
  wrap.appendChild(btn);
  return wrap;
}

function builtinOperandControl(ctx, block, path, side, cond, commit) {
  const wrap = document.createElement("div"); wrap.className = "op-builtin-row";
  const root = block[blockConstruct(block)];
  const cur = (cond && cond[side] && typeof cond[side] === "object") ? cond[side] : {};
  const entry = Object.entries(cur)[0] || [BUILTINS[0], ""];
  const sel = document.createElement("select");
  BUILTINS.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; if (n === entry[0]) o.selected = true; sel.appendChild(o); });
  const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "path"; inp.value = entry[1] || "";
  // A builtin left is a self-contained predicate: op is forced to "exists" and
  // the right operand is dropped (mini-spec §2/§4, brief Step 2). Built as one
  // new leaf object (immutable) so a stray `right` never survives — `path`
  // here addresses the leaf itself (see operandCtrl's doc comment above).
  const apply = () => {
    if (side === "left") {
      const leaf = { ...(cond || {}), left: { [sel.value]: inp.value }, op: "exists" };
      delete leaf.right;
      commit(setCondAt(root, path, leaf));
      return;
    }
    commit(setCondAt(root, path.concat([side]), { [sel.value]: inp.value }));
  };
  sel.addEventListener("change", apply);
  inp.addEventListener("change", apply);
  wrap.appendChild(sel); wrap.appendChild(inp);
  return wrap;
}

function literalOperandControl(ctx, block, path, side, cond, commit) {
  const root = block[blockConstruct(block)];
  const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "literal value";
  const v = cond ? cond[side] : undefined;
  inp.value = (typeof v === "string") ? v : (v == null ? "" : String(v));
  inp.addEventListener("change", () => commit(setCondAt(root, path.concat([side]), inp.value)));
  return inp;
}

// Icon + tooltip label for each operand kind (mini-spec §3 — icons always
// visible, label on hover, no hidden menu).
const KIND_META = {
  signal: { glyph: "◈", label: "signal — value emitted by an action" },
  literal: { glyph: "“”", label: "literal — a fixed value you type" },
  builtin: { glyph: "ƒ", label: "built-in — file_exists / dir_exists (self-contained predicate)" },
};

// One operand (left/right) of a structured condition leaf living at `path`: a
// kind segmented control (◈ signal / "" literal / ƒ builtin — the right side
// has no builtin option, per the brief) + the operand's own control, tinted
// by kind via the wrapping .op-box.<kind> (CSS in editor.css). Generalized
// (Task 8) to be PATH-aware so it can address a leaf at any nesting depth,
// not just the block's own flat condition — `commit(newRoot)` persists.
function operandCtrl(ctx, block, path, side, opKinds, commit) {
  const root = block[blockConstruct(block)];
  const cond = getCondAt(root, path);
  const sigKeys = new Set(signalsOf(ctx.state.model).map(s => s.key));
  const kind = operandKindAt(opKinds, path, side, cond, sigKeys);
  const box = document.createElement("div"); box.className = "op-box " + kind;

  const label = document.createElement("div"); label.className = "op-box-label"; label.textContent = side + " operand";
  box.appendChild(label);

  const kinds = side === "left" ? ["signal", "literal", "builtin"] : ["signal", "literal"];
  const seg = document.createElement("div"); seg.className = "op-kind-seg";
  kinds.forEach(k => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.className = "op-kind-btn" + (k === kind ? " active" : "");
    btn.title = KIND_META[k].label;
    btn.textContent = KIND_META[k].glyph;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (k === kind) return;
      opKinds.set(opKindMapKey(path, side), k);
      let next;
      if (k === "builtin") {
        // left-only: forces op:"exists" too, and drops any stray `right` so
        // the persisted leaf is exactly {op:"exists", left:{<fn>:"arg"}} —
        // built as one new leaf object (immutable), not two field patches.
        const leaf = { ...(cond || {}), left: { [BUILTINS[0]]: "" }, op: "exists" };
        delete leaf.right;
        next = setCondAt(root, path, leaf);
      } else {
        next = setCondAt(root, path.concat([side]), "");
        // Leaving builtin on the LEFT: "exists" only made sense while the
        // right operand was hidden by a builtin left. Reset op so the right
        // operand re-appears instead of persisting a hidden, incoherent leaf.
        if (side === "left" && cond && cond.op === "exists") {
          next = setCondAt(next, path.concat(["op"]), "==");
        }
      }
      commit(next);
    });
    seg.appendChild(btn);
  });
  box.appendChild(seg);

  if (kind === "signal") box.appendChild(signalOperandControl(ctx, block, path, side, cond, commit));
  else if (kind === "builtin") box.appendChild(builtinOperandControl(ctx, block, path, side, cond, commit));
  else box.appendChild(literalOperandControl(ctx, block, path, side, cond, commit));
  return box;
}

// ============================================================================
// Recursive condition builder (Task 8) — replaces the flat single-leaf editor
// with an inline builder for composite and/or/not conditions, ported from
// condition-builder-prototype.dc.html's build()/kindSelect()/operandCtrl()
// (docs/superpowers/specs/2026-07-16-conditions-and-or-not-refs/) onto the
// awok on-disk shape + the Task-6 immutable mutators (editlogic.js):
// string (escape-hatch) | {op,left,right?} (leaf) | {and:[…]} | {or:[…]} |
// {not: …}. `not` is a WRAPPING NODE on disk (unlike the prototype's flat
// `neg` flag on the same node) — see buildCond below for how that's resolved
// so the NOT badge renders exactly once per node, active or not, at every
// depth including the root (mini-spec §2/§4).
//
// Every control commits through `commitCond`, per the brief's contract: it
// never mutates the block in place directly, only via a Task-6 mutator's
// returned (new) root.
// ============================================================================
const MAX_GROUP_DEPTH = 2;   // authoring cap (engine imposes none); mini-spec §2 "ajustable"

// Writes the (possibly nested) condition root back into `block` under its
// construct key (if/while/until) and runs the panel's standard aftermath.
// The one and only persist path for every control below — no other setter
// touches block[kind] for a structured condition.
function commitCond(block, newRoot, ctx) {
  block[blockConstruct(block)] = newRoot;
  applyGateEdit(ctx);
}

function firstSignalKey(ctx) {
  const sigs = signalsOf(ctx.state.model);
  return sigs.length ? sigs[0].key : "";
}
function defaultLeaf(ctx) { return { op: "==", left: firstSignalKey(ctx), right: "" }; }
function defaultSubgroup(ctx) { return { or: [defaultLeaf(ctx)] }; }

// Clickable NOT badge — the interactive twin of notBadgeRead() above. Always
// rendered (active or not) so negation can be toggled on ANY node.
function notToggleBtn(active, onClick) {
  const b = document.createElement("span");
  b.className = "cond-not-btn" + (active ? " active" : "");
  b.textContent = "NOT";
  b.title = "NOT — negate this block";
  b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return b;
}
// Clickable connector pill — the interactive twin of connReadEl() above;
// flips the WHOLE group's and<->or.
function connToggleBtn(word, onClick) {
  const s = document.createElement("span");
  s.className = "cond-conn-btn cond-conn-" + word;
  s.textContent = word.toUpperCase();
  s.title = "click to toggle AND / OR";
  s.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return s;
}
function parenGlyph(word, ch) {
  const s = document.createElement("span");
  s.className = "cond-paren cond-paren-" + word;
  s.textContent = ch;
  return s;
}
function addComparisonBtn(onClick) {
  const b = document.createElement("span"); b.className = "cond-add-btn";
  b.textContent = "＋"; b.title = "add a comparison";
  b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return b;
}
function addSubgroupBtn(onClick) {
  const b = document.createElement("span"); b.className = "cond-addgrp-btn";
  b.textContent = "()"; b.title = "add a sub-group";
  b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return b;
}
function removeCondBtn(onClick) {
  const b = document.createElement("span"); b.className = "cond-remove-btn";
  b.textContent = "✕"; b.title = "remove";
  b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
  return b;
}

// buildCond recurses over the condition tree, rendering an editable node at
// `path` (root = []). A `not` wrapper is transparent to depth (it is a flag
// envelope, not a nesting level): this call resolves it ONCE — computing a
// single notToggle for `path`'s own slot (toggling wraps/unwraps whatever is
// there) — then dispatches to the group/leaf renderer for the (unwrapped)
// body, so the badge never renders twice for the same logical node.
function buildCond(ctx, block, path, depth, opKinds) {
  const root = block[blockConstruct(block)];
  const node = getCondAt(root, path);
  const negated = condKind(node) === "not";
  const bodyPath = negated ? path.concat(["not"]) : path;
  const bodyNode = negated ? node.not : node;
  const kind = condKind(bodyNode);
  const commit = (newRoot) => commitCond(block, newRoot, ctx);
  const notBtn = notToggleBtn(negated, () => commit(toggleNotAt(root, path)));

  // `path` (pre-unwrap) is the ONLY address that points at this node's actual
  // slot in its parent array — for a negated node, bodyPath points INSIDE the
  // `{not:…}` wrapper instead, whose parent is the wrapper object, not an
  // array (removeCondAt's no-op branch). So `path` is threaded through
  // separately, used ONLY by the ✕ button; every other control below keeps
  // addressing the unwrapped `bodyPath`.
  if (kind === "and" || kind === "or") {
    return buildGroupCond(ctx, block, root, bodyPath, bodyNode, kind, depth, notBtn, commit, opKinds, path);
  }
  return buildLeafCond(ctx, block, bodyPath, bodyNode, depth, notBtn, commit, opKinds, path);
}

function buildGroupCond(ctx, block, root, path, node, kind, depth, notBtn, commit, opKinds, removePath) {
  const members = node[kind];
  const box = document.createElement("span");
  box.className = depth === 0 ? "cond-build-row" : "cond-build-group cond-build-group-" + kind;
  box.appendChild(notBtn);
  if (depth > 0) box.appendChild(parenGlyph(kind, "("));
  members.forEach((m, i) => {
    if (i > 0) box.appendChild(connToggleBtn(kind, () => commit(toggleConnectorAt(root, path))));
    box.appendChild(buildCond(ctx, block, path.concat([kind, i]), depth + 1, opKinds));
  });
  if (depth > 0) box.appendChild(parenGlyph(kind, ")"));
  box.appendChild(addComparisonBtn(() => commit(addComparisonAt(root, path, defaultLeaf(ctx)))));
  if (depth < MAX_GROUP_DEPTH) box.appendChild(addSubgroupBtn(() => commit(addSubgroupAt(root, path, defaultSubgroup(ctx)))));
  // ✕ removes THIS node from its parent array — must use removePath (the
  // pre-unwrap address), not `path` (unwrapped — see buildCond's comment).
  if (depth > 0) box.appendChild(removeCondBtn(() => commit(removeCondAt(root, removePath))));
  return box;
}

// A leaf: NOT badge + left operand + op (unless builtin left) + right operand
// (unless builtin left or op:"exists") + ✕ (nested leaves only — a leaf that
// IS the whole root has nothing to remove into).
function buildLeafCond(ctx, block, path, node, depth, notBtn, commit, opKinds, removePath) {
  const cond = (node && typeof node === "object") ? node : { op: "==", left: "", right: "" };
  const root = block[blockConstruct(block)];
  const isBuiltin = cond.left && typeof cond.left === "object";
  const box = document.createElement("span"); box.className = "cond-build-leaf";
  box.appendChild(notBtn);
  box.appendChild(operandCtrl(ctx, block, path, "left", opKinds, commit));
  if (!isBuiltin) {
    const opSel = document.createElement("select"); opSel.className = "cond-build-op";
    OPS.forEach(op => { const o = document.createElement("option"); o.value = op; o.textContent = op; if (op === cond.op) o.selected = true; opSel.appendChild(o); });
    opSel.addEventListener("change", () => commit(setCondAt(root, path.concat(["op"]), opSel.value)));
    box.appendChild(opSel);
    if (cond.op !== "exists") box.appendChild(operandCtrl(ctx, block, path, "right", opKinds, commit));
  }
  // ✕ removes THIS leaf from its parent array — must use removePath (the
  // pre-unwrap address), not `path` (unwrapped — see buildCond's comment).
  if (depth > 0) box.appendChild(removeCondBtn(() => commit(removeCondAt(root, removePath))));
  return box;
}

// Help legend (mini-spec §3) — added once, at the bottom of the builder.
const COND_HELP_ITEMS = [
  ["◈", "signal — value emitted by an action", "var(--accent)"],
  ["“”", "literal — a fixed value you type", "var(--warn-2)"],
  ["ƒ", "built-in — file_exists / dir_exists (self-contained predicate)", "var(--violet-2)"],
  ["AND / OR", "connector — click a pill to toggle", "#93c5fd"],
  ["( )", "group / parenthesis", "var(--violet-2)"],
  ["NOT", "negation — click the badge to toggle", "#fca5a5"],
];
function condHelpPanel() {
  const box = document.createElement("div"); box.className = "cond-help-panel";
  const head = document.createElement("div"); head.className = "cond-help-head";
  head.textContent = "Help · operand types & symbols";
  box.appendChild(head);
  COND_HELP_ITEMS.forEach(([glyph, label, color]) => {
    const row = document.createElement("div"); row.className = "cond-help-item";
    const g = document.createElement("span"); g.className = "cond-help-glyph"; g.style.color = color; g.textContent = glyph;
    const l = document.createElement("span"); l.textContent = label;
    row.appendChild(g); row.appendChild(l);
    box.appendChild(row);
  });
  return box;
}

// Entry point called from the gate panel: renders the recursive builder for
// the block's WHOLE structured condition, plus (once) the help legend.
//
// awok's on-disk root may be a bare LEAF (defaultCond() — no group at all),
// unlike the prototype whose root is always a group (its seed() starts from
// {t:'grp', ...}). A bare leaf root has no enclosing group box to hang
// "＋"/"()" off of, which would make it a dead end for ever building a
// composite condition — so when the (unwrapped) root is not itself a group,
// this also offers a "start a group" affordance that wraps the current root
// (negation included) together with a fresh comparison/sub-group.
function buildCondRoot(ctx, block, opKinds) {
  const wrap = document.createElement("div"); wrap.className = "cond-build-root";
  const root = block[blockConstruct(block)];
  const commit = (newRoot) => commitCond(block, newRoot, ctx);
  wrap.appendChild(buildCond(ctx, block, [], 0, opKinds));

  const bodyKind = condKind(root) === "not" ? condKind(root.not) : condKind(root);
  if (bodyKind !== "and" && bodyKind !== "or") {
    const controls = document.createElement("div"); controls.className = "cond-build-root-controls";
    controls.appendChild(addComparisonBtn(() => commit({ and: [root, defaultLeaf(ctx)] })));
    controls.appendChild(addSubgroupBtn(() => commit({ and: [root, defaultSubgroup(ctx)] })));
    wrap.appendChild(controls);
  }

  wrap.appendChild(condHelpPanel());
  return wrap;
}

// --- the panel itself --------------------------------------------------------
// ctx = { state, refreshView, rerender, close } (see editor.js selectGate).
// gatePanel adds a `redraw` seam onto ctx so every setter above can rebuild
// the panel's own content after a structural edit, without editor.js needing
// to know anything about the gate's internals.
export function gatePanel(ctx, block) {
  const panel = document.createElement("div");
  panel.style.cssText = "display:flex;flex-direction:column;min-height:0;flex:1 1 auto;height:100%";
  // Operand-kind UI cache for the recursive condition builder (Task 8) — one
  // Map per gate-editing session (survives redraws, reset when a different
  // gate is selected / this panel is rebuilt). See operandKindAt above.
  const opKinds = new Map();

  function draw() {
    panel.replaceChildren();
    const kind = blockConstruct(block);
    const loop = isLoopBlock(block);

    // header
    const head = document.createElement("div"); head.className = "drawer-head";
    const top = document.createElement("div"); top.className = "top";
    const icon = document.createElement("span");
    icon.className = loop ? "gate-icon-loop" : "gate-icon-if"; if (loop) icon.textContent = "↻";
    top.appendChild(icon);
    const title = document.createElement("span"); title.style.cssText = "font-weight:700;font-size:13.5px";
    title.textContent = loop ? "Loop block" : "Condition block";
    top.appendChild(title);
    const closeBtn = document.createElement("button"); closeBtn.className = "drawer-close"; closeBtn.textContent = "×";
    closeBtn.addEventListener("click", ctx.close);
    top.appendChild(closeBtn);
    head.appendChild(top);
    panel.appendChild(head);

    // body
    const body = document.createElement("div"); body.className = "drawer-body";

    const sub = (text) => { const h = document.createElement("div"); h.className = "sub-head"; h.textContent = text; return h; };

    body.appendChild(sub("Construct"));
    const seg = document.createElement("div"); seg.className = "seg";
    [["if", "if"], ["while", "while"], ["until", "until"], ["for_each", "for each"]].forEach(([k, lbl]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = lbl;
      if (k === kind) b.classList.add("active");
      b.addEventListener("click", () => { if (k === kind) return; setConstruct(block, k); applyGateEdit(ctx); });
      seg.appendChild(b);
    });
    body.appendChild(seg);

    // Block id — lets a phase depend on this whole block (via depends_on).
    body.appendChild(sub("Block id (optional)"));
    const idInp = document.createElement("input"); idInp.type = "text";
    idInp.value = block.id || ""; idInp.placeholder = "e.g. DEPS_GATE";
    idInp.addEventListener("change", () => {
      const v = idInp.value.trim();
      if (v) block.id = v; else delete block.id;
      applyGateEdit(ctx);
    });
    body.appendChild(idInp);

    if (loop) {
      body.appendChild(sub("Aggregated output (optional)"));
      const outRow = document.createElement("div"); outRow.className = "row-2";
      const roleCol = document.createElement("div");
      const roleLbl = document.createElement("label"); roleLbl.textContent = "role"; roleCol.appendChild(roleLbl);
      const roleInp = document.createElement("input"); roleInp.type = "text";
      roleInp.value = (block.output && block.output.role) || ""; roleInp.placeholder = "work:results";
      roleCol.appendChild(roleInp);
      const kindCol = document.createElement("div");
      const kindLbl = document.createElement("label"); kindLbl.textContent = "kind"; kindCol.appendChild(kindLbl);
      const kindSel = document.createElement("select");
      ["", "dir", "jsonl", "json", "md"].forEach(k => {
        const o = document.createElement("option"); o.value = k; o.textContent = k || "(none)";
        if (((block.output && block.output.kind) || "") === k) o.selected = true;
        kindSel.appendChild(o);
      });
      kindCol.appendChild(kindSel);
      const saveOut = () => {
        const role = roleInp.value.trim(); const kind = kindSel.value;
        if (role && kind) block.output = { role, kind }; else delete block.output;
        applyGateEdit(ctx);
      };
      roleInp.addEventListener("change", saveOut); kindSel.addEventListener("change", saveOut);
      outRow.appendChild(roleCol); outRow.appendChild(kindCol);
      body.appendChild(outRow);
    }

    if (kind === "for_each") {
      body.appendChild(sub("Iterate"));
      const row = document.createElement("div"); row.className = "row-2";
      const listCol = document.createElement("div");
      const listLbl = document.createElement("label"); listLbl.textContent = "list signal"; listCol.appendChild(listLbl);
      const listSel = document.createElement("select");
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "pick a list…"; listSel.appendChild(o0);
      signalsOf(ctx.state.model).filter(s => s.type === "list").forEach(s => {
        const o = document.createElement("option"); o.value = s.key; o.textContent = s.key;
        if (block.for_each === s.key) o.selected = true;
        listSel.appendChild(o);
      });
      listSel.addEventListener("change", () => { setList(block, listSel.value); applyGateEdit(ctx); });
      listCol.appendChild(listSel);
      const asCol = document.createElement("div");
      const asLbl = document.createElement("label"); asLbl.textContent = "as"; asCol.appendChild(asLbl);
      const asInp = document.createElement("input"); asInp.type = "text"; asInp.value = block.as || "";
      asInp.addEventListener("change", () => { setAs(block, asInp.value); applyGateEdit(ctx); });
      asCol.appendChild(asInp);
      row.appendChild(listCol); row.appendChild(asCol);
      body.appendChild(row);
    }

    if (kind === "if" || kind === "while" || kind === "until") {
      const cond = block[kind];
      const isFree = typeof cond === "string";
      body.appendChild(sub("Condition"));

      if (isFree) {
        const ta = document.createElement("textarea"); ta.rows = 3; ta.value = cond || "";
        ta.placeholder = "natural-language predicate…"; ta.style.fontStyle = "italic";
        ta.addEventListener("change", () => { block[kind] = ta.value; applyGateEdit(ctx); });
        body.appendChild(ta);
      } else {
        // Recursive inline builder (Task 8) — and/or/not, unbounded nesting
        // (authoring cap MAX_GROUP_DEPTH), operand kinds, NOT at any depth
        // incl. the root. Replaces the old flat single-leaf editor.
        body.appendChild(buildCondRoot(ctx, block, opKinds));
      }

      const esc = document.createElement("div"); esc.className = "escape-toggle";
      const bolt = document.createElement("span"); bolt.textContent = "⚡"; esc.appendChild(bolt);
      const escLbl = document.createElement("span");
      escLbl.textContent = isFree ? "Back to the structured builder" : "Switch to escape-hatch (free text)";
      esc.appendChild(escLbl);
      const escTag = document.createElement("span"); escTag.className = "standard-only-tag"; escTag.textContent = "standard-only";
      esc.appendChild(escTag);
      esc.addEventListener("click", () => { toggleEscape(block); applyGateEdit(ctx); });
      body.appendChild(esc);
    }

    if (loop) {
      const capOk = Number.isInteger(block.cap) && block.cap > 0;
      const capHead = document.createElement("div"); capHead.className = "sub-head";
      capHead.appendChild(document.createTextNode("Cap "));
      const star = document.createElement("span"); star.style.color = "var(--bad)"; star.textContent = "*";
      capHead.appendChild(star);
      body.appendChild(capHead);
      const capInp = document.createElement("input"); capInp.type = "number";
      capInp.placeholder = "required — max iterations";
      capInp.value = block.cap == null ? "" : block.cap;
      if (!capOk) capInp.classList.add("cap-invalid");
      capInp.addEventListener("change", () => { setCap(block, capInp.value); applyGateEdit(ctx); });
      body.appendChild(capInp);
      if (!capOk) {
        const warn = document.createElement("div"); warn.className = "help-note"; warn.style.color = "var(--bad)";
        warn.textContent = "⛔ A cap (integer > 0) is mandatory for every loop.";
        body.appendChild(warn);
      }
    }

    panel.appendChild(body);

    // footer
    const foot = document.createElement("div"); foot.className = "drawer-foot";
    const del = document.createElement("button"); del.className = "btn-del"; del.textContent = "Delete gate";
    del.addEventListener("click", () => removeBlock(ctx, block));
    foot.appendChild(del);
    const done = document.createElement("button"); done.className = "btn-done"; done.textContent = "Done";
    done.addEventListener("click", ctx.close);
    foot.appendChild(done);
    panel.appendChild(foot);
  }

  ctx.redraw = draw;   // seam every setter above calls after mutating `block`
  draw();
  return panel;
}
