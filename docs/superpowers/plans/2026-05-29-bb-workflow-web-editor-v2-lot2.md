# bb-workflow web editor v2 — Lot 2 (field coverage) Implementation Plan

> **For agentic workers:** TDD per task — bun tests for pure DOM/form helpers, Chrome harness for integration, commit per task. Steps use checkbox (`- [ ]`).

**Goal:** Make (nearly) the whole workflow schema editable from the GUI: phase `description`/`cmd`/`workflow`/`triggers`/`inputs`/`outputs`, full invocation fields (`description`/`background`/`skip_if`/`depends_on_invocation`/`inputs`/`outputs`), and top-level `skill.*`/`groups`/`conditions`/`on_demand_agents` — via small reusable, tested form builders so `editor.js` stays maintainable.

**Architecture:** Lot 2 is almost entirely front-end. The server already validates the full model on `/api/view` and on save (`validate_schema` + `validate_coherence`), so no new endpoints. New pure form-builder helpers live in `tests/webedit/formfields.js` (tested with bun) and are mirrored inline in `editor.js` (same single-file-serve pattern as Lot 1, documented). A new **"Réglages"** tab hosts the top-level editors; the per-phase panel gains the phase/invocation fields.

**Tech Stack:** vanilla JS (DOM builders), bun + linkedom tests, pytest (coherence already covers cross-refs), Chrome harness for live checks.

**Spec:** `docs/superpowers/specs/2026-05-29-bb-workflow-web-editor-v2-design.md`
**Builds on:** Lot 1 (`...-v2-lot1.md`).
**Lot 3 (after):** agent creation from GUI + non-blocking mermaid + rendered Dataflow tab.

---

## File Structure

- **Create** `claude-setup/scripts/tests/webedit/formfields.js` — pure builders: `fieldText`, `fieldTextarea`, `fieldSelect`, `fieldCheckbox`, `ioRefEditor`, `triggerEditor`. Each builds a DOM node and calls a callback on change. No innerHTML of data.
- **Modify** `claude-setup/scripts/tests/webedit/formfields.test.js` (new) — bun tests for every builder (value binding, change callback, anti-XSS).
- **Modify** `claude-setup/workflow/templates/webedit/editor.js` — mirror builders inline; extend phase panel; add Réglages tab logic.
- **Modify** `claude-setup/workflow/templates/webedit/editor.html` — add "Réglages" tab + panel container.
- **Modify** `claude-setup/workflow/templates/webedit/editor.css` — form rows, io-ref rows.
- **Modify** `claude-setup/scripts/tests/test_workflow_edit.py` — a save round-trip test that exercises io_refs + cmd + skip_if + on_demand to prove the model persists & validates.

Reused: `/api/view`, `/api/workflows`, `save_workflow`, `validate_coherence` (validates `skip_if`→conditions, `workflow`→file, agents).

---

## Task 1: Reusable form-field builders + bun tests

**Files:**
- Create: `claude-setup/scripts/tests/webedit/formfields.js`
- Create: `claude-setup/scripts/tests/webedit/formfields.test.js`

- [ ] **Step 1: Write the failing tests** — `formfields.test.js`:

```js
import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox } from "./formfields.js";

function dom(){ const { document } = parseHTML("<!DOCTYPE html><body></body>"); globalThis.document = document; return document; }

test("fieldText binds value and fires onChange", () => {
  dom();
  let got = null;
  const row = fieldText("name", "hello", v => { got = v; });
  const input = row.querySelector("input");
  expect(input.value).toBe("hello");
  input.value = "world"; input.dispatchEvent(new (globalThis.Event||row.ownerDocument.defaultView.Event)("change"));
  expect(got).toBe("world");
  // label is text, payload is inert
  expect(row.querySelector("label").textContent).toBe("name");
});

test("fieldTextarea binds multiline + anti-XSS", () => {
  dom();
  const row = fieldTextarea("desc", "<img onerror=x>\nline2", () => {});
  expect(row.querySelector("img")).toBeNull();
  expect(row.querySelector("textarea").value).toContain("line2");
});

test("fieldSelect selects current + lists options", () => {
  dom();
  let got=null;
  const row = fieldSelect("model", "sonnet", ["inherit","haiku","sonnet","opus"], v=>got=v);
  const sel = row.querySelector("select");
  expect(sel.value).toBe("sonnet");
  expect(sel.querySelectorAll("option").length).toBe(4);
  sel.value="opus"; sel.dispatchEvent(new sel.ownerDocument.defaultView.Event("change"));
  expect(got).toBe("opus");
});

test("fieldCheckbox binds boolean", () => {
  dom();
  let got=null;
  const row = fieldCheckbox("background", true, v=>got=v);
  const cb = row.querySelector("input[type=checkbox]");
  expect(cb.checked).toBe(true);
  cb.checked=false; cb.dispatchEvent(new cb.ownerDocument.defaultView.Event("change"));
  expect(got).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts/tests/webedit && bun test formfields.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `formfields.js`**

```js
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
  for (const opt of options){ const o = document.createElement("option"); o.textContent = opt; if (opt === value) o.selected = true; s.appendChild(o); }
  s.addEventListener("change", () => onChange(s.value));
  r.appendChild(s); return r;
}
export function fieldCheckbox(label, checked, onChange){
  const r = row(label); r.classList.add("field-inline");
  const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!checked;
  c.addEventListener("change", () => onChange(c.checked));
  r.insertBefore(c, r.firstChild);
  return r;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-setup/scripts/tests/webedit && bun test formfields.test.js`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/tests/webedit/formfields.js claude-setup/scripts/tests/webedit/formfields.test.js
git commit -m "test(bb-workflow): reusable form-field builders + bun tests"
```

---

## Task 2: io_ref list editor + bun tests

**Files:**
- Modify: `claude-setup/scripts/tests/webedit/formfields.js` (add `ioRefEditor`)
- Modify: `claude-setup/scripts/tests/webedit/formfields.test.js`

- [ ] **Step 1: Write the failing tests** — append:

```js
import { ioRefEditor } from "./formfields.js";

test("ioRefEditor renders rows and adds/removes", () => {
  dom();
  const list = [{ path: "a/b.md", kind: "md" }];
  let changed = null;
  const node = ioRefEditor("inputs", list, next => { changed = next; });
  // one existing row
  expect(node.querySelectorAll(".ioref-row").length).toBe(1);
  expect(node.querySelector(".ioref-row input[data-k=path]").value).toBe("a/b.md");
  expect(node.querySelector(".ioref-row select[data-k=kind]").value).toBe("md");
  // add a row
  node.querySelector(".ioref-add").dispatchEvent(new node.ownerDocument.defaultView.Event("click"));
  expect(changed.length).toBe(2);
  expect(changed[1].kind).toBe("json"); // default kind
});

test("ioRefEditor edits path/kind/flags through callback", () => {
  dom();
  const list = [{ path: "x", kind: "md" }];
  let changed = null;
  const node = ioRefEditor("outputs", list, next => { changed = next; });
  const pathIn = node.querySelector("input[data-k=path]");
  pathIn.value = "y/z.json"; pathIn.dispatchEvent(new node.ownerDocument.defaultView.Event("change"));
  expect(changed[0].path).toBe("y/z.json");
  const ext = node.querySelector("input[data-k=external]");
  ext.checked = true; ext.dispatchEvent(new node.ownerDocument.defaultView.Event("change"));
  expect(changed[0].external).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts/tests/webedit && bun test formfields.test.js`
Expected: FAIL (`ioRefEditor` missing).

- [ ] **Step 3: Implement `ioRefEditor`** in `formfields.js`:

```js
const IO_KINDS = ["json","jsonl","md","text","yaml","dir","sqlite","binary"];
const IO_FLAGS = ["optional","external","terminal"];

export function ioRefEditor(label, items, onChange){
  const wrap = document.createElement("div"); wrap.className = "ioref-editor";
  const head = document.createElement("label"); head.textContent = label; wrap.appendChild(head);
  const list = (items || []).map(x => ({ ...x }));
  const emit = () => onChange(list.map(x => ({ ...x })));
  const body = document.createElement("div"); wrap.appendChild(body);
  function render(){
    body.replaceChildren();
    list.forEach((item, idx) => {
      const r = document.createElement("div"); r.className = "ioref-row";
      const path = document.createElement("input"); path.type = "text"; path.dataset.k = "path";
      path.value = item.path || ""; path.placeholder = "path";
      path.addEventListener("change", () => { item.path = path.value; emit(); });
      r.appendChild(path);
      const kind = document.createElement("select"); kind.dataset.k = "kind";
      for (const k of IO_KINDS){ const o = document.createElement("option"); o.textContent = k; if ((item.kind||"json")===k) o.selected = true; kind.appendChild(o); }
      kind.addEventListener("change", () => { item.kind = kind.value; emit(); });
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
    });
  }
  const add = document.createElement("button"); add.className = "ioref-add"; add.textContent = "+ "+label;
  add.addEventListener("click", () => { list.push({ path: "", kind: "json" }); render(); emit(); });
  render(); wrap.appendChild(add);
  return wrap;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-setup/scripts/tests/webedit && bun test formfields.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/tests/webedit/formfields.js claude-setup/scripts/tests/webedit/formfields.test.js
git commit -m "test(bb-workflow): io_ref list editor builder + bun tests"
```

---

## Task 3: trigger list editor + bun tests

**Files:**
- Modify: `claude-setup/scripts/tests/webedit/formfields.js` (add `triggerEditor`)
- Modify: `claude-setup/scripts/tests/webedit/formfields.test.js`

- [ ] **Step 1: Write the failing tests** — append:

```js
import { triggerEditor } from "./formfields.js";

test("triggerEditor lists, adds, edits 'on'", () => {
  dom();
  const list = [{ on: "file_appears", path: "x" }];
  let changed = null;
  const node = triggerEditor("triggers", list, next => changed = next);
  expect(node.querySelectorAll(".trigger-row").length).toBe(1);
  expect(node.querySelector("select[data-k=on]").value).toBe("file_appears");
  node.querySelector(".trigger-add").dispatchEvent(new node.ownerDocument.defaultView.Event("click"));
  expect(changed.length).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts/tests/webedit && bun test formfields.test.js`
Expected: FAIL (`triggerEditor` missing).

- [ ] **Step 3: Implement `triggerEditor`** in `formfields.js`:

```js
const TRIGGER_ON = ["file_appears","file_changes","event","db_event","threshold_reached"];
const TRIGGER_KEYS = ["path","type","source","condition"];

export function triggerEditor(label, items, onChange){
  const wrap = document.createElement("div"); wrap.className = "trigger-editor";
  const head = document.createElement("label"); head.textContent = label; wrap.appendChild(head);
  const list = (items || []).map(x => ({ ...x }));
  const emit = () => onChange(list.map(x => ({ ...x })));
  const body = document.createElement("div"); wrap.appendChild(body);
  function render(){
    body.replaceChildren();
    list.forEach((item, idx) => {
      const r = document.createElement("div"); r.className = "trigger-row";
      const on = document.createElement("select"); on.dataset.k = "on";
      for (const v of TRIGGER_ON){ const o = document.createElement("option"); o.textContent = v; if ((item.on||TRIGGER_ON[0])===v) o.selected = true; on.appendChild(o); }
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
```

- [ ] **Step 4: Run to verify it passes**

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/tests/webedit/formfields.js claude-setup/scripts/tests/webedit/formfields.test.js
git commit -m "test(bb-workflow): trigger list editor builder + bun tests"
```

---

## Task 4: Extend phase panel — description, cmd, workflow, triggers, io_refs

**Files:**
- Modify: `claude-setup/workflow/templates/webedit/editor.js` (mirror builders inline; extend `selectPhase`)
- Modify: `claude-setup/workflow/templates/webedit/editor.css`

- [ ] **Step 1: Mirror the builders inline** in `editor.js` — paste `fieldText`, `fieldTextarea`, `fieldSelect`, `fieldCheckbox`, `ioRefEditor`, `triggerEditor`, the `row()` helper, and the `IO_KINDS`/`IO_FLAGS`/`TRIGGER_ON`/`TRIGGER_KEYS` consts, exactly as in `formfields.js` (single-file-serve mirror, like Lot 1's editlogic copy).

- [ ] **Step 2: Extend `selectPhase`** to append, after the existing depends_on block (keep id/name/type/group/depends_on as in Lot 1):

```js
  // description (all types)
  panel.appendChild(fieldTextarea("description", p.description, v=>{ if(v) p.description=v; else delete p.description; refreshView(); }));
  // type-specific
  if(p.type==="script")
    panel.appendChild(fieldTextarea("cmd", p.cmd, v=>{ if(v) p.cmd=v; else delete p.cmd; refreshView(); }));
  if(p.type==="workflow_call"){
    const wfList = state.workflows || [];
    panel.appendChild(fieldSelect("workflow", p.workflow||"", ["", ...wfList.filter(n=>n!==state.name)], v=>{ if(v) p.workflow=v; else delete p.workflow; refreshView(); }));
  }
  // phase-level triggers + io
  panel.appendChild(triggerEditor("triggers", p.triggers||[], next=>{ if(next.length) p.triggers=next; else delete p.triggers; refreshView(); }));
  panel.appendChild(ioRefEditor("inputs", p.inputs||[], next=>{ if(next.length) p.inputs=next; else delete p.inputs; refreshView(); }));
  panel.appendChild(ioRefEditor("outputs", p.outputs||[], next=>{ if(next.length) p.outputs=next; else delete p.outputs; refreshView(); }));
```

And in `loadList`, capture the workflow list for the picker: after fetching `j`, set `state.workflows = j;` (so `selectPhase` can populate the workflow_call select).

- [ ] **Step 3: Add CSS** — append to `editor.css`:

```css
.field{margin-top:8px}
.field-inline{display:flex;align-items:center;gap:6px}
.field-inline label{margin:0}
#edit-panel textarea{width:100%;background:#121a24;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px;font:12px/1.4 ui-monospace,monospace}
.ioref-row,.trigger-row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;border-top:1px solid #1b2530;padding-top:4px}
.ioref-row input[data-k=path],.trigger-row input{flex:1 1 90px;min-width:70px}
.ioref-flag{display:flex;align-items:center;gap:2px;font-size:10px;text-transform:none}
.ioref-add,.trigger-add{margin-top:6px;font-size:11px}
.ioref-del,.trigger-row button{background:none;border:none;color:#a55;cursor:pointer}
```

- [ ] **Step 4: Verify in the Chrome harness.**

Build a harness (CSS+JS inlined, fetch stub returning real `/api/view` derivations and `/api/workflows`=['x','other']) loading a model with a `script` phase and a `workflow_call` phase. In Chrome: select the script phase → assert a `cmd` textarea exists; select the workflow_call phase → assert a `workflow` select with options; add an input io_ref → assert the model's `inputs` grows; assert `window.__errors` is empty. (Reuse the Lot 1 harness-builder Python snippet pattern.)

Expected: cmd textarea present for script, workflow select present for workflow_call, io_ref add mutates model, no JS errors.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/workflow/templates/webedit/editor.js claude-setup/workflow/templates/webedit/editor.css
git commit -m "feat(bb-workflow): phase panel covers description/cmd/workflow/triggers/io_refs"
```

---

## Task 5: Invocations — full fields editor

**Files:**
- Modify: `claude-setup/workflow/templates/webedit/editor.js` (`selectPhase`: invocations section)

- [ ] **Step 1: Add an invocations editor** in `selectPhase`, after the io_refs. For each invocation in `p.invocations` (and an "+ invocation" picker of `state.agents`), render a sub-block:

```js
  const invWrap=document.createElement("div"); invWrap.className="inv-block";
  const invHead=document.createElement("label"); invHead.textContent="invocations"; invWrap.appendChild(invHead);
  (p.invocations||[]).forEach((inv,idx)=>{
    const box=document.createElement("div"); box.className="inv-card";
    const title=document.createElement("div"); title.className="inv-name"; title.textContent=inv.agent; box.appendChild(title);
    box.appendChild(fieldSelect("model", inv.model||"inherit", ["inherit","haiku","sonnet","opus"], v=>{inv.model=v; refreshView();}));
    box.appendChild(fieldTextarea("description", inv.description, v=>{ if(v) inv.description=v; else delete inv.description; refreshView();}));
    box.appendChild(fieldCheckbox("background", inv.background, v=>{ if(v) inv.background=true; else delete inv.background; refreshView();}));
    const conds=["", ...Object.keys(state.model.conditions||{})];
    box.appendChild(fieldSelect("skip_if", inv.skip_if||"", conds, v=>{ if(v) inv.skip_if=v; else delete inv.skip_if; refreshView();}));
    const siblings=["", ...(p.invocations||[]).filter(x=>x!==inv).map(x=>x.agent)];
    box.appendChild(fieldSelect("depends_on_invocation", inv.depends_on_invocation||"", siblings, v=>{ if(v) inv.depends_on_invocation=v; else delete inv.depends_on_invocation; refreshView();}));
    box.appendChild(triggerEditor("inv triggers", inv.triggers||[], next=>{ if(next.length) inv.triggers=next; else delete inv.triggers; refreshView();}));
    box.appendChild(ioRefEditor("inv inputs", inv.inputs||[], next=>{ if(next.length) inv.inputs=next; else delete inv.inputs; refreshView();}));
    box.appendChild(ioRefEditor("inv outputs", inv.outputs||[], next=>{ if(next.length) inv.outputs=next; else delete inv.outputs; refreshView();}));
    const editPrompt=document.createElement("button"); editPrompt.textContent="✎ prompt"; editPrompt.addEventListener("click",()=>openPrompt(inv.agent)); box.appendChild(editPrompt);
    const rm=document.createElement("button"); rm.textContent="✕ retirer"; rm.addEventListener("click",()=>{p.invocations.splice(idx,1); if(!p.invocations.length) delete p.invocations; refreshView().then(()=>selectPhase(id));}); box.appendChild(rm);
    invWrap.appendChild(box);
  });
  if((state.agents||[]).length){
    const pick=document.createElement("select");
    const o0=document.createElement("option"); o0.value=""; o0.textContent="+ invocation (agent)…"; pick.appendChild(o0);
    state.agents.forEach(a=>{const o=document.createElement("option"); o.textContent=a; pick.appendChild(o);});
    pick.addEventListener("change",()=>{ if(!pick.value)return; p.invocations=p.invocations||[]; if(!p.invocations.some(i=>i.agent===pick.value)) p.invocations.push({agent:pick.value,model:"inherit"}); refreshView().then(()=>selectPhase(id)); });
    invWrap.appendChild(pick);
  }
  panel.appendChild(invWrap);
```

Also: load agents in `loadList` (`state.agents=(await api('GET','/api/agents')).j||[];`) and add a minimal `openPrompt(agent)` that reuses a prompt modal (GET/PUT `/api/invocation/<agent>`) — reuse the `showNotice`-style overlay with a `<textarea>` and a save button calling `PUT /api/invocation/<agent>`.

- [ ] **Step 2: Add `openPrompt`** near `showNotice`:

```js
async function openPrompt(agent){
  const {j}=await api('GET','/api/invocation/'+agent);
  document.querySelectorAll(".notice-overlay").forEach(n=>n.remove());
  const ov=document.createElement("div"); ov.className="notice-overlay";
  const box=document.createElement("div"); box.className="notice-box";
  const h=document.createElement("div"); h.className="notice-title"; h.textContent="Prompt — "+agent; box.appendChild(h);
  const ta=document.createElement("textarea"); ta.rows=16; ta.value=j.prompt||""; ta.style.width="100%"; box.appendChild(ta);
  const save=document.createElement("button"); save.textContent="enregistrer le prompt";
  const st=document.createElement("span"); st.className="muted";
  save.addEventListener("click",async()=>{ const r=await api('PUT','/api/invocation/'+agent,{prompt:ta.value}); st.textContent=r.status===200?"✓":"✗"; });
  const close=document.createElement("button"); close.textContent="fermer"; close.addEventListener("click",()=>ov.remove());
  box.appendChild(save); box.appendChild(close); box.appendChild(st); ov.appendChild(box);
  document.body.appendChild(ov);
}
```

- [ ] **Step 3: Verify in Chrome harness** — model with a phase having one invocation. Select it: assert model/description/background/skip_if/depends_on_invocation controls exist; toggling background mutates `inv.background`; selecting a condition sets `skip_if`; "✎ prompt" opens an overlay with a textarea; no JS errors.

- [ ] **Step 4: Commit**

```bash
git add claude-setup/workflow/templates/webedit/editor.js
git commit -m "feat(bb-workflow): full invocation editor (model/desc/background/skip_if/deps/io/prompt)"
```

---

## Task 6: "Réglages" tab — skill, groups, conditions, on_demand_agents

**Files:**
- Modify: `claude-setup/workflow/templates/webedit/editor.html` (tab + panel)
- Modify: `claude-setup/workflow/templates/webedit/editor.js` (render settings)
- Modify: `claude-setup/workflow/templates/webedit/editor.css`

- [ ] **Step 1: Add the tab + panel** in `editor.html`:

In `<nav id="tabs">` add: `<button class="tab" data-tab="settings">Réglages</button>`.
In `<main>` add: `<section id="panel-settings" class="panel"><div id="settings"></div></section>`.

- [ ] **Step 2: Implement `renderSettings()`** in `editor.js` (called when the settings tab is shown and after load):

```js
function renderSettings(){
  const root=$('#settings'); if(!root||!state.model)return; root.replaceChildren();
  const m=state.model; m.skill=m.skill||{};
  const sec=(t)=>{const h=document.createElement("h3"); h.textContent=t; h.className="settings-h"; root.appendChild(h);};
  sec("skill");
  root.appendChild(fieldText("name", m.skill.name||"", v=>{m.skill.name=v;}));
  root.appendChild(fieldTextarea("description", m.skill.description||"", v=>{m.skill.description=v;}));
  root.appendChild(fieldText("title", m.skill.title||"", v=>{ if(v) m.skill.title=v; else delete m.skill.title; }));
  // groups
  sec("groups");
  m.groups=m.groups||{};
  Object.keys(m.groups).forEach(g=>{
    const box=document.createElement("div"); box.className="settings-row";
    const nm=document.createElement("input"); nm.value=g; nm.addEventListener("change",()=>{ if(nm.value&&nm.value!==g){ m.groups[nm.value]=m.groups[g]; delete m.groups[g]; (m.phases||[]).forEach(p=>{if(p.group===g)p.group=nm.value;}); renderSettings(); refreshView(); } });
    box.appendChild(nm);
    box.appendChild(fieldText("description", m.groups[g].description||"", v=>{m.groups[g].description=v;}));
    box.appendChild(fieldSelect("risk", m.groups[g].risk||"none", ["none","low","medium","high"], v=>{m.groups[g].risk=v;}));
    const del=document.createElement("button"); del.textContent="✕"; del.addEventListener("click",()=>{ delete m.groups[g]; renderSettings(); refreshView(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addG=document.createElement("button"); addG.textContent="+ groupe"; addG.addEventListener("click",()=>{ let n="group",i=1; while(m.groups[n])n="group"+(++i); m.groups[n]={description:""}; renderSettings(); refreshView(); }); root.appendChild(addG);
  // conditions
  sec("conditions");
  m.conditions=m.conditions||{};
  Object.keys(m.conditions).forEach(c=>{
    const box=document.createElement("div"); box.className="settings-row";
    const nm=document.createElement("input"); nm.value=c; nm.addEventListener("change",()=>{ if(nm.value&&nm.value!==c){ m.conditions[nm.value]=m.conditions[c]; delete m.conditions[c]; renderSettings(); } });
    box.appendChild(nm);
    box.appendChild(fieldSelect("check", m.conditions[c].check||"file_exists", ["file_missing","file_exists","dir_missing","dir_exists"], v=>{m.conditions[c].check=v;}));
    box.appendChild(fieldText("path", m.conditions[c].path||"", v=>{ if(v) m.conditions[c].path=v; else delete m.conditions[c].path; }));
    const del=document.createElement("button"); del.textContent="✕"; del.addEventListener("click",()=>{ delete m.conditions[c]; renderSettings(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addC=document.createElement("button"); addC.textContent="+ condition"; addC.addEventListener("click",()=>{ let n="cond",i=1; while(m.conditions[n])n="cond"+(++i); m.conditions[n]={check:"file_exists"}; renderSettings(); }); root.appendChild(addC);
  // on_demand_agents
  sec("on_demand_agents");
  m.on_demand_agents=m.on_demand_agents||[];
  m.on_demand_agents.forEach((od,idx)=>{
    const box=document.createElement("div"); box.className="settings-row";
    box.appendChild(fieldSelect("agent", od.agent||"", ["", ...(state.agents||[])], v=>{od.agent=v;}));
    box.appendChild(fieldText("description", od.description||"", v=>{od.description=v;}));
    box.appendChild(fieldSelect("model", od.model||"inherit", ["inherit","haiku","sonnet","opus"], v=>{od.model=v;}));
    box.appendChild(fieldText("when", od.when||"", v=>{ if(v) od.when=v; else delete od.when; }));
    const del=document.createElement("button"); del.textContent="✕"; del.addEventListener("click",()=>{ m.on_demand_agents.splice(idx,1); renderSettings(); }); box.appendChild(del);
    root.appendChild(box);
  });
  const addO=document.createElement("button"); addO.textContent="+ on-demand agent"; addO.addEventListener("click",()=>{ m.on_demand_agents.push({agent:(state.agents||[])[0]||"",description:""}); renderSettings(); }); root.appendChild(addO);
}
```

Wire it: in the tab click handler add `if(t.dataset.tab==='settings') renderSettings();`. Note these edits mutate the model but several don't need `/api/view` (no layout impact) — they persist on save; group rename calls `refreshView` because phases' group changes don't move levels but keep the grid consistent.

- [ ] **Step 3: Add CSS** — append:

```css
.settings-h{margin:14px 0 4px;color:var(--accent);font-size:13px}
.settings-row{border:1px solid var(--border);border-radius:6px;padding:6px;margin-top:6px}
#settings input,#settings select,#settings textarea{width:100%;background:#121a24;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px}
```

- [ ] **Step 4: Verify in Chrome harness** — load a model; switch to Réglages tab; assert skill name/description inputs reflect the model; add a group → `model.groups` grows; add a condition → `model.conditions` grows; rename a group → phases using it update; no JS errors.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/workflow/templates/webedit/
git commit -m "feat(bb-workflow): Réglages tab — skill, groups, conditions, on_demand_agents"
```

---

## Task 7: round-trip save test + full suites + live gate

**Files:**
- Modify: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write a save round-trip test** covering the new fields:

```python
def test_save_roundtrips_full_fields(bbw_module, tmp_path):
    agents_dir = tmp_path / "agents"; agents_dir.mkdir()
    (agents_dir / "a1.md").write_text("---\nname: a1\n---\n")
    model = {"schema_version": 1, "skill": {"name": "full-flow", "description": "d", "title": "T"},
             "groups": {"g": {"description": "x", "risk": "low"}},
             "conditions": {"ready": {"check": "file_exists", "path": "x.md"}},
             "on_demand_agents": [{"agent": "a1", "description": "od"}],
             "phases": [
                 {"id": "P0", "name": "p0", "group": "g", "type": "main_agent"},
                 {"id": "P1", "name": "p1", "group": "g", "type": "agent", "depends_on": ["P0"],
                  "description": "does things",
                  "invocations": [{"agent": "a1", "model": "sonnet", "description": "inv",
                                   "background": True, "skip_if": "ready",
                                   "inputs": [{"path": "in.md", "kind": "md"}],
                                   "outputs": [{"path": "out/", "kind": "dir", "terminal": True}]}],
                  "inputs": [{"path": "src.json", "kind": "json", "external": True}]},
             ]}
    errs = bbw_module.save_workflow("full-flow", model, workflows_dir=tmp_path, agents_dir=agents_dir)
    assert errs == [], errs
    saved = yaml.safe_load((tmp_path / "full-flow.yaml").read_text())
    p1 = [p for p in saved["phases"] if p["id"] == "P1"][0]
    assert p1["invocations"][0]["skip_if"] == "ready"
    assert p1["invocations"][0]["outputs"][0]["terminal"] is True
    assert p1["inputs"][0]["external"] is True
    assert saved["conditions"]["ready"]["check"] == "file_exists"
    assert saved["on_demand_agents"][0]["agent"] == "a1"
```

- [ ] **Step 2: Run to verify it passes** (the model is schema- and coherence-valid; `a1` exists):

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k roundtrips_full -v`
Expected: PASS. (If coherence rejects something, read the error and fix the test model — do not weaken validation.)

- [ ] **Step 3: Run both full suites**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/ -q --deselect "tests/test_workflow_realfile.py::test_real_skill_has_no_drift[test]"`
Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: all green.

- [ ] **Step 4: Live gate (hunter relaunches `bb-workflow edit`; agent drives Chrome).**

Verify on `demo` (which uses cmd/triggers/io_refs heavily): edit a phase description, add an input io_ref, edit an invocation's skip_if, open Réglages and add a group/condition, save → file valid (`bb-workflow validate`), then `git checkout` to discard. Report each step.

- [ ] **Step 5: Commit, then write the Lot 3 plan.**

```bash
git add claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "test(bb-workflow): save round-trips full field coverage"
```

---

## Self-Review Notes

- **Spec coverage (Lot 2):** phase description/cmd/workflow/triggers/io_refs (T4), full invocation fields incl. prompt (T5), skill/groups/conditions/on_demand_agents (T6), persisted+validated round-trip (T7). Reuses `/api/view` + `save_workflow` (no new endpoints). `brainstormings`/`manual_sections` remain YAML-only per spec.
- **Duplication:** form builders live in `formfields.js` (tested) and are mirrored inline in `editor.js` (documented single-file-serve pattern, as in Lot 1). If this becomes painful, Lot 3 can serve `formfields.js`/`editlogic.js` as real modules from a `/editor/*.js` route and `import` them — single source. Flagged.
- **Type consistency:** builders `fieldText/Textarea/Select/Checkbox(label, value, [options], onChange)`, `ioRefEditor(label, items, onChange→items[])`, `triggerEditor(label, items, onChange→items[])`; `state.workflows` and `state.agents` populated in `loadList`; `openPrompt(agent)` uses `/api/invocation/<agent>`.
- **Known limitation:** field edits that don't affect layout still call `refreshView()` for validation feedback; that's an extra round-trip per change on a localhost tool (acceptable). Group rename rewrites phase `group` refs.
