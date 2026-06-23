// Settings page (navy redesign): the prototype's Skill + global Opportunistic
// cards, PLUS every other awok global the prototype omits (namespaces, groups,
// conditions, on_demand_agents, brainstormings, manual_sections) so nothing the
// editor can configure is lost. Groups/namespaces are also reachable from the
// grid legend / dataflow toolbar — single source of truth, several entry points.
import { helpIcon } from "./render-helpers.js";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

// Append a hover "?" help icon to a field's label.
function withHelp(fieldNode, text) { const l = fieldNode.querySelector("label"); if (l) l.appendChild(helpIcon(text)); return fieldNode; }

// A field whose control is an auto-growing textarea: wraps, grows with content
// up to a max height (then scrolls). Used for description / when / protocol so
// long text stays readable instead of being squeezed into a one-line input.
function fieldArea(label, value, onChange, help) {
  const r = document.createElement("div"); r.className = "field";
  const l = document.createElement("label"); l.textContent = label; if (help) l.appendChild(helpIcon(help)); r.appendChild(l);
  const ta = document.createElement("textarea"); ta.className = "auto-area"; ta.rows = 1; ta.value = value == null ? "" : value;
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; };
  ta.addEventListener("input", grow);
  ta.addEventListener("change", () => onChange(ta.value));
  r.appendChild(ta);
  requestAnimationFrame(grow);   // scrollHeight needs the node laid out
  return r;
}

function card(title, sub, req, help) {
  const c = document.createElement("section"); c.className = "settings-card";
  const head = document.createElement("div"); head.className = "head";
  const t = document.createElement("span"); t.className = "t"; t.textContent = title; head.appendChild(t);
  if (sub) { const s = document.createElement("span"); s.className = "s"; s.textContent = sub; head.appendChild(s); }
  if (help) head.appendChild(helpIcon(help));
  if (req) { const r = document.createElement("span"); r.className = "req"; r.textContent = req; head.appendChild(r); }
  const body = document.createElement("div"); body.className = "body";
  c.appendChild(head); c.appendChild(body); c.body = body;
  return c;
}
// A roomy entry block (grid of full-size fields + a remove button) for the
// list-of-objects settings (on-demand agents, brainstormings, manual sections)
// — replaces the cramped single-row layout.
function block() { const b = document.createElement("div"); b.className = "settings-block"; return b; }
function span2(node) { node.classList.add("span2"); return node; }
function removeBtn(onClick) { const d = document.createElement("button"); d.className = "block-del"; d.textContent = "✕ remove"; d.addEventListener("click", onClick); return d; }

