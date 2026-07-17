// Workflow definition tab (spec docs/superpowers/specs/2026-07-17-workflow-io-
// contract-design.md): edits `model.definition` — params (input side), outputs
// + emits (return side), and an optional formatter (+ prompt-assist) that
// composes a final answer. Ported from the vendored React mockup
// (docs/superpowers/specs/2026-07-17-workflow-io-contract-maquette.html), with
// the 12-task plan's pitfall deltas (D1-D10, see the task-10 brief) applied —
// each is flagged inline below where it diverges from the mockup.
//
// Structural idiom mirrors settings.js exactly: renderDefinition(root, ctx)
// tears down and rebuilds the whole tab from the model on every edit, mutates
// the model object returned by ctx.getModel() IN PLACE (never ctx.setModel),
// then calls ctx.refreshView() for the server round-trip that recomputes the
// validation banner + the server-rendered preview (D5).
import { helpIcon, helpNote } from "./render-helpers.js";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox,
         ioRefEditor, stringListEditor, resolveIoPath } from "./formfields.js";

const NAME_RE = /^[a-z][a-z0-9-]*$/;        // skill.name (kebab-case slug)
const ID_RE = /^[a-z][a-z0-9_]*$/;          // param / emit / of-field name
const TYPES = ["number", "string", "bool", "enum", "list"];
const KINDS = ["json", "jsonl", "md", "text", "yaml", "dir", "sqlite", "binary"];
const MODELS = ["inherit", "haiku", "sonnet", "opus"];
const EFFORTS = ["inherit", "low", "medium", "high", "xhigh", "max"];
const FILE_PATH_HINT = /(^|\s)[\w./-]+\.(json|md|yaml|txt|csv|html)\b/;

export function renderDefinition(root, ctx) {
  if (!root || !ctx.getModel()) return;
  root.replaceChildren();
  const m = ctx.getModel();
  m.skill = m.skill || {};
  m.definition = m.definition || {};
  const d = m.definition;
  d.params = d.params || [];
  d.outputs = d.outputs || [];
  d.emits = d.emits || [];
  d.formatter = d.formatter || {};
  const view = ctx.view || {};
  const rerender = () => renderDefinition(root, ctx);

  root.appendChild(bannerSection(view));                        // §7
  root.appendChild(heroSection(m, ctx, rerender));               // §1
  root.appendChild(paramsSection(d, ctx, rerender));             // §2
  root.appendChild(returnSection(m, d, ctx, rerender));          // §3
  root.appendChild(formatterSection(m, d, ctx, rerender));       // §4
  root.appendChild(callerPreview(d));                            // §5
  root.appendChild(statsSection(m, d, view));                    // §6
}

// ============================================================================
// §1 HERO / IDENTITY — D7: writes the SHARED model.skill.{name,description,
// title} (same fields Settings edits — no fork), reads model.namespaces live.
// ============================================================================
function heroSection(m, ctx, rerender) {
  const skill = m.skill;
  const nameOK = NAME_RE.test(skill.name || "");
  const descOK = !!(skill.description && skill.description.trim());
  const c = card("Workflow definition", "identity, params, outputs & emits — the I/O contract callers bind",
    null, "Front door of the workflow: name/description drive discovery (Claude Code reads the description to decide when to invoke /<name>); params/outputs/emits are the typed contract a caller — or another workflow's workflow_call — binds.");

  const nameRow = fieldText("name", skill.name || "", v => { skill.name = v.trim(); rerender(); ctx.refreshView(); });
  const nameIn = nameRow.querySelector("input");
  nameIn.placeholder = "my-workflow";
  if (!nameOK) nameIn.style.borderColor = "var(--bad)";
  c.body.appendChild(withHelp(nameRow, "kebab-case, unique — becomes the /slash command. Same field as Settings › Skill › Name."));
  if (!nameOK) c.body.appendChild(fieldErr((skill.name || "").length ? "Use kebab-case: a lowercase letter first, then lowercase letters, digits or hyphens." : "Name is required."));

  const titleRow = fieldText("title (optional display name)", skill.title || "", v => { if (v) skill.title = v; else delete skill.title; ctx.refreshView(); });
  titleRow.querySelector("input").placeholder = "/" + (skill.name || "name") + " — " + (skill.name || "name");
  c.body.appendChild(titleRow);

  const descRow = fieldTextarea("description", skill.description || "", v => { skill.description = v; ctx.refreshView(); });
  c.body.appendChild(withHelp(descRow, "Required. Claude Code reads this to decide when to invoke /" + (skill.name || "<name>") + "."));
  if (!descOK) c.body.appendChild(fieldErr("Description is required — Claude Code reads it to decide when to invoke /" + (skill.name || "<name>") + "."));

  const nsKeys = Object.keys(m.namespaces || {});
  c.body.appendChild(helpNote(nsKeys.length
    ? "Namespaces available for roles: " + nsKeys.join(", ") + " (edit in Settings)."
    : "No namespaces declared yet — add one in Settings before wiring role-based I/O."));

  c.body.appendChild(completenessPills(m, m.definition));
  return c;
}

