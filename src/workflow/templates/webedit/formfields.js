import { helpIcon } from "./render-helpers.js";

// Pure form-field DOM builders. Each returns a row node and invokes onChange
// with the new value. Labels/values are set via textContent/value only.
function row(labelText){
  const r = document.createElement("div"); r.className = "field";
  const l = document.createElement("label"); l.textContent = labelText; r.appendChild(l);
  return r;
}
export function fieldText(label, value, onChange){
  const r = row(label);
  const i = document.createElement("input"); i.type = "text"; i.value = value == null ? "" : value;
  i.addEventListener("change", () => onChange(i.value));
  r.appendChild(i); return r;
}
export function fieldTextarea(label, value, onChange){
  const r = row(label);
  const t = document.createElement("textarea"); t.rows = 3; t.value = value == null ? "" : value;
  t.addEventListener("change", () => onChange(t.value));
  r.appendChild(t); return r;
}
export function fieldSelect(label, value, options, onChange){
  const r = row(label);
  const s = document.createElement("select");
  for (const opt of options){ const o = document.createElement("option"); o.value = opt; o.textContent = opt; if (opt === (value == null ? "" : value)) o.selected = true; s.appendChild(o); }
  s.addEventListener("change", () => onChange(s.value));
  r.appendChild(s); return r;
}
// Free-text input backed by a <datalist>: the user can type ANY value, and the
// provided options show up as suggestions (used for the phase `group`, which is
// an open-ended string — not a fixed enum).
let _dlSeq = 0;
export function fieldDatalist(label, value, options, onChange){
  const r = row(label);
  const i = document.createElement("input"); i.type = "text"; i.value = value == null ? "" : value;
  const id = "dl-" + (++_dlSeq); i.setAttribute("list", id);
  const dl = document.createElement("datalist"); dl.id = id;
  for (const opt of options || []){ const o = document.createElement("option"); o.value = opt; dl.appendChild(o); }
  i.addEventListener("change", () => onChange(i.value));
  r.appendChild(i); r.appendChild(dl); return r;
}
// awok-flag: the shared pill toggle for every boolean flag in the web UI
// (aria-pressed ring + check, cyan on / slate off). Replaces raw checkboxes —
// see TODO C6. opts: { title, dataK }.
const FLAG_CHECK_SVG = '<svg class="awok-flag__check" width="8" height="8" viewBox="0 0 24 24" fill="none"><path d="M4 12.5 9.5 18 20 6" stroke="#062033" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export function flagToggle(label, on, onToggle, opts = {}){
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "awok-flag";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (opts.title) btn.title = opts.title;
  if (opts.dataK) btn.dataset.k = opts.dataK;
  const ring = document.createElement("span"); ring.className = "awok-flag__ring"; ring.innerHTML = FLAG_CHECK_SVG;
  const lab = document.createElement("span"); lab.className = "awok-flag__label"; lab.textContent = label;
  btn.appendChild(ring); btn.appendChild(lab);
  btn.addEventListener("click", () => {
    const next = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", next ? "true" : "false");
    onToggle(next);
  });
  return btn;
}
export function flagsRow(name, flags){
  const w = document.createElement("div"); w.className = "awok-flags";
  if (name){ const n = document.createElement("span"); n.className = "awok-flags__name"; n.textContent = name; w.appendChild(n); }
  flags.forEach(f => w.appendChild(f));
  return w;
}
// Boolean field — now the awok-flag pill (was a raw <input type=checkbox>).
export function fieldCheckbox(label, checked, onChange){
  return flagToggle(label, !!checked, v => onChange(v));
}

const IO_KINDS = ["json","jsonl","md","text","yaml","dir","sqlite","binary"];
const IO_FLAGS = ["optional","external","terminal"];

const IO_FLAG_HELP = "role = ns:name (resolved to a path via namespaces, e.g. work:inventory → work/onboard/inventory.md) · path = explicit override (escape hatch, wins over role) · optional = the file may be missing · external = produced outside the workflow, hides the « no producer » warning · terminal = final artifact read on output, hides the « no consumer » warning";

