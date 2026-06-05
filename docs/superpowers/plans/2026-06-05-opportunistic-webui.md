# Opportunistic in the Web Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `opportunistic` field authorable, visible, and previewable in the `awok edit` web editor — a per-phase "🧭 Autonomy" tab, a global default in Settings, 🧭/⛔ badges on the DAG grid, and a live resolved-state preview.

**Architecture:** Pure model helpers in `editlogic.js` + a `stringListEditor` widget in `formfields.js` (both bun-tested), wired into `editor.js` (new tab, settings section, grid badge). The DAG grid badges and the resolved preview are fed by the **server**: `/api/view` is extended to return `resolve_opportunistic`'s output per phase, so the front-end never re-implements precedence.

**Tech Stack:** ES-module front-end (no bundler), `bun test` + `linkedom` for the front-end, Python stdlib + PyYAML + Jinja2 for `bb-workflow`, `pytest` for the backend.

**Spec:** `docs/superpowers/specs/2026-06-05-opportunistic-webui-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/workflow/templates/webedit/formfields.js` | reusable DOM widgets | add `stringListEditor` |
| `src/workflow/templates/webedit/editlogic.js` | pure model/logic helpers (bun-tested) | add 6 opportunistic helpers |
| `src/workflow/templates/webedit/render-helpers.js` | DOM builders | `makeCard` gains an `oppMark` arg → badge |
| `src/workflow/templates/webedit/editor.js` | app glue | import helpers; `tabAutonomy` + tab; Settings global section; `makeRow` passes the mark |
| `src/workflow/templates/webedit/editor.css` | styles | badge styles |
| `src/scripts/bb-workflow` | `awok edit` server | `build_opportunistic_view` + `/api/view` includes it |
| `src/scripts/tests/webedit/formfields.test.js` | front-end tests | `stringListEditor` |
| `src/scripts/tests/webedit/render.test.js` | front-end tests | model helpers + `makeCard` badge |
| `src/scripts/tests/test_workflow_opportunistic.py` | backend tests | `build_opportunistic_view` |

Front-end tests run with: `cd src/scripts/tests/webedit && bun test`. Backend tests: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_opportunistic.py -v` (from repo root).

---

## Task 1: `stringListEditor` widget

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` (append a new export)
- Test: `src/scripts/tests/webedit/formfields.test.js` (append)

- [ ] **Step 1: Write the failing test**

In `src/scripts/tests/webedit/formfields.test.js`, change the import line at the top to add `stringListEditor`:

```javascript
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor, resolveIoPath, stringListEditor } from "../../../workflow/templates/webedit/formfields.js";
```

Then append this test at the end of the file:

```javascript
test("stringListEditor renders, adds, deletes, drops empties", () => {
  dom();
  const items = ["old dep → CVE", ""]; let got = null;
  const node = stringListEditor("examples", items, v => got = v);
  expect(node.querySelectorAll(".stringlist-row").length).toBe(2);
  // add a row
  node.querySelector(".stringlist-add").dispatchEvent(click(node));
  expect(node.querySelectorAll(".stringlist-row").length).toBe(3);
  // fill the new row and fire change
  const inputs = node.querySelectorAll(".stringlist-row input");
  inputs[2].value = "WordPress → recon"; inputs[2].dispatchEvent(ev(inputs[2]));
  // emit drops the empty middle row, trims, keeps order
  expect(got).toEqual(["old dep → CVE", "WordPress → recon"]);
  // delete the first row
  node.querySelector(".stringlist-row .stringlist-del").dispatchEvent(click(node));
  expect(node.querySelectorAll(".stringlist-row").length).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: FAIL — `stringListEditor` is not exported (import is `undefined`).

- [ ] **Step 3: Implement the widget**

In `src/workflow/templates/webedit/formfields.js`, append at the end of the file:

```javascript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: PASS (all formfields tests green).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/formfields.js src/scripts/tests/webedit/formfields.test.js
git commit -m "feat(awok-webedit): stringListEditor widget (plain string list)"
```

---

## Task 2: Pure opportunistic model helpers

**Files:**
- Modify: `src/workflow/templates/webedit/editlogic.js` (append 6 exports)
- Test: `src/scripts/tests/webedit/render.test.js` (append; render.test.js imports from editlogic.js)

- [ ] **Step 1: Write the failing tests**

In `src/scripts/tests/webedit/render.test.js`, change the editlogic import line to add the new helpers:

```javascript
import { computeDropDepends, renderEdges, descendantIds, safeDropDepends,
         blockedDependents, buildNotice, aggregateInvocationIo, applyPhaseGroup,
         opportunisticMode, opportunisticGuidance, setOpportunistic,
         globalOpportunisticState, setGlobalOpportunistic, resolvedOppLabel } from "../../../workflow/templates/webedit/editlogic.js";