function completenessPills(m, d) {
  const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:2px";
  const idOK = NAME_RE.test(m.skill.name || "") && !!(m.skill.description && m.skill.description.trim());
  const items = [
    ["identity", idOK],
    ["params", (d.params || []).length > 0],
    ["return", (d.outputs || []).length > 0 || (d.emits || []).length > 0],
    ["formatter", !!(d.formatter && d.formatter.enabled)],
  ];
  items.forEach(([label, ok]) => {
    const p = document.createElement("span");
    p.style.cssText = "font:10.5px/1 var(--mono);padding:4px 8px;border-radius:6px;border:1px solid var(--border);color:" + (ok ? "#86efac" : "var(--dim)");
    p.textContent = (ok ? "✓ " : "○ ") + label;
    wrap.appendChild(p);
  });
  return wrap;
}

// ============================================================================
// §2 PARAMS — the input side
// ============================================================================
function paramsSection(d, ctx, rerender) {
  const c = card("Params — input side", "typed values a caller passes in, like a form", null,
    "The values a caller (or you, from the CLI) passes in when running this workflow.");
  if (!d.params.length) c.body.appendChild(emptyNote("No params — this workflow takes no arguments."));
  d.params.forEach((p, idx) => c.body.appendChild(paramRow(p, idx, d, ctx, rerender)));
  c.body.appendChild(addBtn("+ param", () => { d.params.push({ name: "", type: "string", required: false }); rerender(); ctx.refreshView(); }));
  return c;
}

function paramRow(p, idx, d, ctx, rerender) {
  const b = block();
  const nameOK = ID_RE.test(p.name || "");
  const nameField = fieldText("name", p.name || "", v => { p.name = v.trim(); ctx.refreshView(); });
  if (!nameOK) nameField.querySelector("input").style.borderColor = "var(--bad)";
  b.appendChild(withHelp(nameField, "^[a-z][a-z0-9_]*$, unique."));
  b.appendChild(fieldSelect("type", p.type || "string", TYPES, v => {
    p.type = v; if (v !== "enum") delete p.values; if (v !== "list") delete p.of;
    rerender(); ctx.refreshView();
  }));
  if (p.type === "enum") {
    b.appendChild(span2(stringListEditor("values (required for enum)", p.values || [], vals => { if (vals.length) p.values = vals; else delete p.values; ctx.refreshView(); })));
  } else if (p.type === "list") {
    // D8: `of` offers string|number|bool|enum + an object-map builder (see ofFieldEditor).
    b.appendChild(span2(ofFieldEditor(p, () => { rerender(); ctx.refreshView(); })));
  }
  b.appendChild(withHelp(fieldCheckbox("required", !!p.required, v => {
    p.required = v; if (v) delete p.default; rerender(); ctx.refreshView();
  }), "required and default are mutually exclusive."));
  if (!p.required && p.type !== "list") b.appendChild(defaultField(p, ctx));
  b.appendChild(span2(fieldText("description (recommended)", p.description || "", v => { if (v) p.description = v; else delete p.description; ctx.refreshView(); })));
  b.appendChild(removeBtn(() => { d.params.splice(idx, 1); rerender(); ctx.refreshView(); }));
  return b;
}

function defaultField(p, ctx) {
  if (p.type === "bool") {
    return fieldSelect("default", p.default === true ? "true" : p.default === false ? "false" : "", ["", "true", "false"], v => {
      if (v === "") delete p.default; else p.default = (v === "true"); ctx.refreshView();
    });
  }
  if (p.type === "number") {
    const r = fieldText("default", p.default != null ? String(p.default) : "", v => {
      if (v === "") { delete p.default; ctx.refreshView(); return; }
      const n = Number(v); if (!Number.isNaN(n)) { p.default = n; ctx.refreshView(); }
    });
    r.querySelector("input").placeholder = "0";
    return r;
  }
  if (p.type === "enum") {
    return fieldSelect("default", p.default || "", ["", ...(p.values || [])], v => { if (v) p.default = v; else delete p.default; ctx.refreshView(); });
  }
  return fieldText("default", p.default != null ? String(p.default) : "", v => { if (v) p.default = v; else delete p.default; ctx.refreshView(); });
}

