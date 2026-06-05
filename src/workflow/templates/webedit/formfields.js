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
export function fieldCheckbox(label, checked, onChange){
  const r = row(label); r.classList.add("field-inline");
  const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!checked;
  c.addEventListener("change", () => onChange(c.checked));
  r.insertBefore(c, r.firstChild);
  return r;
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
      for (const f of IO_FLAGS){
        const lbl = document.createElement("label"); lbl.className = "ioref-flag";
        const c = document.createElement("input"); c.type = "checkbox"; c.dataset.k = f; c.checked = !!item[f];
        c.addEventListener("change", () => { if (c.checked) item[f] = true; else delete item[f]; emit(); });
        lbl.appendChild(c); lbl.appendChild(document.createTextNode(f));
        r.appendChild(lbl);
      }
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
  add.addEventListener("click", () => { list.push(""); render(); emit(); });
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