```

Append these tests at the end of the file:

```javascript
test("opportunisticMode maps raw value to UI mode", () => {
  expect(opportunisticMode({})).toBe("inherit");
  expect(opportunisticMode({ opportunistic: false })).toBe("locked");
  expect(opportunisticMode({ opportunistic: true })).toBe("enabled");
  expect(opportunisticMode({ opportunistic: { when: "x" } })).toBe("enabled");
});

test("opportunisticGuidance reads object guidance", () => {
  expect(opportunisticGuidance({})).toEqual({ when: "", examples: [] });
  expect(opportunisticGuidance({ opportunistic: true })).toEqual({ when: "", examples: [] });
  expect(opportunisticGuidance({ opportunistic: { when: "w", examples: ["e"] } }))
    .toEqual({ when: "w", examples: ["e"] });
});

test("setOpportunistic serializes minimally", () => {
  let p = { opportunistic: { when: "x" } };
  setOpportunistic(p, "inherit"); expect("opportunistic" in p).toBe(false);
  p = {}; setOpportunistic(p, "locked"); expect(p.opportunistic).toBe(false);
  p = {}; setOpportunistic(p, "enabled", "", []); expect(p.opportunistic).toBe(true);
  p = {}; setOpportunistic(p, "enabled", "  w  ", ["a", " ", "b"]);
  expect(p.opportunistic).toEqual({ when: "w", examples: ["a", "b"] });
  p = {}; setOpportunistic(p, "enabled", "", ["only"]);
  expect(p.opportunistic).toEqual({ examples: ["only"] });
});

test("globalOpportunisticState reads the top-level value", () => {
  expect(globalOpportunisticState({})).toEqual({ enabled: false, when: "", examples: [] });
  expect(globalOpportunisticState({ opportunistic: true })).toEqual({ enabled: true, when: "", examples: [] });
  expect(globalOpportunisticState({ opportunistic: { enabled: true, when: "w", examples: ["e"] } }))
    .toEqual({ enabled: true, when: "w", examples: ["e"] });
  expect(globalOpportunisticState({ opportunistic: false }).enabled).toBe(false);
});

test("setGlobalOpportunistic keeps enabled:true in object form", () => {
  let m = {}; setGlobalOpportunistic(m, false); expect("opportunistic" in m).toBe(false);
  m = {}; setGlobalOpportunistic(m, true, "", []); expect(m.opportunistic).toBe(true);
  m = {}; setGlobalOpportunistic(m, true, "w", ["e"]);
  expect(m.opportunistic).toEqual({ enabled: true, when: "w", examples: ["e"] });
});