// A `list`-typed item's `of` element type — D8: string|number|bool|enum, or an
// object-map builder (flat field -> type, no nesting), matching the identical
// pattern already used for signal payloads in formfields.js's signalsEditor.
// Shared by params and emits (both def_param and def_emit carry `of`+`values`).
function ofFieldEditor(item, onChange) {
  const wrap = document.createElement("div"); wrap.className = "field";
  const l = document.createElement("label"); l.textContent = "element type (of) ";
  l.appendChild(helpIcon("Required for list — a scalar keyword or a flat field map (no nesting)."));
  wrap.appendChild(l);
  const curOf = (item.of && typeof item.of === "object") ? "object" : (item.of || "");
  const sel = document.createElement("select");
  const opts = ["", "string", "number", "bool", "enum", "object"];
  for (const o of opts) {
    const opt = document.createElement("option"); opt.value = o;
    opt.textContent = o === "object" ? "object (field map)" : (o || "—");
    if (o === curOf) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === "object") { item.of = (item.of && typeof item.of === "object") ? item.of : {}; delete item.values; }
    else if (v === "") { delete item.of; delete item.values; }
    else { item.of = v; if (v !== "enum") delete item.values; }
    onChange();
  });
  wrap.appendChild(sel);

  if (curOf === "enum") {
    wrap.appendChild(stringListEditor("values (element vocabulary)", item.values || [], vals => { if (vals.length) item.values = vals; else delete item.values; onChange(); }));
  }
  if (curOf === "object") {
    const obj = item.of;
    const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px";
    Object.keys(obj).forEach(field => {
      const row = document.createElement("div"); row.className = "settings-row";
      const fname = document.createElement("input"); fname.type = "text"; fname.value = field; fname.placeholder = "field";
      fname.addEventListener("change", () => {
        const nv = fname.value.trim();
        if (nv && nv !== field && !(nv in obj)) {
          const next = { ...item.of }; next[nv] = next[field]; delete next[field]; item.of = next; onChange();
        } else { fname.value = field; }
      });
      row.appendChild(fname);
      const cur = (obj[field] && typeof obj[field] === "object") ? "enum" : obj[field];
      const ftype = document.createElement("select");
      for (const t of ["string", "number", "bool", "enum"]) { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === cur) o.selected = true; ftype.appendChild(o); }
      ftype.addEventListener("change", () => {
        const next = { ...item.of };
        next[field] = ftype.value === "enum" ? { enum: (obj[field] && obj[field].enum) || [] } : ftype.value;
        item.of = next; onChange();
      });
      row.appendChild(ftype);
      const del = document.createElement("button"); del.textContent = "✕";
      del.addEventListener("click", () => { const next = { ...item.of }; delete next[field]; item.of = next; onChange(); });
      row.appendChild(del);
      box.appendChild(row);
      if (obj[field] && typeof obj[field] === "object") {
        box.appendChild(stringListEditor("values", obj[field].enum || [], vals => { const next = { ...item.of }; next[field] = { enum: vals }; item.of = next; onChange(); }));
      }
    });
    box.appendChild(addBtn("+ field", () => { const next = { ...item.of }; next["field" + (Object.keys(next).length + 1)] = "string"; item.of = next; onChange(); }));
    wrap.appendChild(box);
  }
  return wrap;
}

// ============================================================================
// §3 RETURN — outputs & emits
// D1: ONE output list (d.outputs). §3a below shows the `promote` ones; §4
// shows the `formatter` ones — same array, filtered views, both editable,
// every row carries the produced_by control that reclassifies it.
// ============================================================================
function returnSection(m, d, ctx, rerender) {
  const c = card("Return — outputs & emits", "what this workflow exposes when done", null,
    "Files (io_ref) and small named signals other workflows can read. Every output row declares who produces it.");

  c.body.appendChild(caption("3a · Output files — promoted from an internal phase"));
  let any3a = false;
  d.outputs.forEach((o, idx) => { if (o.produced_by === "formatter") return; any3a = true; c.body.appendChild(outputRow(m, d, o, idx, ctx, rerender)); });
  if (!any3a) c.body.appendChild(emptyNote("No promoted outputs — outputs written by the formatter live in §4."));
  c.body.appendChild(addBtn("+ output file", () => { d.outputs.push({ role: "", kind: "json", produced_by: "promote" }); rerender(); ctx.refreshView(); }));

  const hr = document.createElement("div"); hr.style.cssText = "height:1px;background:var(--border);margin:6px 0";
  c.body.appendChild(hr);

  c.body.appendChild(caption("3b · Emitted signals — small named return values"));
  if (!d.emits.length) c.body.appendChild(emptyNote("No signals emitted."));
  d.emits.forEach((e, idx) => c.body.appendChild(emitRow(m, d, e, idx, ctx, rerender)));
  c.body.appendChild(addBtn("+ emitted signal", () => { d.emits.push({ name: "", type: "string", source: "promote" }); rerender(); ctx.refreshView(); }));

  return c;
}

