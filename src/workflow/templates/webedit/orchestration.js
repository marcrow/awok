// awok orchestration layer — program (block-tree) view + gate editor.
// Rendered ONLY when state.showOrch is on; the classic grid is untouched otherwise.
//
// Translated from the proto (docs/superpowers/specs/2026-07-13-orchestration-refs/
// orchestration-prototype.dc.html) to vanilla DOM, using the ENGINE block shape
// (construct name is the key: {if:{cond},then,else} / {while:{cond},cap,body} /
// {for_each:"sig",as,cap,body} / {ref:"PHASE"}) — no {type:'if',cond} mapping.
import { makeCard } from "./render-helpers.js";
import { iterBlocks, isLoopBlock, blockConstruct, condOf, signalsOf, findBlock, containerArray, orchestrationIssues } from "./editlogic.js";
import { fieldText, fieldSelect } from "./formfields.js";

let CTX = null;   // set each render so drag/drop handlers can reach state + callbacks

// --- gate creation (＋ Gate toolbar button) ----------------------------------
// Counter starts at 1000 so freshly-created ids ("b1001", "b1002", ...) never
// collide with hydrateBlockIds' load-time stamping ("b1", "b2", ...).
let _seq = 1000;
const newId = () => "b" + (++_seq);

export function addGate(ctx, kind) {
  const m = ctx.state.model; m.orchestration = m.orchestration || [];
  // No `cap` key on creation — unset-and-OK is ABSENT, never `cap: null`
  // (the schema requires cap to be an integer >= 1 when present; null fails
  // validate_schema's blocking structural check, whereas an absent key only
  // trips validate_orchestration's warning-only "missing mandatory cap").
  const b = kind === "loop"
    ? { _id: newId(), while: { op: "==", left: "", right: "" }, body: [] }
    : { _id: newId(), if: { op: "==", left: "", right: "" }, then: [], else: [] };
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
  card.addEventListener("click", e => { e.stopPropagation(); CTX.selectPhase(p.id, b._id); });
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

  // Task 13: inline "condition incomplete" marker — additive, keyed off this
  // block's own _id (never the top-level dep-crossing issues), never touches
  // the cap chip below (that one is Task 7, untouched).
  const condWarn = orchestrationIssues(state.model).some(i => i.id === b._id &&
    ["if", "while", "until"].includes(i.kind) &&
    /condition incomplete|left operand|right operand|unknown signal/.test(i.msg));
  if (condWarn) {
    const warn = document.createElement("span"); warn.className = "gate-warn"; warn.textContent = "⚠ condition incomplete";
    head.appendChild(warn);
  }

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
    CTX.onDrop(CTX, containerId, slot, e);
  });
  return el;
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
  if (refId) {                                   // MOVE existing ref
    const f = findBlock(bs, refId); if (!f) return;
    const [moved] = f.parent.splice(f.index, 1); target.push(moved);
  } else if (phase) {                            // REFERENCE from palette/tray
    target.push({ _id: newId(), ref: phase });
  }
  ctx.refreshView().then(() => ctx.rerender());
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

// --- operand kind (transient, UI-only — NOT serialized; stripped in
// editor.js's modelForSave alongside `_id`) -----------------------------------
function operandKindKey(side) { return side === "left" ? "_leftKind" : "_rightKind"; }
function deriveOperandKind(value, sigKeys) {
  if (value && typeof value === "object" && !Array.isArray(value)) return "builtin";
  if (typeof value === "string" && sigKeys.has(value)) return "signal";
  return "literal";
}
// Derived once (on first render) from the operand's current value, then
// cached on the block so flipping through kinds in the UI doesn't re-derive
// from a value the user is actively editing away from.
function operandKind(block, side, sigKeys) {
  const key = operandKindKey(side);
  if (!block[key]) {
    const cond = block[blockConstruct(block)];
    const value = (cond && typeof cond === "object") ? cond[side] : undefined;
    block[key] = deriveOperandKind(value, sigKeys);
  }
  return block[key];
}

// Allowed emit `type`/`source` values — mirrors the `emits` item schema in
// workflow.schema.json (definitions.phase.properties.emits.items). Keep in
// sync if the schema enum ever changes.
const EMIT_TYPES = ["number", "string", "bool", "enum", "list"];
const EMIT_SOURCES = ["field", "token"];

// --- signal picker popover (grouped by emitting phase) + "declare a new
// signal" inline form. One popover instance at a time, closed on outside
// click / Escape — same idiom as openGateMenu above.
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