test("resolvedOppLabel maps the /api/view block", () => {
  const v = { phases: {
    A: { mark: "opportunistic", note_kind: "short", enabled: true },
    B: { mark: "locked", note_kind: "locked", enabled: false },
    C: { mark: null, note_kind: null, enabled: true },
    D: { mark: null, note_kind: null, enabled: false },
  } };
  expect(resolvedOppLabel(v, "A")).toContain("Targeted lead");
  expect(resolvedOppLabel(v, "B")).toContain("Locked");
  expect(resolvedOppLabel(v, "C")).toContain("Inherited");
  expect(resolvedOppLabel(v, "D")).toBe("Off");
  expect(resolvedOppLabel(v, "missing")).toBe("");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/scripts/tests/webedit && bun test render.test.js`
Expected: FAIL — the new helpers are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/workflow/templates/webedit/editlogic.js`, append at the end of the file:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/scripts/tests/webedit && bun test render.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/editlogic.js src/scripts/tests/webedit/render.test.js
git commit -m "feat(awok-webedit): pure opportunistic model helpers (mode/guidance/serialize/label)"
```

---

## Task 3: Backend — `/api/view` returns the resolved opportunistic block

**Files:**
- Modify: `src/scripts/bb-workflow` (add `build_opportunistic_view` near `resolve_opportunistic`; include it in the `/api/view` response ~line 2707-2715)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Web editor: /api/view opportunistic block ---

def test_build_opportunistic_view(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"] = [
        {"id": "A", "name": "a", "group": "g", "opportunistic": {"when": "w"}},
        {"id": "B", "name": "b", "group": "g", "opportunistic": False},
        {"id": "C", "name": "c", "group": "g"},
    ]
    view = bbw_module.build_opportunistic_view(wf)
    assert view["global_enabled"] is True
    assert view["phases"]["A"] == {"mark": "opportunistic", "note_kind": "short", "enabled": True}
    assert view["phases"]["B"] == {"mark": "locked", "note_kind": "locked", "enabled": False}
    assert view["phases"]["C"] == {"mark": None, "note_kind": None, "enabled": True}
    # the caller's model is not mutated (no _opp leaks onto the source dict)
    assert "_opp" not in wf["phases"][0]


def test_build_opportunistic_view_global_off(bbw_module):
    wf = _base_wf()
    wf["phases"] = [{"id": "A", "name": "a", "group": "g"}]
    view = bbw_module.build_opportunistic_view(wf)
    assert view["global_enabled"] is False
    assert view["phases"]["A"] == {"mark": None, "note_kind": None, "enabled": False}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k build_opportunistic_view -v`
Expected: FAIL — `module 'bbw' has no attribute 'build_opportunistic_view'`.

- [ ] **Step 3: Implement `build_opportunistic_view`**

In `src/scripts/bb-workflow`, immediately AFTER the `resolve_opportunistic` function, add:

```python
def build_opportunistic_view(model: dict) -> dict:
    """Editor view block: the resolved opportunistic state per phase plus the
    global flag. Resolves on a deep copy so the caller's model is untouched."""
    import copy
    m = copy.deepcopy(model)
    g = resolve_opportunistic(m)
    phases = {}
    for ph in m.get("phases", []):
        opp = ph.get("_opp") or {}
        phases[ph.get("id")] = {
            "mark": opp.get("mark"),
            "note_kind": opp.get("note_kind"),
            "enabled": bool(opp.get("enabled", False)),
        }
    return {"global_enabled": bool(g["enabled"]), "phases": phases}
```

- [ ] **Step 4: Wire it into the `/api/view` response**

In `src/scripts/bb-workflow`, find the `/api/view` handler (~line 2707):

```python
            if p == "/api/view":
                levels = compute_levels(data)
                return self._json(200, {
                    "levels": levels,
                    "columns": derive_columns(data, levels),
                    "parallel_with": derive_parallel_with(data, levels),
                    "edges": build_edges(data),
                    "errors": validate_schema(data),
                })
```

Replace with (add the `opportunistic` key LAST, so `validate_schema(data)` runs on the untouched `data` first):

```python
            if p == "/api/view":
                levels = compute_levels(data)
                return self._json(200, {
                    "levels": levels,
                    "columns": derive_columns(data, levels),
                    "parallel_with": derive_parallel_with(data, levels),
                    "edges": build_edges(data),
                    "errors": validate_schema(data),
                    "opportunistic": build_opportunistic_view(data),
                })
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k build_opportunistic_view -v`
Expected: PASS.

- [ ] **Step 6: No-regression on the full suite**

Run: `.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok-webedit): /api/view returns resolved opportunistic marks per phase"
```

---

## Task 4: Grid badge on phase cards

**Files:**
- Modify: `src/workflow/templates/webedit/render-helpers.js` (`makeCard` signature + badge)
- Modify: `src/workflow/templates/webedit/editor.css` (badge style)
- Test: `src/scripts/tests/webedit/render.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/webedit/render.test.js`:

```javascript
test("makeCard shows the opportunistic / locked badge from oppMark", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>"); globalThis.document = document;
  const a = makeCard({ id: "A", name: "a", type: "agent" }, null, "opportunistic");
  expect(a.querySelector(".opp-badge.opp-on").textContent).toBe("🧭");
  const b = makeCard({ id: "B", name: "b", type: "agent" }, null, "locked");
  expect(b.querySelector(".opp-badge.opp-locked").textContent).toBe("⛔");
  const c = makeCard({ id: "C", name: "c", type: "agent" }, null, null);
  expect(c.querySelector(".opp-badge")).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/scripts/tests/webedit && bun test render.test.js`
Expected: FAIL — no `.opp-badge` element (makeCard ignores the 3rd arg).

- [ ] **Step 3: Add the badge to `makeCard`**

In `src/workflow/templates/webedit/render-helpers.js`, change the `makeCard` signature and add the badge. Find:

```javascript
export function makeCard(phase, color) {
```

Replace with:

```javascript
export function makeCard(phase, color, oppMark) {
```

Then find (inside `makeCard`):

```javascript
  const pid = document.createElement("div");
  pid.className = "pid";
  pid.textContent = phase.id + " ";
  const badge = document.createElement("span");
```

Replace with:

```javascript
  const pid = document.createElement("div");
  pid.className = "pid";
  pid.textContent = phase.id + " ";
  if (oppMark === "opportunistic" || oppMark === "locked") {
    const ob = document.createElement("span");
    ob.className = "opp-badge " + (oppMark === "locked" ? "opp-locked" : "opp-on");
    ob.textContent = oppMark === "locked" ? "⛔" : "🧭";
    ob.title = oppMark === "locked" ? "opportunism locked" : "opportunistic autonomy";
    pid.appendChild(ob);
  }
  const badge = document.createElement("span");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/scripts/tests/webedit && bun test render.test.js`
Expected: PASS.

- [ ] **Step 5: Add badge CSS**

In `src/workflow/templates/webedit/editor.css`, append at the end of the file:

```css
/* opportunistic markers on grid cards */
.opp-badge{ margin-left:4px; font-size:11px; vertical-align:middle; }
.opp-badge.opp-on{ filter:saturate(1.3); }
.opp-badge.opp-locked{ opacity:.85; }
.opp-resolved{ margin-top:8px; padding:6px 8px; border-radius:4px;
  background:#0e1620; color:#cbd5e1; font-size:12px; }
```

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/render-helpers.js src/workflow/templates/webedit/editor.css src/scripts/tests/webedit/render.test.js
git commit -m "feat(awok-webedit): 🧭/⛔ opportunistic badge on grid phase cards"
```

---

## Task 5: Editor integration — Autonomy tab, Settings section, grid wiring

**Files:**
- Modify: `src/workflow/templates/webedit/editor.js` (imports; `tabAutonomy`; register tab; `makeRow` passes the mark; global Settings section)

This task is app glue. The pure logic it calls is already unit-tested (Tasks 2 & 4); correctness is verified by running the existing bun suite (no regression) and by the visual check in Task 6.

- [ ] **Step 1: Extend the imports**

In `src/workflow/templates/webedit/editor.js`, find the two import lines:

```javascript
import { computeDropDepends, safeDropDepends, blockedDependents,
         buildNotice, renderEdges, aggregateInvocationIo, applyPhaseGroup } from "./editlogic.js";
import { makeCard, section, helpNote, helpIcon, labelWithHelp } from "./render-helpers.js";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor } from "./formfields.js";
```

Replace with:

```javascript
import { computeDropDepends, safeDropDepends, blockedDependents,
         buildNotice, renderEdges, aggregateInvocationIo, applyPhaseGroup,
         opportunisticMode, opportunisticGuidance, setOpportunistic,
         globalOpportunisticState, setGlobalOpportunistic, resolvedOppLabel } from "./editlogic.js";
import { makeCard, section, helpNote, helpIcon, labelWithHelp } from "./render-helpers.js";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor, stringListEditor } from "./formfields.js";
```

- [ ] **Step 2: Pass the resolved mark to each grid card**

In `editor.js`, find this line inside `makeRow`:

```javascript
    const card=makeCard(byId[id], (colors||{})[byId[id].group]);