// Shared by §3a (promote) and §4 (formatter) — same definition.outputs array,
// filtered by the caller; produced_by is editable here so a row can move
// between the two sections on the next render (D1).
function outputRow(m, d, o, idx, ctx, rerender) {
  const b = block();
  const roleField = fieldText("role (ns:name)", o.role || "", v => { const t = v.trim(); if (t) o.role = t; else delete o.role; ctx.refreshView(); });
  roleField.querySelector("input").placeholder = "work:summary";
  b.appendChild(withHelp(roleField, "Resolved via the namespaces map (edit in Settings). Use `path` to override."));
  b.appendChild(fieldText("path override (optional)", o.path || "", v => { const t = v.trim(); if (t) o.path = t; else delete o.path; ctx.refreshView(); }));
  b.appendChild(fieldSelect("kind", o.kind || "json", KINDS, v => { o.kind = v; ctx.refreshView(); }));
  b.appendChild(withHelp(fieldSelect("produced_by", o.produced_by || "promote", ["promote", "formatter"], v => { o.produced_by = v; rerender(); ctx.refreshView(); }),
    "promote = an internal phase already writes this role · formatter = the closing formatter (§4) writes it."));
  b.appendChild(fieldCheckbox("terminal (final deliverable)", !!o.terminal, v => { if (v) o.terminal = true; else delete o.terminal; ctx.refreshView(); }));
  b.appendChild(fieldCheckbox("optional (may be absent)", !!o.optional, v => { if (v) o.optional = true; else delete o.optional; ctx.refreshView(); }));
  const resolved = document.createElement("div"); resolved.className = "ioref-resolved";
  const path = resolveIoPath(o, m.namespaces);
  if (path) resolved.textContent = "→ " + path;
  else { resolved.textContent = "⚠ unresolved (set a role + a declared namespace, or a path)"; resolved.classList.add("warn"); }
  b.appendChild(span2(resolved));
  b.appendChild(removeBtn(() => { d.outputs.splice(idx, 1); rerender(); ctx.refreshView(); }));
  return b;
}

// D2: a `create` emit reads a formatter output of kind json and requires a
// `field` selector; persisted as {source:"create", from:<role>, field:<name>}.
// D3: the caller-preview line uses a placeholder, never a hardcoded phase id.
// D4: the promote `from` list uses lowercase <phase_id>.<signal> keys, derived
// live from the model's phases (mirrors collect_signals()) — not a static array.
function emitRow(m, d, e, idx, ctx, rerender) {
  const b = block();
  const nameOK = ID_RE.test(e.name || "");
  const nameField = fieldText("name", e.name || "", v => { e.name = v.trim(); ctx.refreshView(); });
  if (!nameOK) nameField.querySelector("input").style.borderColor = "var(--bad)";
  b.appendChild(withHelp(nameField, "^[a-z][a-z0-9_]*$, unique."));
  b.appendChild(fieldSelect("type", e.type || "string", TYPES, v => {
    e.type = v; if (v !== "enum") delete e.values; if (v !== "list") delete e.of;
    rerender(); ctx.refreshView();
  }));
  if (e.type === "enum") {
    b.appendChild(span2(stringListEditor("values (required for enum)", e.values || [], vals => { if (vals.length) e.values = vals; else delete e.values; ctx.refreshView(); })));
  } else if (e.type === "list") {
    b.appendChild(span2(ofFieldEditor(e, () => { rerender(); ctx.refreshView(); })));
  }

  b.appendChild(withHelp(fieldSelect("source", e.source || "promote", ["promote", "create"], v => {
    e.source = v; delete e.from; delete e.field;
    rerender(); ctx.refreshView();
  }), "promote = re-expose an internal signal already emitted by a phase · create = read a field of a formatter JSON output."));

  if ((e.source || "promote") === "promote") {
    const sigs = internalSignals(m);
    const opts = ["", ...sigs.map(s => s.key)];
    const sel = fieldSelect("from — internal signal", e.from || "", opts, v => { if (v) e.from = v; else delete e.from; ctx.refreshView(); });
    b.appendChild(span2(withHelp(sel, sigs.length
      ? "Key = <phase_id_lowercase>.<name> — must be declared as an `emits` on a phase."
      : "No phase emits a signal yet — declare one on a phase's Wiring tab first.")));
  } else {
    const hasFormatter = !!(d.formatter && d.formatter.enabled);
    if (!hasFormatter) {
      b.appendChild(span2(warnBox("⛔ No formatter enabled — add one in §4 before creating an emit from an output.")));
    } else {
      // Only json formatter-outputs are valid `create` sources — the
      // dropdown is filtered to them (D2's "disable"); a persisted `from`
      // that no longer matches one (kind changed, output removed) still
      // surfaces an explicit error (D2's "error").
      const jsonOutputs = (d.outputs || []).filter(o => o.produced_by === "formatter" && o.kind === "json");
      const roleOf = o => o.role || o.path;
      const curValid = jsonOutputs.some(o => roleOf(o) === e.from);
      const opts = ["", ...jsonOutputs.map(roleOf).filter(Boolean)];
      const fromSel = fieldSelect("from — formatter output (kind json only)", curValid ? e.from : "", opts, v => { if (v) e.from = v; else delete e.from; ctx.refreshView(); });
      if (!jsonOutputs.length) fromSel.querySelector("select").disabled = true;
      b.appendChild(span2(withHelp(fromSel, "Must be a formatter output (§4) of kind json — a `number`/`enum` emit cannot be sourced from a non-json file.")));
      if (e.from && !curValid) b.appendChild(span2(warnBox("⚠ '" + e.from + "' is not (or no longer) a formatter output of kind json.")));
      const fieldRow = fieldText("field — json field to read", e.field || "", v => { const t = v.trim(); if (t) e.field = t; else delete e.field; ctx.refreshView(); });
      if (!e.field) fieldRow.querySelector("input").style.borderColor = "var(--bad)";
      b.appendChild(span2(withHelp(fieldRow, "Required for create — which field of the chosen json output to read.")));
    }
  }

  // D3 — placeholder caller key, never a concrete phase id: the real key
  // depends on the workflow_call phase id at the CALLING workflow, which
  // varies per caller and isn't known here.
  b.appendChild(span2(helpNote("seen by a caller as ‹caller_phase›." + (e.name || "…"))));
  b.appendChild(removeBtn(() => { d.emits.splice(idx, 1); rerender(); ctx.refreshView(); }));
  return b;
}

