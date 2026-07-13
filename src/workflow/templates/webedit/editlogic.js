// Pure logic used by editor.js (kept as a tested standalone copy; editor.js
// inlines the same functions for the single-file serve model).
import { resolveIoPath } from "./formfields.js";

export function computeDropDepends(rows, level, draggedId) {
  if (level <= 0) return [];
  return rows[level - 1].filter(id => id !== draggedId);
}

// Ids of every phase that (transitively) depends on `id` — i.e. its descendants
// in the dependency DAG. Depending on any of these would create a cycle.
export function descendantIds(phases, id) {
  const dependents = {};
  for (const p of phases || []) {
    for (const dep of p.depends_on || []) {
      (dependents[dep] = dependents[dep] || []).push(p.id);
    }
  }
  const out = new Set();
  const stack = [...(dependents[id] || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of dependents[cur] || []) stack.push(c);
  }
  return out;
}

// Drop-target depends_on that can never create a cycle: previous-row phases
// minus any descendant of the dragged phase.
export function safeDropDepends(phases, rows, level, draggedId) {
  const desc = descendantIds(phases, draggedId);
  return computeDropDepends(rows, level, draggedId).filter(id => !desc.has(id));
}

// Previous-row phases that were dropped because they depend on the dragged
// phase (the links that "block" the move). Empty when the drop is unconstrained.
export function blockedDependents(phases, rows, level, draggedId) {
  const desc = descendantIds(phases, draggedId);
  return computeDropDepends(rows, level, draggedId).filter(id => desc.has(id));
}

// Assign a (possibly new) group name to a phase. A brand-new group is auto-defined
// in model.groups so the workflow stays coherent — validate_coherence rejects a
// phase whose group isn't declared. Empty/whitespace input is ignored (group is
// required, so we never blank it). Returns true if the assignment was applied.
export function applyPhaseGroup(model, phase, value) {
  const v = (value || "").trim();
  if (!v) return false;
  phase.group = v;
  model.groups = model.groups || {};
  if (!Object.prototype.hasOwnProperty.call(model.groups, v)) {
    model.groups[v] = { description: "" };
  }
  return true;
}

// Roll up the inputs/outputs declared at the invocation level of a phase, so the
// Files tab can show the SAME files the dataflow diagram does (most phases
// declare io per-invocation, not at phase level). Returns one entry per
// invocation that actually touches files.
export function aggregateInvocationIo(phase) {
  const out = [];
  for (const inv of (phase && phase.invocations) || []) {
    const inputs = inv.inputs || [];
    const outputs = inv.outputs || [];
    if (inputs.length || outputs.length) {
      out.push({ agent: inv.agent, inputs, outputs });
    }
  }
  return out;
}

// Pure DOM builder for the explanatory notice vignette (no innerHTML).
export function buildNotice(title, lines) {
  const box = document.createElement("div");
  box.className = "notice-box";
  const h = document.createElement("div");
  h.className = "notice-title";
  h.textContent = title;
  box.appendChild(h);
  for (const line of lines || []) {
    const p = document.createElement("div");
    p.className = "notice-line";
    p.textContent = line;
    box.appendChild(p);
  }
  return box;
}

export function renderEdges(svg, edges, pos) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const NS = "http://www.w3.org/2000/svg";
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    line.setAttribute("class", "dep-edge");
    svg.appendChild(line);
  }
}

// --- opportunistic field helpers (pure) -----------------------------------
// The authoritative resolution lives in Python (resolve_opportunistic); these
// helpers only read/write the raw model value and label the server-resolved view.

// Per-phase UI mode from the raw model value.
export function opportunisticMode(phase) {
  const o = phase ? phase.opportunistic : undefined;
  if (o === false) return "locked";
  if (o === undefined || o === null) return "inherit";
  return "enabled"; // true or object
}

// Per-phase guidance (when/examples) currently stored on the phase.
export function opportunisticGuidance(phase) {
  const o = phase ? phase.opportunistic : undefined;
  if (o && typeof o === "object") {
    return { when: o.when || "", examples: Array.isArray(o.examples) ? o.examples.slice() : [] };
  }
  return { when: "", examples: [] };
}

