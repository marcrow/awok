// Pure DOM builders — no innerHTML of user data, no inline handlers.
// The grid card (navy redesign): header (id · resolved-opp badge · type badge ·
// interactive marker · group label), name, 2-line description, dep/in/out chips.
// `color` = group color (left accent + group label); `oppMark` = the SERVER-
// resolved opportunistic marker ("opportunistic" | "locked" | null).
export function makeCard(phase, color, oppMark) {
  const el = document.createElement("div");
  el.className = "phase-card";
  el.draggable = true;
  el.dataset.id = phase.id;
  if (color) {
    el.dataset.group = phase.group || "";
    el.style.borderLeftColor = color;
  }

  const head = document.createElement("div");
  head.className = "card-head";
  const pid = document.createElement("div");
  pid.className = "pid";
  pid.appendChild(document.createTextNode(phase.id));
  if (oppMark === "opportunistic" || oppMark === "locked") {
    const ob = document.createElement("span");
    ob.className = "opp-badge " + (oppMark === "locked" ? "opp-locked" : "opp-on");
    ob.textContent = oppMark === "locked" ? "⛔" : "🧭";
    ob.title = oppMark === "locked" ? "opportunism locked" : "opportunistic autonomy";
    pid.appendChild(ob);
  }
  head.appendChild(pid);
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.type = phase.type || "agent";
  badge.textContent = phase.type || "agent";
  head.appendChild(badge);
  if (phase.interactive) {
    const m = document.createElement("span");
    m.className = "marker interactive";
    m.textContent = "interactive";
    head.appendChild(m);
  }
  if (color || phase.group) {
    const g = document.createElement("span");
    g.className = "group-label";
    g.textContent = phase.group || "";
    if (color) g.style.color = color;
    head.appendChild(g);
  }
  el.appendChild(head);

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = phase.name || "";
  el.appendChild(name);

  if (phase.description) {
    const d = document.createElement("div");
    d.className = "card-desc";
    d.textContent = phase.description;
    el.appendChild(d);
  }

  const chips = document.createElement("div");
  chips.className = "card-chips";
  const addChip = (cls, text) => {
    const c = document.createElement("span");
    c.className = "chip " + cls;
    c.textContent = text;
    chips.appendChild(c);
  };
  for (const d of phase.depends_on || []) addChip("dep", "↑ " + d);
  // Show io declared at phase level AND aggregated from invocations (awok does both).
  const ioLabels = (sideKey) => {
    const out = [];
    const push = (io) => { const l = (io && (io.role || io.path)) || ""; if (l) out.push(l); };
    (phase[sideKey] || []).forEach(push);
    (phase.invocations || []).forEach(inv => (inv[sideKey] || []).forEach(push));
    return out;
  };
  for (const l of ioLabels("inputs")) addChip("in", "in · " + l);
  for (const l of ioLabels("outputs")) addChip("out", "out · " + l);
  for (const e of phase.emits || []) addChip("emits", "emits ◈ " + e.name + " · " + e.type);
  if (chips.children.length) el.appendChild(chips);

  return el;
}

// A collapsible section: <details><summary>title</summary>…</details>.
// Append fields to the returned element's `.body`. `open` controls default state.
export function section(title, open = true) {
  const d = document.createElement("details");
  d.className = "section";
  if (open) d.setAttribute("open", "");
  const s = document.createElement("summary");
  s.textContent = title;
  d.appendChild(s);
  const body = document.createElement("div");
  body.className = "section-body";
  d.appendChild(body);
  d.body = body;
  return d;
}

// A muted help line (inert text). Use under complex fields.
export function helpNote(text) {
  const n = document.createElement("div");
  n.className = "help-note";
  n.textContent = text;
  return n;
}

// A small "?" badge that reveals `text` on hover (CSS-driven popover).
export function helpIcon(text) {
  const s = document.createElement("span");
  s.className = "help-icon";
  // No native `title` — it would double up with the CSS popover on hover.
  s.appendChild(document.createTextNode("?"));
  const pop = document.createElement("span");
  pop.className = "help-pop";
  pop.textContent = text;
  s.appendChild(pop);
  return s;
}

// A label row with an inline help icon: "<label> (?)".
export function labelWithHelp(text, help) {
  const l = document.createElement("label");
  l.textContent = text + " ";
  l.appendChild(helpIcon(help));
  return l;
}