// Extension per kind — mirrors EXT_BY_KIND in bb-workflow so the editor can show
// the same resolved path the generator / dataflow compute.
const EXT_BY_KIND = { json:".json", jsonl:".jsonl", md:".md", text:".txt", yaml:".yaml", sqlite:".sqlite", binary:"", dir:"" };

// Mirror of resolve_io_path() in bb-workflow: explicit path wins, otherwise the
// path is derived from role (ns:name | namespace+role) + the namespaces map.
// Returns "" when it can't be resolved (caller shows an "unresolved" hint).
export function resolveIoPath(item, namespaces){
  if (item && item.path) return item.path;
  const role = item && item.role;
  if (!role) return "";
  let ns, name;
  if (role.includes(":")){ [ns, name] = role.split(/:(.*)/s); }
  else { ns = item.namespace || ""; name = role; }
  const base = (namespaces || {})[ns];
  if (base == null) return "";
  const b = String(base).replace(/\/+$/,"");
  const kind = item.kind || "";
  return kind === "dir" ? `${b}/${name}/` : `${b}/${name}${EXT_BY_KIND[kind] || ""}`;
}

export function ioRefEditor(label, items, onChange, namespaces){
  const wrap = document.createElement("div"); wrap.className = "ioref-editor";
  const head = document.createElement("label"); head.textContent = label + " "; head.appendChild(helpIcon(IO_FLAG_HELP)); wrap.appendChild(head);
  const list = (items || []).map(x => ({ ...x }));
  const emit = () => onChange(list.map(x => ({ ...x })));
  const body = document.createElement("div"); wrap.appendChild(body);
  // Keep/delete a key based on a (trimmed) value so we never persist role:"" or path:"".
  const setKey = (item, k, v) => { if (v) item[k] = v; else delete item[k]; };
  function render(){
    body.replaceChildren();
    list.forEach((item, idx) => {
      const r = document.createElement("div"); r.className = "ioref-row";
      const role = document.createElement("input"); role.type = "text"; role.dataset.k = "role";
      role.value = item.role || ""; role.placeholder = "role (ns:name)"; role.className = "ioref-role";
      r.appendChild(role);
      const path = document.createElement("input"); path.type = "text"; path.dataset.k = "path";
      path.value = item.path || ""; path.placeholder = "path override";
      r.appendChild(path);
      const kind = document.createElement("select"); kind.dataset.k = "kind";
      for (const k of IO_KINDS){ const o = document.createElement("option"); o.value = k; o.textContent = k; if (k === (item.kind||"json")) o.selected = true; kind.appendChild(o); }
      r.appendChild(kind);
      const flags = IO_FLAGS.map(f => flagToggle(f, !!item[f],
        v => { if (v) item[f] = true; else delete item[f]; emit(); }, { dataK: f }));
      r.appendChild(flagsRow(null, flags));
      const del = document.createElement("button"); del.className = "ioref-del"; del.textContent = "✕";
      del.addEventListener("click", () => { list.splice(idx, 1); render(); emit(); });
      r.appendChild(del);
      body.appendChild(r);
      // Resolved-path hint (read-only): what the role+namespaces (or path override) resolve to.
      const resolved = document.createElement("div"); resolved.className = "ioref-resolved";
      const refresh = () => {
        const p = resolveIoPath(item, namespaces);
        if (p){ resolved.textContent = (item.path ? "→ " : "→ ") + p; resolved.classList.remove("warn"); }
        else { resolved.textContent = "⚠ unresolved (set a role + a declared namespace, or a path)"; resolved.classList.add("warn"); }
      };
      role.addEventListener("change", () => { setKey(item, "role", role.value.trim()); refresh(); emit(); });
      role.addEventListener("input", refresh);
      path.addEventListener("change", () => { setKey(item, "path", path.value.trim()); refresh(); emit(); });
      path.addEventListener("input", refresh);
      kind.addEventListener("change", () => { item.kind = kind.value; refresh(); emit(); });
      refresh();
      body.appendChild(resolved);
    });
  }
  const add = document.createElement("button"); add.className = "ioref-add"; add.textContent = "+ "+label;
  add.addEventListener("click", () => { list.push({ kind: "json" }); render(); emit(); });
  render(); wrap.appendChild(add);
  return wrap;
}

