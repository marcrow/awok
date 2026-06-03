// Pure logic used by editor.js (kept as a tested standalone copy; editor.js
// inlines the same functions for the single-file serve model).
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