// Signal list grouped by phase — the picker's default view.
function renderSignalList(pop, ctx, block, side) {
  pop.replaceChildren();
  const cond = block[blockConstruct(block)];
  const sigs = signalsOf(ctx.state.model);
  const groups = {};
  sigs.forEach(s => { (groups[s.phase] = groups[s.phase] || []).push(s); });
  const phaseIds = Object.keys(groups);
  if (!phaseIds.length) {
    const empty = document.createElement("div"); empty.className = "sig-pop-empty";
    empty.textContent = "No signals declared yet.";
    pop.appendChild(empty);
  }
  phaseIds.forEach(phaseId => {
    const head = document.createElement("div"); head.className = "sig-pop-group"; head.textContent = phaseId;
    pop.appendChild(head);
    groups[phaseId].forEach(s => {
      const item = document.createElement("button"); item.type = "button"; item.className = "sig-pop-item";
      if (cond && cond[side] === s.key) item.classList.add("active");
      item.textContent = s.name + " · " + s.type;
      item.addEventListener("click", e => {
        e.stopPropagation();
        setOperand(block, side, s.key);
        closeSigPopover();
        applyGateEdit(ctx);
      });
      pop.appendChild(item);
    });
  });
  const sep = document.createElement("div"); sep.className = "sig-pop-sep"; pop.appendChild(sep);
  const declareBtn = document.createElement("button"); declareBtn.type = "button";
  declareBtn.className = "sig-pop-declare"; declareBtn.textContent = "＋ Declare a new signal";
  declareBtn.addEventListener("click", e => { e.stopPropagation(); renderDeclareForm(pop, ctx, block, side); });
  pop.appendChild(declareBtn);
}

// "Declare a new signal" inline form (phase / name / type / source / from).
function renderDeclareForm(pop, ctx, block, side) {
  pop.replaceChildren();
  const phaseIds = ((ctx.state.model.phases) || []).map(p => p.id);
  const form = { phaseId: phaseIds[0] || "", name: "", type: EMIT_TYPES[0], source: EMIT_SOURCES[0], from: "" };

  const title = document.createElement("div"); title.className = "sig-pop-group"; title.textContent = "Declare a new signal";
  pop.appendChild(title);

  pop.appendChild(fieldSelect("phase", form.phaseId, phaseIds, v => { form.phaseId = v; }));
  pop.appendChild(fieldText("name", form.name, v => { form.name = v.trim(); }));
  pop.appendChild(fieldSelect("type", form.type, EMIT_TYPES, v => { form.type = v; }));
  pop.appendChild(fieldSelect("source", form.source, EMIT_SOURCES, v => { form.source = v; fromRow.style.display = v === "field" ? "" : "none"; }));
  const fromRow = fieldText("from", form.from, v => { form.from = v.trim(); });
  fromRow.style.display = form.source === "field" ? "" : "none";
  pop.appendChild(fromRow);

  const actions = document.createElement("div"); actions.className = "sig-pop-actions";
  const back = document.createElement("button"); back.type = "button"; back.className = "sig-pop-back";
  back.textContent = "‹ back";
  back.addEventListener("click", e => { e.stopPropagation(); renderSignalList(pop, ctx, block, side); });
  actions.appendChild(back);
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "sig-pop-submit";
  submit.textContent = "Declare";
  submit.addEventListener("click", e => { e.stopPropagation(); submitDeclare(ctx, block, side, form); });
  actions.appendChild(submit);
  pop.appendChild(actions);
}

// Validates the name, pushes a schema-shaped emits entry onto the target
// phase, wires the operand to the new signal's key, then refreshes the
// server-side view and rebuilds the whole gate panel (ctx.reselectGate) so
// the freshly-declared signal shows up selected in the picker.
function submitDeclare(ctx, block, side, form) {
  if (!/^[a-z][a-z0-9_]*$/.test(form.name)) { ctx.setStatus("signal name must match ^[a-z][a-z0-9_]*$"); return; }
  const ph = (ctx.state.model.phases || []).find(p => p.id === form.phaseId);
  if (!ph) { ctx.setStatus("pick a phase to declare the signal on"); return; }
  ph.emits = ph.emits || [];
  ph.emits.push({
    name: form.name, type: form.type, source: form.source,
    ...(form.source === "field" ? { from: form.from || "output.json" } : {}),
  });
  const key = form.phaseId.toLowerCase() + "." + form.name;
  setOperand(block, side, key);       // wire it straight into the condition
  closeSigPopover();
  ctx.refreshView().then(ctx.reselectGate);
}