// A list of plain strings (add/remove rows). Emits the trimmed, non-empty
// values on every change — simpler than ioRefEditor (no kind, no flags).
export function stringListEditor(label, items, onChange){
  const wrap = document.createElement("div"); wrap.className = "stringlist-editor";
  const head = document.createElement("label"); head.textContent = label; wrap.appendChild(head);
  const list = (items || []).map(x => String(x));
  const emit = () => onChange(list.map(s => s.trim()).filter(Boolean));
  const body = document.createElement("div"); wrap.appendChild(body);
  function render(){
    body.replaceChildren();
    list.forEach((val, idx) => {
      const r = document.createElement("div"); r.className = "stringlist-row";
      const i = document.createElement("input"); i.type = "text"; i.value = val;
      i.addEventListener("change", () => { list[idx] = i.value; emit(); });
      r.appendChild(i);
      const del = document.createElement("button"); del.className = "stringlist-del"; del.textContent = "✕";
      del.addEventListener("click", () => { list.splice(idx, 1); render(); emit(); });
      r.appendChild(del);
      body.appendChild(r);
    });
  }
  const add = document.createElement("button"); add.className = "stringlist-add"; add.textContent = "+ " + label;
  // Do NOT emit() on add: the new row is empty and emit() filters empties, so it
  // would send the list unchanged — and any consumer that re-renders on that
  // (e.g. a tab whose every edit calls refreshView) tears the just-added row
  // back out. The value is persisted on the row's change event instead.
  add.addEventListener("click", () => { list.push(""); render(); });
  render(); wrap.appendChild(add);
  return wrap;
}

// Signal (`emits`) editor — declares signals on the PRODUCING action (Wiring
// tab). Self-contained: its own type/source lists (the older condition-side
// "declare a new signal" popover in orchestration.js, and the constants that
// backed it, were removed in Task 9 — declaration lives here only).
const SIGNAL_TYPES = ["number","string","bool","enum","list"];
// Allowed `source` values per action nature (phase.type). A phase with no
// `type` defaults to the "agent" nature (mirrors the generator/schema
// default). Natures not listed here (workflow_call, external, ...) don't
// support signals at all.
const SIGNAL_SOURCES_BY_NATURE = {
  agent: ["token","field"],
  script: ["exit_code","token","field"],
  main_agent: ["token","field"],
};
const SIGNAL_NAME_RE = /^[a-z][a-z0-9_]*$/;

// Collects this action's own output roles: its phase-level `outputs` plus
// every invocation's `outputs` — the candidate set for a `source: field`
// signal's `from` role.
function collectOutputRoles(phase){
  const roles = []; const seen = new Set();
  const add = r => { if (r && !seen.has(r)) { seen.add(r); roles.push(r); } };
  for (const o of (phase && phase.outputs) || []) add(o.role);
  for (const inv of (phase && phase.invocations) || []) for (const o of (inv.outputs) || []) add(o.role);
  return roles;
}

// Splits a stored `from` string ("<role>" or "<role>.<field>") back into its
// role/field parts, given the currently-known roles (so a role containing no
// dot is told apart from an appended `.field`).
function splitFrom(fromStr, roles){
  if (!fromStr) return { role: roles[0] || "", field: "" };
  if (roles.includes(fromStr)) return { role: fromStr, field: "" };
  for (const r of roles) if (fromStr.startsWith(r + ".")) return { role: r, field: fromStr.slice(r.length + 1) };
  const idx = fromStr.indexOf(".");
  return idx === -1 ? { role: fromStr, field: "" } : { role: fromStr.slice(0, idx), field: fromStr.slice(idx + 1) };
}