export function renderSettings(root, ctx) {
  if (!root || !ctx.getModel()) return;
  root.replaceChildren();
  const m = ctx.getModel(); m.skill = m.skill || {};
  const H = ctx.helpers;
  const rerender = () => renderSettings(root, ctx);

  // ---- Skill identity ----
  const skill = card("Skill", "identity of the generated skill", "required",
    "Defines what the generated skill is called and how Claude Code discovers it. The name drives every generated artifact path; the description is read by Claude Code to decide when to invoke /<name>.");
  const nameWrap = document.createElement("div");
  const nameLabel = document.createElement("div"); nameLabel.style.cssText = "display:flex;align-items:baseline;gap:8px;margin-bottom:6px";
  const nl = document.createElement("label"); nl.style.cssText = "font-size:12px;font-weight:600;color:var(--text)"; nl.textContent = "Name";
  const nh = document.createElement("span"); nh.style.cssText = "font:10.5px/1 var(--mono);color:var(--dim)"; nh.textContent = "slug · kebab-case · unique";
  nameLabel.appendChild(nl); nameLabel.appendChild(nh); nameWrap.appendChild(nameLabel);
  const nameIn = document.createElement("input"); nameIn.type = "text"; nameIn.value = m.skill.name || ""; nameIn.placeholder = "onboard"; nameIn.spellcheck = false;
  nameIn.style.cssText = "width:100%;background:var(--well);border:1px solid var(--border);border-radius:7px;color:#7dd3fc;padding:9px 11px;font:13.5px/1 var(--mono);font-weight:600;outline:none";
  const others = (ctx.getWorkflows() || []).filter(w => w !== ctx.currentName());
  const nameBad = !SLUG_RE.test(m.skill.name || "") || others.includes(m.skill.name);
  if (nameBad) nameIn.style.borderColor = "var(--bad)";
  nameIn.addEventListener("change", () => { m.skill.name = nameIn.value; rerender(); });
  nameWrap.appendChild(nameIn);
  if (nameBad) {
    const err = document.createElement("div"); err.className = "field-err";
    err.textContent = !((m.skill.name || "").length) ? "Name is required."
      : (!SLUG_RE.test(m.skill.name) ? "Use kebab-case: a lowercase letter first, then lowercase letters, digits or hyphens."
        : "Already used by another workflow — the name must be unique.");
    nameWrap.appendChild(err);
  }
  const nm = m.skill.name || "<name>";
  const derived = document.createElement("div"); derived.className = "derived"; derived.style.marginTop = "12px";
  const dh = document.createElement("div"); dh.className = "h"; dh.textContent = "Derived from name · read-only"; derived.appendChild(dh);
  [["Invocation", "/" + nm], ["Skill file", "src/skills/" + nm + "/SKILL.md"],
   ["Cartography", "docs/architecture-cartography/" + nm + ".html"], ["Frontmatter", "name: " + nm]].forEach(([k, v]) => {
    const r = document.createElement("div"); r.className = "drow";
    const ke = document.createElement("span"); ke.className = "k"; ke.textContent = k;
    const ve = document.createElement("span"); ve.className = "v"; ve.textContent = v;
    r.appendChild(ke); r.appendChild(ve); derived.appendChild(r);
  });
  nameWrap.appendChild(derived);
  if (SLUG_RE.test(m.skill.name || "") && m.skill.name !== ctx.currentName()) {
    const w = document.createElement("div"); w.className = "warn-box"; w.style.marginTop = "10px";
    w.textContent = "⚠ Artifacts are named after skill.name, not the file. The file is " + ctx.currentName() + ".yaml but the name is " + m.skill.name + " — rename the file to " + m.skill.name + ".yaml, or changing the name later orphans the generated artifacts.";
    nameWrap.appendChild(w);
  }
  skill.body.appendChild(nameWrap);
  skill.body.appendChild(H.fieldTextarea("Description", m.skill.description || "", v => { m.skill.description = v; ctx.refreshView(); }));
  const titleR = H.fieldText("Title", m.skill.title || "", v => { if (v) m.skill.title = v; else delete m.skill.title; });
  titleR.querySelector("input").placeholder = "/" + nm + " — " + nm;
  skill.body.appendChild(titleR);
  root.appendChild(skill);

  // ---- Opportunistic (global default) ----
  const opp = card("Opportunistic autonomy", "workflow default", "optional",
    "The workflow-wide default for letting the main agent improvise beyond the planned DAG (e.g. spin up an ad-hoc sub-agent when it spots an opening). Each action can override this in its Autonomy tab.");
  const gs = H.globalOpportunisticState(m);
  const intro = document.createElement("p"); intro.style.cssText = "margin:0;font-size:12.5px;line-height:1.6;color:var(--muted)";
  intro.textContent = "Gives the workflow latitude to launch extra actions beyond the planned DAG when it spots an opening — including spinning up a sub-agent that doesn't exist yet. This sets the workflow-wide default; each action can still override it.";
  opp.body.appendChild(intro);
  opp.body.appendChild(toggle("Enabled by default", "Every action may act ad-hoc unless it opts out", gs.enabled, false,
    () => { H.setGlobalOpportunistic(m, !gs.enabled, gs.when, gs.examples); rerender(); ctx.refreshView(); }));
  if (gs.enabled) {
    opp.body.appendChild(H.fieldTextarea("When (optional · inherited by actions that leave it blank)", gs.when, v => { H.setGlobalOpportunistic(m, true, v, gs.examples); ctx.refreshView(); }));
    opp.body.appendChild(H.stringListEditor("Examples (optional)", gs.examples, arr => { H.setGlobalOpportunistic(m, true, gs.when, arr); ctx.refreshView(); }));
  }
  if (!gs.enabled && !(m.phases || []).some(p => p.opportunistic)) {
    const w = document.createElement("div"); w.className = "warn-box";
    w.textContent = "⚠ Dead config — the default is off and no action turns it on. This setting has no effect unless an action enables opportunistic autonomy.";
    opp.body.appendChild(w);
  }
  const yhead = document.createElement("div"); yhead.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:7px";
  yhead.textContent = "Serialized to " + (ctx.currentName() || "") + ".yaml";
  const pre = document.createElement("pre"); pre.className = "yaml-pre"; pre.textContent = oppYaml(gs);
  opp.body.appendChild(yhead); opp.body.appendChild(pre);
  root.appendChild(opp);

  // ---- Namespaces ----
  const ns = card("Namespaces", "role prefix → base folder", null,
    "A role like `work:inventory` (+ a kind) resolves to a concrete path `<base>/inventory.md` via these prefix→folder mappings. Keeps the workflow path-independent. Also reachable from the Dataflow toolbar.");
  m.namespaces = m.namespaces || {};
  ns.body.appendChild(H.helpNote("Maps a role prefix to a base path: role `ns:name` (+ kind) resolves to `<base>/name<ext>`. Used by the Files editor and the dataflow."));
  Object.keys(m.namespaces).forEach(k => {
    const row = document.createElement("div"); row.className = "settings-row";
    const key = document.createElement("input"); key.value = k; key.placeholder = "prefix";
    key.addEventListener("change", () => { const v = key.value.trim(); if (v && v !== k) { renameNs(m, k, v); rerender(); ctx.refreshView(); } });
    row.appendChild(key);
    row.appendChild(H.fieldText("base path", m.namespaces[k] || "", v => { m.namespaces[k] = v; ctx.refreshView(); }));
    const del = document.createElement("button"); del.textContent = "✕"; del.addEventListener("click", () => { delete m.namespaces[k]; rerender(); ctx.refreshView(); }); row.appendChild(del);
    ns.body.appendChild(row);
  });
  const addNs = addBtn("+ namespace", () => { let n = "ns", i = 1; while (m.namespaces[n]) n = "ns" + (++i); m.namespaces[n] = "work/" + n; rerender(); ctx.refreshView(); });
  ns.body.appendChild(addNs);
  root.appendChild(ns);

  // ---- Groups ----
  const groups = card("Groups", "semantic bands · also editable in the grid legend", null,
    "Coloured semantic categories an action belongs to (e.g. scan / explore / synthesize). Drives the grid colours and the risk badge. Renaming a group here updates every action that references it.");
  m.groups = m.groups || {};
  Object.keys(m.groups).forEach(g => {
    const b = block();
    b.appendChild(withHelp(H.fieldText("name (key)", g, () => {}), "The group key — renaming it updates every action that references it."));
    b.querySelector("input").addEventListener("change", e => { const v = e.target.value.trim(); if (v && v !== g) { m.groups[v] = m.groups[g]; delete m.groups[g]; (m.phases || []).forEach(p => { if (p.group === g) p.group = v; }); rerender(); ctx.refreshView(); } });
    b.appendChild(H.fieldSelect("risk", m.groups[g].risk || "none", ["none", "low", "medium", "high"], v => { m.groups[g].risk = v; ctx.refreshView(); }));
    b.appendChild(span2(fieldArea("description", m.groups[g].description || "", v => { m.groups[g].description = v; ctx.refreshView(); })));
    b.appendChild(removeBtn(() => { delete m.groups[g]; rerender(); ctx.refreshView(); }));
    groups.body.appendChild(b);
  });
  groups.body.appendChild(addBtn("+ group", () => { let n = "group", i = 1; while (m.groups[n]) n = "group" + (++i); m.groups[n] = { description: "", risk: "none" }; rerender(); ctx.refreshView(); }));
  root.appendChild(groups);

  // ---- Conditions ----
  const cond = card("Conditions", "named guards for skip_if", null,
    "Named file/dir checks (e.g. file_exists at a path). An invocation can reference one via skip_if to be skipped when the condition holds — useful for resumable / incremental runs.");
  m.conditions = m.conditions || {};
  Object.keys(m.conditions).forEach(c => {
    const row = document.createElement("div"); row.className = "settings-row";
    const key = document.createElement("input"); key.value = c;
    key.addEventListener("change", () => { const v = key.value.trim(); if (v && v !== c) { m.conditions[v] = m.conditions[c]; delete m.conditions[c]; rerender(); } });
    row.appendChild(key);
    row.appendChild(H.fieldSelect("check", m.conditions[c].check || "file_exists", ["file_missing", "file_exists", "dir_missing", "dir_exists"], v => { m.conditions[c].check = v; }));
    row.appendChild(H.fieldText("path", m.conditions[c].path || "", v => { if (v) m.conditions[c].path = v; else delete m.conditions[c].path; }));
    const del = document.createElement("button"); del.textContent = "✕"; del.addEventListener("click", () => { delete m.conditions[c]; rerender(); }); row.appendChild(del);
    cond.body.appendChild(row);
  });
  cond.body.appendChild(addBtn("+ condition", () => { let n = "cond", i = 1; while (m.conditions[n]) n = "cond" + (++i); m.conditions[n] = { check: "file_exists" }; rerender(); }));
  root.appendChild(cond);

  // ---- On-demand agents ----
  const od = card("On-demand agents", "out-of-DAG agents triggered by a signal", null,
    "Agents that aren't part of the planned DAG but can be launched when a signal fires (a hook, a skill, a condition). Distinct from opportunistic autonomy: these are pre-written agents with an explicit trigger, not authored on the fly.");
  m.on_demand_agents = m.on_demand_agents || [];
  m.on_demand_agents.forEach((o, idx) => {
    const b = block();
    b.appendChild(withHelp(H.fieldSelect("agent", o.agent || "", ["", ...(ctx.getAgents() || [])], v => { o.agent = v; }), "Which agent (from src/agents/) to launch."));
    b.appendChild(H.fieldSelect("model", o.model || "inherit", ["inherit", "haiku", "sonnet", "opus"], v => { o.model = v; }));
    b.appendChild(span2(fieldArea("description", o.description || "", v => { o.description = v; })));
    b.appendChild(span2(fieldArea("when (signal that triggers it)", o.when || "", v => { if (v) o.when = v; else delete o.when; }, "Plain-language trigger condition — e.g. 'an old/abandoned dependency is spotted'.")));
    b.appendChild(removeBtn(() => { m.on_demand_agents.splice(idx, 1); rerender(); }));
    od.body.appendChild(b);
  });
  od.body.appendChild(addBtn("+ on-demand agent", () => { m.on_demand_agents.push({ agent: (ctx.getAgents() || [])[0] || "", description: "" }); rerender(); }));
  root.appendChild(od);

  // ---- Brainstormings ----
  const bs = card("Brainstormings", "timeboxed design protocols anchored to a phase", null,
    "A timeboxed brainstorming/design ritual injected into the SKILL around a given phase. Used by meta-workflows (e.g. create-workflow) to pause and diverge before committing.");
  m.brainstormings = m.brainstormings || [];
  m.brainstormings.forEach((bm, idx) => {
    const b = block();
    b.appendChild(withHelp(H.fieldText("id", bm.id || "", v => { bm.id = v; }), "Unique identifier for this brainstorming block."));
    b.appendChild(withHelp(H.fieldText("after_phase", bm.after_phase || "", v => { if (v) bm.after_phase = v; else delete bm.after_phase; }), "Phase id this ritual runs after (or use before_phase)."));
    b.appendChild(span2(fieldArea("protocol", bm.protocol || "", v => { if (v) bm.protocol = v; else delete bm.protocol; }, "The brainstorming technique/protocol to follow.")));
    b.appendChild(removeBtn(() => { m.brainstormings.splice(idx, 1); rerender(); }));
    bs.body.appendChild(b);
  });
  bs.body.appendChild(addBtn("+ brainstorming", () => { m.brainstormings.push({ id: "bs-" + (m.brainstormings.length + 1) }); rerender(); }));
  root.appendChild(bs);

  // ---- Manual sections ----
  const ms = card("Manual sections", "hand-written SKILL.md sections", null,
    "Hand-written Markdown spliced into the generated SKILL.md at a chosen anchor — for prose the generator can't derive from the DAG. The file lives under src/workflow/manual/.");
  m.manual_sections = m.manual_sections || [];
  m.manual_sections.forEach((s, idx) => {
    const b = block();
    b.appendChild(withHelp(H.fieldText("name", s.name || "", v => { s.name = v; }), "Section name (also the manual file stem)."));
    b.appendChild(withHelp(H.fieldText("insert_at", s.insert_at || "", v => { if (v) s.insert_at = v; else delete s.insert_at; }), "Anchor in the SKILL where the section is spliced."));
    b.appendChild(span2(withHelp(H.fieldText("path", s.path || "", v => { s.path = v; }), "Path to the Markdown file (src/workflow/manual/…).")));
    b.appendChild(removeBtn(() => { m.manual_sections.splice(idx, 1); rerender(); }));
    ms.body.appendChild(b);
  });
  ms.body.appendChild(addBtn("+ manual section", () => { m.manual_sections.push({ name: "", path: "" }); rerender(); }));
  root.appendChild(ms);
}