// Write the per-phase opportunistic value from (mode, when, examples).
// inherit -> delete key; locked -> false; enabled -> true (no guidance) or
// { when?, examples? } (object, only non-empty keys). Mutates `phase`.
export function setOpportunistic(phase, mode, when, examples) {
  if (mode === "inherit") { delete phase.opportunistic; return; }
  if (mode === "locked") { phase.opportunistic = false; return; }
  const w = (when || "").trim();
  const ex = (examples || []).map(s => String(s).trim()).filter(Boolean);
  const obj = {};
  if (w) obj.when = w;
  if (ex.length) obj.examples = ex;
  phase.opportunistic = Object.keys(obj).length ? obj : true;
}

// Global default state read from the model's top-level opportunistic.
export function globalOpportunisticState(model) {
  const o = model ? model.opportunistic : undefined;
  const enabled = o === true || (o && typeof o === "object" && o.enabled !== false);
  const when = (o && typeof o === "object" && o.when) || "";
  const examples = (o && typeof o === "object" && Array.isArray(o.examples)) ? o.examples.slice() : [];
  return { enabled: !!enabled, when, examples };
}

// Write the global default. enabled=false -> delete; enabled -> true (no
// guidance) or { enabled:true, when?, examples? }. Mutates `model`.
export function setGlobalOpportunistic(model, enabled, when, examples) {
  if (!enabled) { delete model.opportunistic; return; }
  const w = (when || "").trim();
  const ex = (examples || []).map(s => String(s).trim()).filter(Boolean);
  if (!w && !ex.length) { model.opportunistic = true; return; }
  const o = { enabled: true };
  if (w) o.when = w;
  if (ex.length) o.examples = ex;
  model.opportunistic = o;
}

// --- dataflow model (pure) -------------------------------------------------
// The interactive Dataflow canvas computes its files/edges/validation in the
// browser (mirrors bb-workflow's dataflow + resolve_io_path so vignettes update
// live without a round-trip). These helpers are the DOM-free core.

// role "work:inventory" → {ns:'work', name:'inventory'} · "x"+namespace → same · bare → ns ''.
export function parseRole(io) {
  const r = (io && io.role) || "";
  const ci = r.indexOf(":");
  if (ci >= 0) return { ns: r.slice(0, ci), name: r.slice(ci + 1) };
  return { ns: (io && io.namespace) || "", name: r };
}

// The artifact label an io_ref points at (role wins over path, like the generator).
export function ioLabel(io) { return (io && (io.role || io.path)) || ""; }

// Stable, distinct color per namespace (files keep their dashed-diamond shape so
// they never read as actions; the color only disambiguates namespaces).
const NS_PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c", "#22d3ee", "#c084fc"];
export function nsColor(ns, namespaces) {
  if (!ns) return "#64748b";
  const keys = Object.keys(namespaces || {});
  const i = keys.indexOf(ns);
  return NS_PALETTE[(i < 0 ? keys.length : i) % NS_PALETTE.length];
}

// Every artifact referenced by the model: standalone editor file blocks + every
// phase-level AND invocation-level input/output (awok declares io both ways).
// Returns descriptors with deduped producers/consumers, resolved path and flags.
export function dataflowFiles(model) {
  const namespaces = (model && model.namespaces) || {};
  const map = new Map();
  const ensure = (l, kind) => {
    if (!map.has(l)) map.set(l, { label: l, kind: kind || "md", producers: [], consumers: [], inputRefs: [], outputRefs: [], standalone: null });
    const m = map.get(l); if (kind) m.kind = kind; return m;
  };
  ((model && model.files) || []).forEach(f => { const m = ensure(f.label, f.kind); m.standalone = f; });
  for (const p of (model && model.phases) || []) {
    const sinks = [{ inputs: p.inputs, outputs: p.outputs }];
    for (const inv of p.invocations || []) sinks.push({ inputs: inv.inputs, outputs: inv.outputs });
    for (const s of sinks) {
      (s.outputs || []).forEach(io => { const l = ioLabel(io); if (l) { const m = ensure(l, io.kind); m.producers.push(p.id); m.outputRefs.push(io); } });
      (s.inputs || []).forEach(io => { const l = ioLabel(io); if (l) { const m = ensure(l, io.kind); m.consumers.push(p.id); m.inputRefs.push(io); } });
    }
  }
  return Array.from(map.values()).map(f => {
    const sa = f.standalone;
    const external = f.inputRefs.some(io => io.external) || (sa && !!sa.external) || f.producers.length === 0;
    const terminal = f.outputRefs.some(io => io.terminal) || (sa && !!sa.terminal);
    const optional = f.inputRefs.some(io => io.optional) || (sa && !!sa.optional);
    const pathOverride = (sa && sa.path) || (f.outputRefs[0] && f.outputRefs[0].path) || (f.inputRefs[0] && f.inputRefs[0].path) || undefined;
    const path = resolveIoPath({ role: pathOverride ? undefined : f.label, kind: f.kind, path: pathOverride }, namespaces);
    const { ns } = parseRole({ role: f.label });
    const nsBad = !pathOverride && !!ns && !(namespaces[ns]);
    return {
      label: f.label, kind: f.kind, ns,
      producers: [...new Set(f.producers)], consumers: [...new Set(f.consumers)],
      external, terminal, optional, path, nsBad, inputRefs: f.inputRefs, outputRefs: f.outputRefs,
    };
  });
}