// Help layer for the signals editor (persona: never read the YAML nor the
// docs — see docs/superpowers/specs/2026-07-17-webedit-signals-help-design.md).
// Depth lives in the hover popovers; labels stay tiny so the rows keep their
// footprint. Uses the shared helpIcon popover (never native title=).
const SIGNAL_HELP = {
  intro: "A signal is a small typed value (status, number, list…) this action publishes when it finishes — the orchestration can branch or loop on it. Key: <action_id>.<name>.",
  name: "Lowercase identifier (^[a-z][a-z0-9_]*$). The orchestration reads this signal as <action_id>.<name>.",
  type: "Value shape: string, number, bool, enum (closed vocabulary), or list.",
  source: "How the value is produced — token: the agent ends its output with a compact `SIGNALS: name=value` line · field: read from a field of a JSON output file · exit_code: the script's exit status (bool: 0 ⇒ true · number: the raw code, e.g. grep 0/1/2).",
  from_role: "Which declared JSON output the value is read from.",
  from_field: "Optional: the JSON field to read, when its name differs from the signal name. Empty → the field is named like the signal. The signal key stays <action_id>.<name>.",
  by: "When several agents run in this action: which one emits the token.",
  values: "The closed vocabulary — the agent must emit exactly one of these.",
  of: "Element type of the list items; `object` declares a flat field map.",
  of_field: "One required field of each list item (flat — no nesting).",
  of_field_type: "Field type: a scalar, or enum with its own closed vocabulary.",
};

// `helpAlign` steers the hover popover so it never spills past the drawer's
// scroll edges (which clip it): "left" (default) opens rightward — right for a
// control near the panel's left edge; "right" opens leftward — for the type/
// source selects that sit against the right edge.
function labeled(labelText, helpText, controlEl, helpAlign){
  const w = document.createElement("div"); w.className = "labeled-ctl";
  const l = document.createElement("span"); l.className = "mini-label";
  if (helpAlign === "right") l.classList.add("help-align-right");
  l.appendChild(document.createTextNode(labelText));
  if (helpText) l.appendChild(helpIcon(helpText));
  w.appendChild(l); w.appendChild(controlEl);
  return w;
}