// D4 — internal signals available to `promote`: <phase_id_lowercase>.<name>,
// derived live from every phase's `emits` (mirrors collect_signals() engine-
// side). Never a hardcoded/uppercase array.
function internalSignals(m) {
  const out = [];
  for (const p of m.phases || []) {
    for (const em of p.emits || []) {
      if (em && em.name) out.push({ key: (p.id || "").toLowerCase() + "." + em.name, type: em.type, phase: p.id });
    }
  }
  return out;
}

// ============================================================================
// §4 FORMATTER — format mode (presence of an enabled formatter) vs pure
// promote. D5: the prompt preview is server-rendered (ctx.view.definition_
// preview), never recompiled client-side. D6: wired inputs are EDITABLE
// (definition.formatter.inputs) via the shared ioRefEditor. D10: effort/tools
// only shown for invoke.type==='agent', with the shared-agent/haiku caveat.
// ============================================================================
function formatterSection(m, d, ctx, rerender) {
  const f = d.formatter;
  const on = !!f.enabled;
  const c = card("Formatter", "the closing step that composes the final answer", null,
    "Present = format mode: a closing phase turns everything produced into the final answer. Absent = pure promote — no closing composition step.");
  c.body.appendChild(toggle("Enabled", on ? "This workflow formats a final deliverable." : "This workflow only promotes internal signals / outputs.",
    on, false, () => { f.enabled = !on; rerender(); ctx.refreshView(); }));
  if (!on) { c.body.appendChild(emptyNote("No formatter — this workflow only promotes internal signals/outputs.")); return c; }

  f.style = f.style || {};
  f.invoke = f.invoke || {};
  f.inputs = f.inputs || [];
  const st = f.style;

  c.body.appendChild(caption("Prompt-assist — knobs compile to prose at generate time (server-owned; the preview below shows the result verbatim)"));
  const knobs = block();
  knobs.appendChild(fieldSelect("length", st.length || "", ["", "terse", "brief", "standard", "detailed", "exhaustive"], v => { if (v) st.length = v; else delete st.length; ctx.refreshView(); }));
  if (st.tone === "custom") {
    knobs.appendChild(span2(fieldText("tone (custom voice)", st.toneCustom || "", v => { if (v) st.toneCustom = v; else delete st.toneCustom; ctx.refreshView(); })));
  } else {
    knobs.appendChild(fieldSelect("tone", st.tone || "", ["", "direct", "professional", "didactic", "beginner", "zero-knowledge", "custom"],
      v => { if (v) st.tone = v; else delete st.tone; if (v !== "custom") delete st.toneCustom; rerender(); ctx.refreshView(); }));
  }
  knobs.appendChild(fieldSelect("format", st.format || "", ["", "prose", "bullets", "table", "sections", "tldr"], v => { if (v) st.format = v; else delete st.format; ctx.refreshView(); }));
  knobs.appendChild(fieldSelect("language", st.language || "inherit", ["inherit", "English", "French", "German", "Spanish"], v => { st.language = v; ctx.refreshView(); }));
  knobs.appendChild(fieldSelect("audience (optional)", st.audience || "", ["", "maintainer", "external stakeholder", "downstream workflow"], v => { if (v) st.audience = v; else delete st.audience; ctx.refreshView(); }));
  knobs.appendChild(fieldSelect("stance (optional)", st.stance || "", ["", "recommend", "present"], v => { if (v) st.stance = v; else delete st.stance; ctx.refreshView(); }));
  knobs.appendChild(span2(stringListEditor("must-include (optional)", st.mustInclude || [], vals => { if (vals.length) st.mustInclude = vals; else delete st.mustInclude; ctx.refreshView(); })));
  knobs.appendChild(span2(stringListEditor("avoid (optional)", st.avoid || [], vals => { if (vals.length) st.avoid = vals; else delete st.avoid; ctx.refreshView(); })));
  c.body.appendChild(knobs);

  const promptRow = fieldTextarea("prompt — final instructions", f.prompt || "", v => { if (v) f.prompt = v; else delete f.prompt; ctx.refreshView(); });
  c.body.appendChild(withHelp(promptRow, "Prose about how to gather and shape the answer. Don't list files — wired inputs feed in automatically (see the preview)."));
  if (FILE_PATH_HINT.test(f.prompt || "")) {
    c.body.appendChild(warnBox("⚠ The prompt seems to list a file path — describe how to use the wired inputs instead; files are listed automatically in the preview below."));
  }

  c.body.appendChild(previewBlock(ctx));                                                  // D5

  c.body.appendChild(ioRefEditor("wired inputs — formatter.inputs (editable)", f.inputs,   // D6
    next => { f.inputs = next; ctx.refreshView(); }, m.namespaces));

  c.body.appendChild(caption("Outputs written here — definition.outputs entries produced by this formatter"));
  let anyFo = false;
  d.outputs.forEach((o, idx) => { if (o.produced_by !== "formatter") return; anyFo = true; c.body.appendChild(outputRow(m, d, o, idx, ctx, rerender)); });
  if (!anyFo) c.body.appendChild(emptyNote("No formatter outputs yet."));
  c.body.appendChild(addBtn("+ formatter output", () => { d.outputs.push({ role: "", kind: "json", produced_by: "formatter", terminal: true }); rerender(); ctx.refreshView(); }));

  c.body.appendChild(caption("Invocation — the real terminal phase of the DAG (reserved id DEFINITION)"));
  const isAgent = f.invoke.type === "agent";
  const invBlock = block();
  invBlock.appendChild(fieldSelect("type", f.invoke.type || "main_agent", ["main_agent", "agent"], v => {
    f.invoke.type = v;
    if (v !== "agent") { delete f.invoke.agent; delete f.invoke.model; delete f.invoke.effort; delete f.invoke.tools; }
    rerender(); ctx.refreshView();
  }));
  if (isAgent) {                                                                            // D10
    const agentField = fieldText("agent", f.invoke.agent || "", v => { const t = v.trim(); if (t) f.invoke.agent = t; else delete f.invoke.agent; ctx.refreshView(); });
    if (!f.invoke.agent) agentField.querySelector("input").style.borderColor = "var(--bad)";
    invBlock.appendChild(agentField);
    invBlock.appendChild(fieldSelect("model", f.invoke.model || "inherit", MODELS, v => {
      if (v === "inherit") delete f.invoke.model; else f.invoke.model = v;
      if (v === "haiku") delete f.invoke.effort;
      rerender(); ctx.refreshView();
    }));
    const effortRow = fieldSelect("effort", f.invoke.effort || "inherit", EFFORTS, v => { if (v === "inherit") delete f.invoke.effort; else f.invoke.effort = v; ctx.refreshView(); });
    if (f.invoke.model === "haiku") {
      const sel = effortRow.querySelector("select"); if (sel) sel.disabled = true;
      effortRow.title = "Haiku doesn't support reasoning effort — pick sonnet/opus to set it.";
    }
    invBlock.appendChild(effortRow);
    invBlock.appendChild(span2(fieldText("tools (comma-sep, empty = agent frontmatter)", Array.isArray(f.invoke.tools) ? f.invoke.tools.join(", ") : "", v => {
      const arr = (v || "").split(",").map(s => s.trim()).filter(Boolean);
      if (arr.length) f.invoke.tools = arr; else delete f.invoke.tools;
      ctx.refreshView();
    })));
    invBlock.appendChild(span2(helpNote("ⓘ If this agent is also invoked elsewhere in this workflow (or in another workflow), the last-deployed effort/tools win — a known cross-workflow blind spot (TODO A2). Pin them consistently across every invocation of this agent, or leave empty to inherit the agent's own frontmatter / the session default.")));
  } else {
    invBlock.appendChild(span2(helpNote("main_agent — the orchestrator itself writes the answer; no agent/model/effort/tools to set.")));
  }
  c.body.appendChild(invBlock);

  return c;
}