// Client mirror of the dataflow validation: undeclared namespace = blocking error;
// produced-but-unconsumed / consumed-but-unproduced = warning (unless the ref is
// flagged optional/external/terminal). Returns { errors, warnings, items }.
export function validateModel(model) {
  const errors = [], warnings = [], items = [];
  const add = (level, type, key, msg) => { items.push({ level, type, key, msg }); (level === "error" ? errors : warnings).push(msg); };
  const ns = (model && model.namespaces) || {};
  for (const p of (model && model.phases) || []) {
    const sinks = [{ inputs: p.inputs, outputs: p.outputs }, ...(p.invocations || []).map(iv => ({ inputs: iv.inputs, outputs: iv.outputs }))];
    for (const s of sinks) {
      ["inputs", "outputs"].forEach(side => (s[side] || []).forEach(io => {
        if (io.path) return;
        const { ns: n } = parseRole(io);
        if (n && !ns[n]) {
          add("error", "action", p.id, p.id + ': namespace "' + n + ':" is not declared');
          add("error", "file", io.role || "", 'namespace "' + n + ':" is not declared');
        }
      }));
    }
  }
  for (const f of dataflowFiles(model)) {
    if (f.consumers.length && !f.producers.length) {
      const covered = f.inputRefs.length > 0 && f.inputRefs.every(io => io.optional || io.external);
      if (!covered) add("warning", "file", f.label, "Read but never produced — no action outputs this file.");
    }
    if (f.producers.length && !f.consumers.length) {
      const covered = f.outputRefs.length > 0 && f.outputRefs.every(io => io.terminal);
      if (!covered) add("warning", "file", f.label, "Written but never read — no action consumes this file.");
    }
  }
  return { errors, warnings, items };
}

// Browser mirror of bb-workflow's compute_levels: phase id → grid row = longest
// dependency path from a root. Used by the Dataflow canvas (the grid uses the
// server's /api/view levels, which this matches).
export function computeLevels(model) {
  const phases = (model && model.phases) || [];
  const deps = {}; phases.forEach(p => { deps[p.id] = (p.depends_on || []).filter(Boolean); });
  const memo = {};
  const level = (pid, seen) => {
    if (pid in memo) return memo[pid];
    const ds = (deps[pid] || []).filter(d => (d in deps) && !seen.has(d));
    const lvl = ds.length ? 1 + Math.max(...ds.map(d => level(d, new Set([...seen, pid])))) : 0;
    memo[pid] = lvl; return lvl;
  };
  const out = {}; phases.forEach(p => { out[p.id] = level(p.id, new Set()); }); return out;
}

// Classify a dependency edge by the level gap it spans (drives the overlay style):
// 'same' (intra-level), 'direct' (adjacent), 'far' (skips ≥1 level).
export function classifyLinkSpan(fromLevel, toLevel) {
  const span = Math.abs((toLevel || 0) - (fromLevel || 0));
  return span === 0 ? "same" : span > 1 ? "far" : "direct";
}

// Human label for the resolved preview, read from the /api/view block.
export function resolvedOppLabel(viewOpp, id) {
  const e = viewOpp && viewOpp.phases && viewOpp.phases[id];
  if (!e) return "";
  if (e.note_kind === "short") return "🧭 Targeted lead (global on)";
  if (e.note_kind === "full") return "🧭 Full grant (global off)";
  if (e.note_kind === "locked") return "⛔ Locked";
  if (e.mark == null && e.enabled) return "Inherited from global (no marker)";
  return "Off";
}