// items = phase.emits (or []). `phase` is the owning action, used to derive
// the nature-filtered source list and the output-role candidates for `from`.
export function signalsEditor(label, items, phase, onChange){
  const wrap = document.createElement("div"); wrap.className = "signals-editor";
  const head = document.createElement("label"); head.textContent = label; wrap.appendChild(head);
  const nature = (phase && phase.type) || "agent";
  const sources = SIGNAL_SOURCES_BY_NATURE[nature];
  if (!sources) {
    const note = document.createElement("div"); note.className = "muted-note";
    note.textContent = "signals not supported for this action type";
    wrap.appendChild(note);
    return wrap;
  }
  const intro = document.createElement("div");
  intro.className = "muted-note signals-intro";
  intro.textContent = SIGNAL_HELP.intro;
  wrap.appendChild(intro);
  const list = (items || []).map(x => ({ ...x }));
  const emit = () => onChange(list.map(x => ({ ...x })));
  const outputRoles = collectOutputRoles(phase);
  const invAgents = ((phase && phase.invocations) || []).map(i => i.agent).filter(Boolean);
  const body = document.createElement("div"); wrap.appendChild(body);
  function render(){
    body.replaceChildren();
    list.forEach((item, idx) => {
      // One framed block per signal groups the main row with its sub-rows
      // (from/by/values/of) so they read as a single unit inside the border.
      const block = document.createElement("div"); block.className = "signal-block";
      body.appendChild(block);
      const r = document.createElement("div"); r.className = "signal-row";
      const name = document.createElement("input"); name.type = "text"; name.className = "signal-name";
      name.placeholder = "name"; name.value = item.name || "";
      const warn = document.createElement("span"); warn.className = "signal-warn";
      const refreshWarn = () => { const ok = !item.name || SIGNAL_NAME_RE.test(item.name); warn.textContent = ok ? "" : "⚠ ^[a-z][a-z0-9_]*$"; };
      name.addEventListener("change", () => { item.name = name.value.trim(); refreshWarn(); emit(); });
      const nameWrap = labeled("name", SIGNAL_HELP.name, name);
      nameWrap.classList.add("grow");
      r.appendChild(nameWrap);
      // exit_code accepts bool (0 ⇒ true shorthand) or number (raw exit code, e.g. grep 0/1/2).
      const exitCode = (item.source || sources[0]) === "exit_code";
      const typeOpts = exitCode ? ["bool", "number"] : SIGNAL_TYPES;
      if (exitCode && !typeOpts.includes(item.type)) {
        item.type = "bool";
        if (item.type !== "enum") delete item.values;
        if (item.type !== "list") delete item.of;
      }
      const type = document.createElement("select");
      for (const t of typeOpts){ const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === (item.type || "string")) o.selected = true; type.appendChild(o); }
      type.addEventListener("change", () => {
        item.type = type.value;
        if (item.type !== "enum") delete item.values;
        if (item.type !== "list") delete item.of;
        emit(); render();
      });
      r.appendChild(labeled("type", SIGNAL_HELP.type, type, "right"));
      const source = document.createElement("select");
      for (const s of sources){ const o = document.createElement("option"); o.value = s; o.textContent = s; if (s === (item.source || sources[0])) o.selected = true; source.appendChild(o); }
      source.addEventListener("change", () => {
        item.source = source.value;
        if (item.source === "exit_code" && item.type !== "bool" && item.type !== "number") item.type = "bool";
        if (item.type !== "enum") delete item.values;
        if (item.type !== "list") delete item.of;
        if (item.source !== "field") { delete item.from; delete item.field; }
        if (item.source !== "token" && item.source !== "exit_code") delete item.by;
        emit(); render();
      });
      r.appendChild(labeled("source", SIGNAL_HELP.source, source, "right"));
      const del = document.createElement("button"); del.className = "signal-del"; del.textContent = "✕";
      del.addEventListener("click", () => { list.splice(idx, 1); render(); emit(); });
      r.appendChild(del);
      r.appendChild(warn);
      refreshWarn();
      block.appendChild(r);

      const curSource = item.source || sources[0];
      if (curSource === "field") {
        const sub = document.createElement("div"); sub.className = "signal-subrow";
        const roles = outputRoles.slice();
        // `from` is a pure role; the read field lives in its own `field` key. A
        // legacy dotted `from` ("role.field") is still parsed so old workflows
        // prefill correctly, but any edit rewrites them into the split form.
        const parsed = splitFrom(item.from, roles);
        const curField = (item.field != null ? item.field : parsed.field) || "";
        if (parsed.role && !roles.includes(parsed.role)) roles.unshift(parsed.role);
        const roleSel = document.createElement("select");
        if (!roles.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "(no output role declared)"; roleSel.appendChild(o); }
        for (const rl of roles){ const o = document.createElement("option"); o.value = rl; o.textContent = rl; if (rl === parsed.role) o.selected = true; roleSel.appendChild(o); }
        const fieldInput = document.createElement("input"); fieldInput.type = "text"; fieldInput.placeholder = "field (defaults to signal name)"; fieldInput.value = curField;
        const setFrom = () => {
          item.from = roleSel.value;                       // role stays pure
          const field = fieldInput.value.trim();
          if (field) item.field = field; else delete item.field;
          emit();
        };
        roleSel.addEventListener("change", setFrom);
        fieldInput.addEventListener("change", setFrom);
        sub.appendChild(labeled("from", SIGNAL_HELP.from_role, roleSel));
        const fw = labeled("field", SIGNAL_HELP.from_field, fieldInput);
        fw.classList.add("grow");
        sub.appendChild(fw);
        block.appendChild(sub);
      }
      if ((curSource === "token" || curSource === "exit_code") && invAgents.length >= 2) {
        const sub = document.createElement("div"); sub.className = "signal-subrow";
        const bySel = document.createElement("select");
        const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "by invocation…"; bySel.appendChild(o0);
        for (const a of invAgents){ const o = document.createElement("option"); o.value = a; o.textContent = a; if (a === item.by) o.selected = true; bySel.appendChild(o); }
        bySel.addEventListener("change", () => { if (bySel.value) item.by = bySel.value; else delete item.by; emit(); });
        sub.appendChild(labeled("by", SIGNAL_HELP.by, bySel));
        block.appendChild(sub);
      }
      if ((item.type || "string") === "enum") {
        const sub = document.createElement("div"); sub.className = "signal-subrow";
        const sle = stringListEditor("values", item.values, (vals) => {
          if (vals.length) item.values = vals; else delete item.values;
          emit();
        });
        sle.querySelector("label").appendChild(helpIcon(SIGNAL_HELP.values));
        sub.appendChild(sle);
        block.appendChild(sub);
      }
      if ((item.type || "string") === "list") {
        const sub = document.createElement("div"); sub.className = "signal-subrow";
        const ofSel = document.createElement("select"); ofSel.className = "signal-of";
        const ofOpts = ["string", "number", "bool", "enum", "object"];
        const curOf = (item.of && typeof item.of === "object") ? "object"
                    : (typeof item.of === "string" ? item.of : "string");
        for (const o of ofOpts) { const opt = document.createElement("option"); opt.value = o; opt.textContent = o; if (o === curOf) opt.selected = true; ofSel.appendChild(opt); }
        ofSel.addEventListener("change", () => {
          const v = ofSel.value;
          if (v === "object") { item.of = (item.of && typeof item.of === "object") ? item.of : {}; delete item.values; }
          else { item.of = v; if (v !== "enum") delete item.values; }
          emit(); render();
        });
        sub.appendChild(labeled("of", SIGNAL_HELP.of, ofSel));
        block.appendChild(sub);

        if (curOf === "enum") {
          const vrow = document.createElement("div"); vrow.className = "signal-subrow";
          const vsle = stringListEditor("values", item.values, (vals) => {
            if (vals.length) item.values = vals; else delete item.values; emit();
          });
          vsle.querySelector("label").appendChild(helpIcon(SIGNAL_HELP.values));
          vrow.appendChild(vsle);
          block.appendChild(vrow);
        }
        if (curOf === "object") {
          const orow = document.createElement("div"); orow.className = "signal-subrow signal-of-object";
          const obj = item.of;
          Object.keys(obj).forEach((field) => {
            const fr = document.createElement("div"); fr.className = "of-field-row";
            const fname = document.createElement("input"); fname.type = "text"; fname.value = field; fname.className = "of-field-name";
            fname.addEventListener("change", () => {
              const nv = fname.value.trim();
              // rename to an already-used name is a no-op (collision guard) —
              // re-render restores the input to the old name without moving anything
              if (nv && nv !== field && !(nv in obj)) {
                const next = { ...item.of };
                next[nv] = next[field];
                delete next[field];
                item.of = next;
                emit();
              }
              render();
            });
            const ftype = document.createElement("select"); ftype.className = "of-field-type";
            const cur = (obj[field] && typeof obj[field] === "object") ? "enum" : obj[field];
            for (const t of ["string", "number", "bool", "enum"]) { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === cur) o.selected = true; ftype.appendChild(o); }
            ftype.addEventListener("change", () => {
              const next = { ...item.of };
              next[field] = ftype.value === "enum" ? { enum: (obj[field] && obj[field].enum) || [] } : ftype.value;
              item.of = next;
              emit(); render();
            });
            const del = document.createElement("button"); del.className = "of-field-del"; del.textContent = "✕";
            del.addEventListener("click", () => {
              const next = { ...item.of };
              delete next[field];
              item.of = next;
              render(); emit();
            });
            const fnw = labeled("field", SIGNAL_HELP.of_field, fname);
            fnw.classList.add("grow");
            fr.appendChild(fnw);
            fr.appendChild(labeled("type", SIGNAL_HELP.of_field_type, ftype));
            fr.appendChild(del);
            orow.appendChild(fr);
            if (obj[field] && typeof obj[field] === "object") {
              const fsle = stringListEditor("values", obj[field].enum, (vals) => {
                const next = { ...item.of };
                next[field] = { enum: vals };
                item.of = next;
                emit();
              });
              fsle.querySelector("label").appendChild(helpIcon(SIGNAL_HELP.values));
              orow.appendChild(fsle);
            }
          });
          const addF = document.createElement("button"); addF.className = "of-field-add"; addF.textContent = "+ field";
          addF.addEventListener("click", () => {
            const next = { ...item.of };
            next["field" + (Object.keys(next).length + 1)] = "string";
            item.of = next;
            render(); emit();
          });
          orow.appendChild(addF);
          block.appendChild(orow);
        }
      }
    });
  }
  const add = document.createElement("button"); add.className = "signal-add"; add.textContent = "＋ add signal";
  add.addEventListener("click", () => { const s0 = sources[0]; list.push({ name: "", type: s0 === "exit_code" ? "bool" : "string", source: s0 }); render(); emit(); });
  render(); wrap.appendChild(add);
  return wrap;
}