```

Replace with:

```javascript
    const oppMark=(state.view&&state.view.opportunistic&&state.view.opportunistic.phases[id]||{}).mark;
    const card=makeCard(byId[id], (colors||{})[byId[id].group], oppMark);
```

- [ ] **Step 3: Add the `tabAutonomy` renderer**

In `editor.js`, immediately AFTER the `tabGeneral` function (it ends with the `if(p.type==="workflow_call"){...}` block and a closing `}`), add:

```javascript
function tabAutonomy(body,p,id){
  const mk=(node)=>body.appendChild(node);
  const mode=opportunisticMode(p);
  const g=opportunisticGuidance(p);
  const modeR=fieldSelect("mode", mode, ["inherit","enabled","locked"], v=>{
    setOpportunistic(p, v, g.when, g.examples);
    refreshView().then(()=>selectPhase(id));
  });
  modeR.appendChild(helpIcon("inherit = use the workflow's global default · enabled = the main agent may author & launch an ad-hoc sub-agent here (a sub-agent cannot itself spawn — you do it after the planned one returns) · locked = explicitly forbid it on this deterministic/sensitive phase."));
  mk(modeR);
  if(mode==="enabled"){
    const w=fieldTextarea("when", g.when, v=>{ setOpportunistic(p,"enabled",v,g.examples); refreshView().then(()=>selectPhase(id)); });
    w.appendChild(helpIcon("When to improvise here (e.g. 'a dependency looks old / abandoned').")); mk(w);
    mk(stringListEditor("examples", g.examples, arr=>{ setOpportunistic(p,"enabled",g.when,arr); refreshView().then(()=>selectPhase(id)); }));
  }
  const prev=document.createElement("div"); prev.className="opp-resolved";
  const label=resolvedOppLabel(state.view&&state.view.opportunistic, id);
  prev.textContent="Resolved: "+(label||"—");
  mk(prev);
}
```

- [ ] **Step 4: Register the tab**

In `editor.js`, find the `tabs` array in `selectPhase`:

```javascript
  const tabs=[
    {key:"general", label:"General", render:b=>tabGeneral(b,p,id)},
    {key:"deps", label:"Dependencies", render:b=>tabDeps(b,p)},
    {key:"files", label:"Files", render:b=>tabFiles(b,p)},
    {key:"triggers", label:"Triggers", render:b=>tabTriggers(b,p)},
    {key:"invocations", label:"Invocations ("+((p.invocations||[]).length)+")", render:b=>renderInvocations(b,p,id)},
  ];