// ---- orchestration (block tree) pure helpers -----------------------------
const _SLOTS = ["then", "else", "body"];
export function blockConstruct(b) {
  for (const k of ["ref", "if", "while", "until", "for_each", "parallel"]) if (k in b) return k;
  return "ref";
}
export function isLoopBlock(b) { return "while" in b || "until" in b || "for_each" in b; }
export function iterBlocks(blocks, fn) {
  (blocks || []).forEach((b, i) => { fn(b, blocks, i); _SLOTS.forEach(s => { if (Array.isArray(b[s])) iterBlocks(b[s], fn); }); });
}
export function findBlock(blocks, id) {
  let found = null; iterBlocks(blocks, (b, parent, i) => { if (b._id === id) found = { block: b, parent, index: i }; }); return found;
}
export function containerArray(blocks, containerId, slot) {
  if (containerId === "root") return blocks;
  const f = findBlock(blocks, containerId); if (!f) return null;
  if (!Array.isArray(f.block[slot])) f.block[slot] = []; return f.block[slot];
}
// Ancestor chain of `targetId` as [{construct, slot}, ...] — one entry per
// enclosing gate on the path from the root down to (but not including) the
// target block, each naming the gate's construct and which slot the path
// continues through (then/else/body). [] if the target is top-level (no
// enclosing gate) or not found — findBlock/iterBlocks don't track ancestors,
// so this is a dedicated recursive walk (Task 14 breadcrumb).
export function ancestorChain(blocks, targetId) {
  function walk(arr, path) {
    for (const b of arr || []) {
      if (b._id === targetId) return path;
      for (const slot of _SLOTS) {
        if (Array.isArray(b[slot])) {
          const found = walk(b[slot], path.concat([{ construct: blockConstruct(b), slot }]));
          if (found) return found;
        }
      }
    }
    return null;
  }
  return walk(blocks, []) || [];
}
export function signalsOf(model) {
  const out = [];
  for (const p of (model && model.phases) || [])
    for (const e of p.emits || []) out.push({ key: p.id.toLowerCase() + "." + e.name, name: e.name, type: e.type, phase: p.id });
  return out;
}
export function condOf(b) { const k = blockConstruct(b); return (k === "if" || k === "while" || k === "until") ? b[k] : null; }
export function orchestrationIssues(model) {
  const out = []; const sigKeys = new Set(signalsOf(model).map(s => s.key));
  const sigType = k => (signalsOf(model).find(s => s.key === k) || {}).type;
  // map each ref'd phase -> its top-level block id, to detect cross-block deps
  const topOf = {}; (model.orchestration || []).forEach(tb => iterBlocks([tb], b => { if (blockConstruct(b) === "ref" && !(b.ref in topOf)) topOf[b.ref] = tb._id; }));
  iterBlocks(model.orchestration || [], (b) => {
    if (isLoopBlock(b) && !(Number.isInteger(b.cap) && b.cap > 0)) out.push({ id: b._id, kind: blockConstruct(b), msg: "cap required (integer > 0)" });
    if ("for_each" in b && !b.for_each) out.push({ id: b._id, kind: "for_each", msg: "list signal required" });
    if ("for_each" in b && b.for_each && sigType(b.for_each) !== "list") out.push({ id: b._id, kind: "for_each", msg: "signal is not a list" });
    const c = condOf(b);
    if (c && typeof c === "object") {
      if (!c.left) out.push({ id: b._id, kind: blockConstruct(b), msg: "condition incomplete (left operand)" });
      else if (c.op !== "exists" && (c.right === undefined || c.right === "")) out.push({ id: b._id, kind: blockConstruct(b), msg: "condition incomplete (right operand)" });
      if (typeof c.left === "string" && c.left.includes(".") && !sigKeys.has(c.left)) out.push({ id: b._id, kind: blockConstruct(b), msg: "unknown signal " + c.left });
    }
  });
  // cross-block action->action dependency
  for (const p of (model && model.phases) || [])
    for (const d of p.depends_on || [])
      if (topOf[p.id] && topOf[d] && topOf[p.id] !== topOf[d]) out.push({ id: topOf[p.id], kind: "dep", msg: p.id + " depends on " + d + " across a gate boundary (expressed action→block)" });
  return out;
}