const TRIGGER_ON = ["file_appears","file_changes","event","db_event","threshold_reached"];
const TRIGGER_KEYS = ["path","type","source","condition"];
const TRIGGER_HELP = "Triggers the phase when: a file appears/changes (fill in path), an event occurs (type/source), a database event happens (type), or a threshold is reached (condition). Leave empty the fields not relevant to the chosen type.";

export function triggerEditor(label, items, onChange){
  const wrap = document.createElement("div"); wrap.className = "trigger-editor";
  const head = document.createElement("label"); head.textContent = label + " "; head.appendChild(helpIcon(TRIGGER_HELP)); wrap.appendChild(head);
  const list = (items || []).map(x => ({ ...x }));
  const emit = () => onChange(list.map(x => ({ ...x })));
  const body = document.createElement("div"); wrap.appendChild(body);
  function render(){
    body.replaceChildren();
    list.forEach((item, idx) => {
      const r = document.createElement("div"); r.className = "trigger-row";
      const on = document.createElement("select"); on.dataset.k = "on";
      for (const v of TRIGGER_ON){ const o = document.createElement("option"); o.value = v; o.textContent = v; if (v === (item.on||TRIGGER_ON[0])) o.selected = true; on.appendChild(o); }
      on.addEventListener("change", () => { item.on = on.value; emit(); });
      r.appendChild(on);
      for (const k of TRIGGER_KEYS){
        const i = document.createElement("input"); i.type = "text"; i.dataset.k = k; i.placeholder = k; i.value = item[k] || "";
        i.addEventListener("change", () => { if (i.value) item[k] = i.value; else delete item[k]; emit(); });
        r.appendChild(i);
      }
      const del = document.createElement("button"); del.textContent = "✕";
      del.addEventListener("click", () => { list.splice(idx,1); render(); emit(); });
      r.appendChild(del);
      body.appendChild(r);
    });
  }
  const add = document.createElement("button"); add.className = "trigger-add"; add.textContent = "+ trigger";
  add.addEventListener("click", () => { list.push({ on: TRIGGER_ON[0] }); render(); emit(); });
  render(); wrap.appendChild(add);
  return wrap;
}