// D5 — server-rendered preview: renders ctx.view.definition_preview verbatim
// (io_line + compiled knob lines + the final composed prompt). Never
// recomputes compile_style() or the file listing in JS.
function previewBlock(ctx) {
  const wrap = document.createElement("div"); wrap.className = "derived";
  wrap.appendChild(caption("Prompt preview · read-only · server-rendered"));
  const dp = ctx.view && ctx.view.definition_preview;
  if (!dp) {
    wrap.appendChild(helpNote("No preview yet — it resolves once the formatter has enough to compose (namespaces, roles, style)."));
    return wrap;
  }
  if (dp.io_line) {
    wrap.appendChild(caption("files"));
    const io = document.createElement("pre"); io.className = "yaml-pre"; io.style.color = "#c4b5fd"; io.textContent = dp.io_line;
    wrap.appendChild(io);
  }
  if (Array.isArray(dp.compiled) && dp.compiled.length) {
    wrap.appendChild(caption("style"));
    wrap.appendChild(helpNote(dp.compiled.join(" ")));
  }
  wrap.appendChild(caption("final composed prompt"));
  const pre = document.createElement("pre"); pre.className = "yaml-pre"; pre.textContent = dp.prompt || "_(empty)_";
  wrap.appendChild(pre);
  return wrap;
}