function openSignalPicker(ctx, block, side, buttonEl) {
  closeSigPopover();
  const pop = document.createElement("div"); pop.className = "sig-popover";
  renderSignalList(pop, ctx, block, side);
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
// emitting phase, plus a "＋ Declare a new signal" affordance. Replaces the
// Task 10 INTERIM flat <select> — signature/seam unchanged (called at the
// `kind === "signal"` branch of operandCtrl below).
function signalOperandControl(ctx, block, side, cond) {
  const wrap = document.createElement("div"); wrap.className = "sig-picker";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "sig-picker-btn";
  const cur = cond ? cond[side] : "";
  btn.textContent = cur ? "◈ " + cur : "◈ pick a signal…";
  btn.addEventListener("click", e => { e.stopPropagation(); openSignalPicker(ctx, block, side, btn); });
  wrap.appendChild(btn);
  return wrap;
}

function builtinOperandControl(ctx, block, side, cond) {
  const wrap = document.createElement("div"); wrap.className = "op-builtin-row";
  const cur = (cond && cond[side] && typeof cond[side] === "object") ? cond[side] : {};
  const entry = Object.entries(cur)[0] || [BUILTINS[0], ""];
  const sel = document.createElement("select");
  BUILTINS.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; if (n === entry[0]) o.selected = true; sel.appendChild(o); });
  const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "path"; inp.value = entry[1] || "";
  const commit = () => { setOperand(block, side, { [sel.value]: inp.value }); applyGateEdit(ctx); };
  sel.addEventListener("change", commit);
  inp.addEventListener("change", commit);
  wrap.appendChild(sel); wrap.appendChild(inp);
  return wrap;
}

function literalOperandControl(ctx, block, side, cond) {
  const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "literal value";
  const v = cond ? cond[side] : undefined;
  inp.value = (typeof v === "string") ? v : (v == null ? "" : String(v));
  inp.addEventListener("change", () => { setOperand(block, side, inp.value); applyGateEdit(ctx); });
  return inp;
}

// One operand (left/right) of a structured condition: a kind segmented
// control (◈ signal / literal / builtin — the right side has no builtin
// option, per the brief) + the operand's own control, tinted by kind via the
// wrapping .op-box.<kind> (CSS in editor.css).
function operandCtrl(ctx, block, side) {
  const cond = block[blockConstruct(block)];
  const sigKeys = new Set(signalsOf(ctx.state.model).map(s => s.key));
  const kind = operandKind(block, side, sigKeys);
  const box = document.createElement("div"); box.className = "op-box " + kind;

  const label = document.createElement("div"); label.className = "op-box-label"; label.textContent = side + " operand";
  box.appendChild(label);

  const kinds = side === "left" ? ["signal", "literal", "builtin"] : ["signal", "literal"];
  const seg = document.createElement("div"); seg.className = "op-kind-seg";
  kinds.forEach(k => {
    const btn = document.createElement("button"); btn.type = "button";
    btn.className = "op-kind-btn" + (k === kind ? " active" : "");
    btn.textContent = k === "signal" ? "◈ signal" : k;
    btn.addEventListener("click", () => {
      if (k === kind) return;
      block[operandKindKey(side)] = k;
      setOperand(block, side, k === "builtin" ? { [BUILTINS[0]]: "" } : "");
      applyGateEdit(ctx);
    });
    seg.appendChild(btn);
  });
  box.appendChild(seg);

  if (kind === "signal") box.appendChild(signalOperandControl(ctx, block, side, cond));
  else if (kind === "builtin") box.appendChild(builtinOperandControl(ctx, block, side, cond));
  else box.appendChild(literalOperandControl(ctx, block, side, cond));
  return box;
}

// --- the panel itself --------------------------------------------------------
// ctx = { state, refreshView, rerender, close } (see editor.js selectGate).
// gatePanel adds a `redraw` seam onto ctx so every setter above can rebuild
// the panel's own content after a structural edit, without editor.js needing
// to know anything about the gate's internals.
export function gatePanel(ctx, block) {
  const panel = document.createElement("div");
  panel.style.cssText = "display:flex;flex-direction:column;min-height:0;flex:1 1 auto;height:100%";

  function draw() {
    panel.replaceChildren();
    const kind = blockConstruct(block);
    const loop = isLoopBlock(block);

    // header
    const head = document.createElement("div"); head.className = "drawer-head";
    const top = document.createElement("div"); top.className = "top";
    const icon = document.createElement("span");
    icon.className = loop ? "gate-icon-loop" : "gate-icon-if";
    if (loop) icon.textContent = "↻";
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
        body.appendChild(operandCtrl(ctx, block, "left"));
        const opRow = document.createElement("div"); opRow.style.cssText = "display:flex;align-items:center;gap:8px;margin:2px 0 8px";
        const opLbl = document.createElement("span");
        opLbl.style.cssText = "font:9px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--dim);font-weight:700";
        opLbl.textContent = "op";
        opRow.appendChild(opLbl);
        const opSel = document.createElement("select"); opSel.style.width = "auto";
        OPS.forEach(op => { const o = document.createElement("option"); o.value = op; o.textContent = op; if (op === cond.op) o.selected = true; opSel.appendChild(o); });
        opSel.addEventListener("change", () => { setOp(block, opSel.value); applyGateEdit(ctx); });
        opRow.appendChild(opSel);
        body.appendChild(opRow);
        if (cond.op !== "exists") body.appendChild(operandCtrl(ctx, block, "right"));
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