```

Replace with (add the Autonomy tab after General):

```javascript
  const tabs=[
    {key:"general", label:"General", render:b=>tabGeneral(b,p,id)},
    {key:"autonomy", label:"🧭 Autonomy", render:b=>tabAutonomy(b,p,id)},
    {key:"deps", label:"Dependencies", render:b=>tabDeps(b,p)},
    {key:"files", label:"Files", render:b=>tabFiles(b,p)},
    {key:"triggers", label:"Triggers", render:b=>tabTriggers(b,p)},
    {key:"invocations", label:"Invocations ("+((p.invocations||[]).length)+")", render:b=>renderInvocations(b,p,id)},
  ];
```

- [ ] **Step 5: Add the global default section in Settings**

In `editor.js`, find the end of `renderSettings` (the `on_demand_agents` block ends with the `addO` button append, then the function closes with `}`):

```javascript
  const addO=document.createElement("button"); addO.textContent="+ on-demand agent"; addO.addEventListener("click",()=>{ m.on_demand_agents.push({agent:(state.agents||[])[0]||"",description:""}); renderSettings(); }); root.appendChild(addO);
}
```

Replace with (insert the opportunistic section before the closing brace):

```javascript
  const addO=document.createElement("button"); addO.textContent="+ on-demand agent"; addO.addEventListener("click",()=>{ m.on_demand_agents.push({agent:(state.agents||[])[0]||"",description:""}); renderSettings(); }); root.appendChild(addO);
  sec("opportunistic (global default)");
  const gs=globalOpportunisticState(m);
  const enR=fieldCheckbox("enable by default", gs.enabled, v=>{ setGlobalOpportunistic(m, v, gs.when, gs.examples); renderSettings(); refreshView(); });
  enR.appendChild(helpIcon("When on, every phase is an autonomy zone by default (override or lock per phase in the 🧭 Autonomy tab). The main agent may author ad-hoc sub-agents to handle the unexpected.")); root.appendChild(enR);
  if(gs.enabled){
    root.appendChild(fieldTextarea("when", gs.when, v=>{ setGlobalOpportunistic(m, true, v, gs.examples); refreshView(); }));
    root.appendChild(stringListEditor("examples", gs.examples, arr=>{ setGlobalOpportunistic(m, true, gs.when, arr); refreshView(); }));
  }
}
```

- [ ] **Step 6: Run the front-end suite (no regression)**

Run: `cd src/scripts/tests/webedit && bun test`
Expected: all tests pass (editor.js has no direct unit tests; this confirms the imported modules still resolve and nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add src/workflow/templates/webedit/editor.js
git commit -m "feat(awok-webedit): 🧭 Autonomy tab, global default in Settings, grid badge wiring"
```