function toggle(title, sub, on, warn, onClick) {
  const r = document.createElement("div"); r.className = "toggle-row"; r.style.cursor = "pointer";
  const sw = document.createElement("div"); sw.className = "switch" + (warn ? " warn" : "") + (on ? " on" : "");
  const knob = document.createElement("div"); knob.className = "knob"; sw.appendChild(knob); r.appendChild(sw);
  const txt = document.createElement("div"); txt.className = "toggle-text";
  const t = document.createElement("div"); t.className = "t"; t.textContent = title;
  const s = document.createElement("div"); s.className = "s"; s.textContent = sub;
  txt.appendChild(t); txt.appendChild(s); r.appendChild(txt);
  r.addEventListener("click", onClick); return r;
}
function addBtn(label, onClick) { const b = document.createElement("button"); b.className = "add-block"; b.textContent = label; b.addEventListener("click", onClick); return b; }
function renameNs(m, old, v) {
  const map = {}; Object.keys(m.namespaces).forEach(k => { map[k === old ? v : k] = m.namespaces[k]; }); m.namespaces = map;
  const fix = io => { const r = io.role || ""; const ci = r.indexOf(":"); if (ci >= 0 && r.slice(0, ci) === old) io.role = v + ":" + r.slice(ci + 1); };
  (m.phases || []).forEach(p => { ["inputs", "outputs"].forEach(s => (p[s] || []).forEach(fix)); (p.invocations || []).forEach(iv => ["inputs", "outputs"].forEach(s => (iv[s] || []).forEach(fix))); });
}
// Serialize the global opportunistic value exactly as the YAML writer would.
function oppYaml(g) {
  if (!g.enabled) return "opportunistic: false";
  const w = (g.when || "").trim();
  const exs = (g.examples || []).filter(e => e && e.trim());
  if (!w && exs.length === 0) return "opportunistic: true";
  const lines = ["opportunistic:", "  enabled: true"];
  if (w) { lines.push("  when: |"); w.split("\n").forEach(l => lines.push("    " + l)); }
  if (exs.length) { lines.push("  examples:"); exs.forEach(e => lines.push("    - " + JSON.stringify(e))); }
  return lines.join("\n");
}