// ============================================================================
// §5 CALLER PREVIEW — read-only: the contract another workflow's workflow_call
// phase binds. Args-binding itself lives on the CALLER's phase (Wiring panel),
// not here (spec §5, "pitfall #8").
// ============================================================================
function callerPreview(d) {
  const c = card("Caller preview", "the contract other workflows bind", null,
    "What another workflow's workflow_call phase sees when it calls this one. Reverse index (“who calls this”) is out of scope for now.");
  const req = (d.params || []).filter(p => p.required);
  c.body.appendChild(derivedBox("Required params to bind",
    req.length ? req.map(p => drow(p.name || "?", p.type || "")) : [emptyNote("none — all params optional")]));
  const emits = d.emits || [];
  c.body.appendChild(derivedBox("Readable signal keys",
    emits.length ? emits.map(e => drow("◈", "‹caller_phase›." + (e.name || "…"))) : [emptyNote("none")]));
  return c;
}

// ============================================================================
// §6 STATS — derived, never editable. D9: "external inputs" counts
// `external:true` io_refs across all phases (from the model/view), NOT the
// formatter's wired inputs (a distinct notion).
// ============================================================================
function statsSection(m, d, view) {
  const c = card("Stats", "a quick read on the shape and cost of this workflow", null,
    "Derived — recomputed on every change, never editable.");
  const phases = m.phases || [];
  const levels = view.levels || {};
  const levelVals = Object.values(levels);
  const depth = levelVals.length ? Math.max(...levelVals) + 1 : 0;
  const widthByLevel = {};
  levelVals.forEach(l => { widthByLevel[l] = (widthByLevel[l] || 0) + 1; });
  const width = Object.values(widthByLevel).reduce((a, b) => Math.max(a, b), 0);

  const agents = new Set();
  const models = { haiku: 0, sonnet: 0, opus: 0, inherit: 0 };
  const efforts = { low: 0, medium: 0, high: 0, xhigh: 0, max: 0, inherit: 0 };
  const tally = inv => {
    if (inv.agent) agents.add(inv.agent);
    const mo = inv.model || "inherit"; if (models[mo] != null) models[mo]++;
    const ef = inv.effort || "inherit"; if (efforts[ef] != null) efforts[ef]++;
  };
  phases.forEach(p => (p.invocations || []).forEach(tally));
  if (d.formatter && d.formatter.enabled && d.formatter.invoke && d.formatter.invoke.type === "agent") tally(d.formatter.invoke);

  const terminal = (d.outputs || []).filter(o => o.terminal).length;
  const gl = countGatesLoops(m.orchestration);

  c.body.appendChild(derivedBox("Structure", [
    drow("actions", phases.length), drow("groups", Object.keys(m.groups || {}).length),
    drow("distinct agents", agents.size), drow("DAG depth", depth + " level" + (depth === 1 ? "" : "s")),
    drow("max width", width),
  ]));
  c.body.appendChild(derivedBox("Contract", [
    drow("params", (d.params || []).length), drow("output files", (d.outputs || []).length),
    drow("emits", (d.emits || []).length), drow("internal signals", internalSignals(m).length),
    drow("terminal outputs", terminal), drow("external inputs", externalInputsCount(m)),
  ]));
  c.body.appendChild(derivedBox("Composition", [
    drow("on-demand agents", (m.on_demand_agents || []).length),
    drow("brainstormings", (m.brainstormings || []).length),
    drow("manual sections", (m.manual_sections || []).length),
    drow("gates / loops", gl.gates + " / " + gl.loops),
  ]));
  c.body.appendChild(derivedBox("Cost — model mix", [
    drow("haiku", models.haiku), drow("sonnet", models.sonnet), drow("opus", models.opus), drow("inherit", models.inherit),
  ]));
  c.body.appendChild(derivedBox("Effort mix", [
    drow("low", efforts.low), drow("medium", efforts.medium), drow("high", efforts.high),
    drow("xhigh", efforts.xhigh), drow("max", efforts.max), drow("inherit", efforts.inherit),
  ]));
  return c;
}