---

## Task 6: Visual end-to-end verification (controller-run, MCP chrome)

> This task is run by the controller (it needs the chrome MCP and a live server), not delegated to a code subagent. No code changes unless a defect is found.

- [ ] **Step 1: Deploy the editor assets and launch `awok edit`**

The web editor is served from the engine content root. Launch the editor server in the background and note the URL it prints (it binds `127.0.0.1:<port>`):

```bash
cd /home/marc-antoine/Desktop/awok && .venv/bin/python src/scripts/bb-workflow edit
```

- [ ] **Step 2: Open the editor and select `onboard`**

Navigate the chrome MCP to the printed `http://127.0.0.1:<port>/` URL. Select the `onboard` workflow. Take a snapshot of the DAG grid.

- [ ] **Step 3: Verify grid badges**

Confirm `O2-DEPS` shows a 🧭 badge and `O4-ARCHITECTURE` shows a ⛔ badge (onboard ships with the demo wiring). Screenshot.

- [ ] **Step 4: Verify the Autonomy tab + resolved preview**

Click `O2-DEPS` → "🧭 Autonomy" tab. Confirm: mode = `enabled`, `when` shows "A dependency looks old / abandoned.", `examples` lists the CVE example, and the resolved line reads "🧭 Targeted lead (global on)". Click `O4-ARCHITECTURE` → mode = `locked`, resolved line "⛔ Locked". Screenshot each.

- [ ] **Step 5: Verify the global Settings section**

Open Settings. Confirm the "opportunistic (global default)" section shows "enable by default" checked, the global `when`, and the example.

- [ ] **Step 6: Round-trip test**

Toggle a previously-inherited phase (e.g. `O1-STRUCTURE`) to `enabled` with a `when`, observe its grid badge appear (🧭) and the preview update live, then toggle it back to `inherit`. Save. Then from a shell verify the YAML round-trips cleanly:

```bash
cd /home/marc-antoine/Desktop/awok && git diff --stat src/workflows/onboard.yaml && .venv/bin/python src/scripts/bb-workflow check
```
Expected: if you left `onboard.yaml` logically unchanged, `git diff` is empty (or only your intended edit) and `awok check` reports no drift. (Stop the background `awok edit` server when done.)

- [ ] **Step 7 (if a defect is found): fix + re-verify, then commit**

If the visual check surfaces a bug (e.g. badge not appearing, preview wrong, save not round-tripping), fix the relevant file, re-run the affected `bun test` / `pytest`, re-verify visually, and commit with a `fix(awok-webedit): …` message.

---

## Self-review notes

- **Spec coverage**: §3 data model + §4 widget → Task 1+2; §5 backend view → Task 3; §6a Autonomy tab → Task 5; §6b Settings global → Task 5; §6c grid badges → Task 4+5; §7 resolved preview → Task 2 (`resolvedOppLabel`) + Task 5 (render); §9 tests → distributed; visual → Task 6. No gaps.
- **No backend resolution duplicated in JS**: the front-end `resolvedOppLabel` only *labels* the server-resolved `{mark,note_kind,enabled}`; it never computes the precedence (which stays in `resolve_opportunistic`). The JS `setOpportunistic`/`setGlobalOpportunistic` only *serialize* the raw field, they don't resolve.
- **Type consistency**: the view block shape `{global_enabled, phases:{id:{mark,note_kind,enabled}}}` is identical in Task 3 (Python), the Task 2 `resolvedOppLabel` tests, and the Task 5 `makeRow` access path. `setOpportunistic(phase, mode, when, examples)` and `setGlobalOpportunistic(model, enabled, when, examples)` signatures are used identically in their tests (Task 2) and in `editor.js` (Task 5).
- **YAGNI**: per-level sub-tabs, in-editor SKILL.md preview, and auth are out of scope (spec §10).
```
