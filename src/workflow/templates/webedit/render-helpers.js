// Pure DOM builders — no innerHTML of user data, no inline handlers.
export function makeCard(phase) {
  const el = document.createElement("div");
  el.className = "phase-card";
  el.draggable = true;
  el.dataset.id = phase.id;
  const pid = document.createElement("div");
  pid.className = "pid";
  pid.textContent = phase.id + " ";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = phase.type || "agent";
  pid.appendChild(badge);
  const name = document.createElement("div");
  name.textContent = phase.name || "";
  el.appendChild(pid);
  el.appendChild(name);
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