// D9 — external inputs across ALL phases (phase-level + invocation-level),
// not the formatter's own wired inputs.
function externalInputsCount(m) {
  let n = 0;
  for (const p of m.phases || []) {
    for (const io of p.inputs || []) if (io && io.external) n++;
    for (const inv of p.invocations || []) for (const io of inv.inputs || []) if (io && io.external) n++;
  }
  return n;
}

function countGatesLoops(orchestration) {
  let gates = 0, loops = 0;
  const walk = blocks => (blocks || []).forEach(b => {
    if (!b || typeof b !== "object") return;
    if (b.if) gates++;
    if (b.while || b.until || b.for_each) loops++;
    walk(b.then); walk(b.else); walk(b.body);
  });
  walk(orchestration);
  return { gates, loops };
}

// ============================================================================
// §7 VALIDATION BANNER — live, mirrors `awok check`. Server-authoritative:
// filters the SAME `errors` list the whole editor already gets from
// /api/view (validate_schema, which includes validate_definition) rather than
// re-implementing any rule client-side.
// ============================================================================
function bannerSection(view) {
  const errs = (view.errors || []).filter(e => /definition/i.test(e));
  if (!errs.length) {
    const ok = document.createElement("div");
    ok.className = "warn-box";
    ok.style.cssText = "background:rgba(74,222,128,0.08);border-color:rgba(74,222,128,0.3);color:#86efac";
    ok.textContent = "✓ definition valid — no problems in this block.";
    return ok;
  }
  const wrap = document.createElement("div"); wrap.className = "warn-box"; wrap.style.cssText += ";flex-direction:column;align-items:stretch";
  const head = document.createElement("div"); head.style.cssText = "font-weight:700;margin-bottom:6px";
  head.textContent = "⛔ " + errs.length + " definition issue" + (errs.length === 1 ? "" : "s") + " · live — same checks as awok check";
  wrap.appendChild(head);
  errs.forEach(e => { const r = document.createElement("div"); r.style.cssText = "font-size:11.5px;padding:3px 0"; r.textContent = e; wrap.appendChild(r); });
  return wrap;
}

// ============================================================================
// Tiny local DOM helpers — mirror settings.js exactly (private there too;
// duplicated rather than exported/imported to keep that module's shape
// untouched, as this task only creates definition.js).
// ============================================================================
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
function block() { const b = document.createElement("div"); b.className = "settings-block"; return b; }
function span2(node) { node.classList.add("span2"); return node; }
function removeBtn(onClick) { const d = document.createElement("button"); d.className = "block-del"; d.textContent = "✕ remove"; d.addEventListener("click", onClick); return d; }
function addBtn(label, onClick) { const b = document.createElement("button"); b.className = "add-block"; b.textContent = label; b.addEventListener("click", onClick); return b; }
function withHelp(fieldNode, text) { const l = fieldNode.querySelector("label"); if (l) l.appendChild(helpIcon(text)); return fieldNode; }
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
// Mirrors `.derived .h`'s styling inline so it reads consistently whether
// used inside a `.derived` box (stats, preview) or directly in a card body
// (§3a/§3b/§4 sub-headers) — that CSS rule is ancestor-scoped and wouldn't
// otherwise apply outside `.derived`.
function caption(text) {
  const c = document.createElement("div");
  c.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:10px;margin-top:4px";
  c.textContent = text;
  return c;
}
function emptyNote(text) { const n = document.createElement("div"); n.className = "help-note"; n.style.textAlign = "center"; n.style.padding = "10px"; n.textContent = text; return n; }
function fieldErr(text) { const e = document.createElement("div"); e.className = "field-err"; e.textContent = text; return e; }
function warnBox(text) { const w = document.createElement("div"); w.className = "warn-box"; w.textContent = text; return w; }
function drow(k, v) {
  const r = document.createElement("div"); r.className = "drow";
  const ke = document.createElement("span"); ke.className = "k"; ke.textContent = k;
  const ve = document.createElement("span"); ve.className = "v"; ve.textContent = v;
  r.appendChild(ke); r.appendChild(ve); return r;
}
function derivedBox(title, rows) {
  const wrap = document.createElement("div"); wrap.className = "derived";
  wrap.appendChild(caption(title));
  rows.forEach(r => wrap.appendChild(r));
  return wrap;
}
