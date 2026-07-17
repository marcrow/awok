# Webedit Signals Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the webedit signals section ("emits", Wiring tab) three layers of contextual help — a one-line intro, mini-labels above every control, and hover popovers per field — so a user who has never read the workflow YAML nor the docs can fill it unaided.

**Architecture:** Purely presentational change inside `signalsEditor` (`src/workflow/templates/webedit/formfields.js`): a new `labeled(labelText, helpText, controlEl)` wrapper (mini-label + existing `helpIcon` popover from `render-helpers.js`, already imported in the file) applied to every signal control, plus an always-visible intro note under the section heading. CSS additions in `editor.css`. No data-model or event change — all existing behavior tests must pass unchanged.

**Tech Stack:** ES modules (no framework), `bun test` + linkedom (`src/scripts/tests/webedit/`), CSS custom properties.

## Global Constraints

- Design (source of truth): `docs/superpowers/specs/2026-07-17-webedit-signals-help-design.md`. Persona: someone who has never read a workflow YAML nor the awok docs.
- **All help text in English**; YAML keywords (`emits`, `source`, `values`, `of`…) stay verbatim.
- **Compacité de premier rang** (spec §2): mini-labels are small and dim (`font-size` ~10px, color `var(--dim)`); pedagogical depth lives in the hover popovers only; no collapsible block; the panel must not grow noticeably wider.
- **Tooltips use the existing `helpIcon(text)` convention** (`render-helpers.js:111` — "?" glyph + CSS `.help-pop` popover). NEVER a native `title=` attribute (it would double up with the popover — see the comment inside `helpIcon`).
- Purely presentational: no change to the emitted data shapes, no change to existing event handlers' logic. The pre-existing webedit suite (63 tests) must stay green untouched.
- No Python/engine impact; do not run `awok generate`.
- The working tree has uncommitted user-authored `TODO.md` changes — NEVER stage or commit `TODO.md`.
- Run before every commit: `cd src/scripts/tests/webedit && bun test` (all green) and `node --check src/workflow/templates/webedit/formfields.js`.
- Reference: `signalsEditor` is at `formfields.js:~197` (grep it — line numbers may drift). CSS conventions: `.muted-note` (`editor.css:264`), `.signal-row`/`.signal-subrow` (`editor.css:309-325`), `.help-icon`/`.help-pop` (`editor.css:385-392`). Test harness: `src/scripts/tests/webedit/formfields.test.js` (existing `dom()` helper + `signalsEditor` import).

---

### Task 1: `labeled()` helper, HELP texts, intro note, main-row labels

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` (`signalsEditor` and just above it)
- Modify: `src/workflow/templates/webedit/editor.css`
- Test: `src/scripts/tests/webedit/formfields.test.js`

**Interfaces:**
- Consumes: `helpIcon(text)` from `./render-helpers.js` (already imported at `formfields.js:1`).
- Produces (used verbatim by Task 2): `labeled(labelText, helpText, controlEl) -> HTMLElement` (`div.labeled-ctl` containing `span.mini-label` [text node + optional helpIcon] then `controlEl`); module-scope `const SIGNAL_HELP = {...}` with keys `intro, name, type, source, from_role, from_field, by, values, of, of_field, of_field_type`.

- [ ] **Step 1: Write the failing tests**

Append to `src/scripts/tests/webedit/formfields.test.js` (reuse the file's existing `dom()` helper and `signalsEditor` import):

```javascript
test("signalsEditor renders the always-visible intro note", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [], phase, () => {});
  const note = r.querySelector(".signals-intro");
  expect(note).not.toBeNull();
  expect(note.textContent).toContain("branch or loop");
  expect(note.textContent).toContain("<action_id>.<name>");
});

test("signalsEditor labels the main-row controls (name, type, source)", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "status", type: "string", source: "token" }], phase, () => {});
  const labels = [...r.querySelectorAll(".signal-row .mini-label")]
    .map(l => l.childNodes[0].textContent);
  expect(labels).toContain("name");
  expect(labels).toContain("type");
  expect(labels).toContain("source");
});

test("main-row mini-labels carry help popovers (no native title)", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "s", type: "string", source: "token" }], phase, () => {});
  const nameWrap = [...r.querySelectorAll(".labeled-ctl")]
    .find(w => w.querySelector(".mini-label").childNodes[0].textContent === "name");
  const pop = nameWrap.querySelector(".help-icon .help-pop");
  expect(pop).not.toBeNull();
  expect(pop.textContent.length).toBeGreaterThan(10);
  expect(nameWrap.querySelector("input").getAttribute("title")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: the 3 new tests FAIL (`.signals-intro` null, no `.mini-label`).

- [ ] **Step 3: Implement helper + texts + intro + main-row wrapping**

In `formfields.js`, directly above `signalsEditor`, add:

```javascript
// Help layer for the signals editor (persona: never read the YAML nor the
// docs — see docs/superpowers/specs/2026-07-17-webedit-signals-help-design.md).
// Depth lives in the hover popovers; labels stay tiny so the rows keep their
// footprint. Uses the shared helpIcon popover (never native title=).
const SIGNAL_HELP = {
  intro: "A signal is a small typed value (status, number, list…) this action publishes when it finishes — the orchestration can branch or loop on it. Key: <action_id>.<name>.",
  name: "Lowercase identifier (^[a-z][a-z0-9_]*$). The orchestration reads this signal as <action_id>.<name>.",
  type: "Value shape: string, number, bool, enum (closed vocabulary), or list.",
  source: "How the value is produced — token: the agent ends its output with a compact `SIGNALS: name=value` line · field: read from a field of a JSON output file · exit_code: the script's exit status (0 ⇒ true).",
  from_role: "Which declared JSON output the value is read from.",
  from_field: "Optional field path inside that JSON (defaults to the whole file).",
  by: "When several agents run in this action: which one emits the token.",
  values: "The closed vocabulary — the agent must emit exactly one of these.",
  of: "Element type of the list items; `object` declares a flat field map.",
  of_field: "One required field of each list item (flat — no nesting).",
  of_field_type: "Field type: a scalar, or enum with its own closed vocabulary.",
};

function labeled(labelText, helpText, controlEl){
  const w = document.createElement("div"); w.className = "labeled-ctl";
  const l = document.createElement("span"); l.className = "mini-label";
  l.appendChild(document.createTextNode(labelText));
  if (helpText) l.appendChild(helpIcon(helpText));
  w.appendChild(l); w.appendChild(controlEl);
  return w;
}
```

Inside `signalsEditor`, right after the `head` label is appended (and after the early-return "signals not supported" branch so the intro only shows for supported natures), add:

```javascript
  const intro = document.createElement("div");
  intro.className = "muted-note signals-intro";
  intro.textContent = SIGNAL_HELP.intro;
  wrap.appendChild(intro);
```

In the `render()` main-row block, wrap the three main controls. Replace the bare appends (`r.appendChild(name)`, `r.appendChild(type)`, `r.appendChild(source)`) with:

```javascript
      const nameWrap = labeled("name", SIGNAL_HELP.name, name);
      nameWrap.classList.add("grow");
      r.appendChild(nameWrap);
      // ... (type/source created as today, then:)
      r.appendChild(labeled("type", SIGNAL_HELP.type, type));
      r.appendChild(labeled("source", SIGNAL_HELP.source, source));
```

Keep the ✕ button and the regex `warn` chip appended directly to `r` (unlabeled), exactly as today. Do not touch any event handler.

Note: `signalsEditor` currently sets `if (exitCode) type.title = "..."` on the type select — REMOVE that line (its content moves into `SIGNAL_HELP.source`/`SIGNAL_HELP.type` popovers; the global constraint forbids native `title=` duplication).

In `editor.css`, next to the existing `.signal-row` rules, add:

```css
/* signals help layer — mini-labels above controls, depth in the popovers */
.labeled-ctl{display:flex;flex-direction:column;gap:2px;min-width:0}
.labeled-ctl.grow{flex:1 1 auto;min-width:80px}
.labeled-ctl>input,.labeled-ctl>select{width:100%}
.mini-label{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--dim);line-height:1}
.signal-row{align-items:flex-end}
.signal-row>button.signal-del,.signal-row>.signal-warn{margin-bottom:6px}
.signals-intro{margin:4px 0 2px}
```

(The `.signal-row{align-items:flex-end}` line overrides the earlier `align-items:center` — keep the original rule untouched and add this override AFTER it in the file so the ✕/warn sit on the controls' baseline. Adjust the `margin-bottom` value if the ✕ visibly misaligns; eyeball values are fine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: 3 new tests PASS, all pre-existing formfields tests still PASS.

- [ ] **Step 5: Full suite + syntax check**

Run: `cd src/scripts/tests/webedit && bun test && node --check ../../../workflow/templates/webedit/formfields.js`
Expected: whole webedit suite green (63 pre-existing + 3 new), `node --check` silent.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/formfields.js src/workflow/templates/webedit/editor.css src/scripts/tests/webedit/formfields.test.js
git commit -m "feat(webedit): signals help — intro note + labeled main row (novice persona)"
```

---

### Task 2: Labels + popovers on every sub-row (from, by, values, of, object repeater)

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` (`signalsEditor` sub-row blocks)
- Test: `src/scripts/tests/webedit/formfields.test.js`

**Interfaces:**
- Consumes: `labeled(labelText, helpText, controlEl)` and `SIGNAL_HELP` from Task 1 (same module).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `src/scripts/tests/webedit/formfields.test.js`:

```javascript
test("field-sourced signal labels the from controls", () => {
  dom();
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", [{ name: "hits", type: "number", source: "field", from: "work:t1" }], phase, () => {});
  const labels = [...r.querySelectorAll(".signal-subrow .mini-label")]
    .map(l => l.childNodes[0].textContent);
  expect(labels).toContain("from");
  expect(labels).toContain("field");
});

test("list signal labels the of dropdown with a popover", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "hits", type: "list", source: "token", of: "string" }], phase, () => {});
  const ofWrap = [...r.querySelectorAll(".labeled-ctl")]
    .find(w => w.querySelector("select.signal-of"));
  expect(ofWrap).not.toBeNull();
  expect(ofWrap.querySelector(".mini-label").childNodes[0].textContent).toBe("of");
  expect(ofWrap.querySelector(".help-icon .help-pop").textContent).toContain("lement");
});

test("enum values chips carry a help icon on their heading", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "s", type: "enum", source: "token", values: ["ok"] }], phase, () => {});
  const sle = r.querySelector(".stringlist-editor");
  expect(sle.querySelector("label .help-icon .help-pop").textContent).toContain("vocabulary");
});

test("object repeater labels field name and type", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "f", type: "list", source: "token", of: { path: "string" } }], phase, () => {});
  const labels = [...r.querySelectorAll(".of-field-row .mini-label")]
    .map(l => l.childNodes[0].textContent);
  expect(labels).toContain("field");
  expect(labels).toContain("type");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: the 4 new tests FAIL (no `.mini-label` in sub-rows / no help icon on the stringlist label).

- [ ] **Step 3: Wrap the sub-row controls**

In `signalsEditor`'s `render()`, apply `labeled()` to every sub-row control (grep the blocks; post-Task-1 line numbers will have shifted):

1. **`from` sub-row** (`curSource === "field"` block): replace `sub.appendChild(roleSel); sub.appendChild(fieldInput);` with

```javascript
        sub.appendChild(labeled("from", SIGNAL_HELP.from_role, roleSel));
        const fw = labeled("field", SIGNAL_HELP.from_field, fieldInput);
        fw.classList.add("grow");
        sub.appendChild(fw);
```

2. **`by` sub-row** (token/exit_code with ≥2 invocation agents): replace `sub.appendChild(bySel);` with

```javascript
        sub.appendChild(labeled("by", SIGNAL_HELP.by, bySel));
```

3. **Enum `values` chips** — both places that call `stringListEditor("values", item.values, ...)` (the scalar-enum block AND the list-of-enum block): keep the call as is, capture its return and add the help icon to its own heading label (same idiom as `withHelp` in `settings.js`):

```javascript
        const sle = stringListEditor("values", item.values, (vals) => {
          if (vals.length) item.values = vals; else delete item.values;
          emit();
        });
        sle.querySelector("label").appendChild(helpIcon(SIGNAL_HELP.values));
        sub.appendChild(sle);
```

(adapt the inner callback to each block's existing one — do not change the callbacks' logic; in the list-of-enum block the variable is `vrow`, not `sub`.)

4. **`of` dropdown** (list sub-row): replace `sub.appendChild(ofSel);` with

```javascript
        sub.appendChild(labeled("of", SIGNAL_HELP.of, ofSel));
```

5. **Object repeater rows** (`curOf === "object"`): replace `fr.appendChild(fname); fr.appendChild(ftype); fr.appendChild(del);` with

```javascript
            const fnw = labeled("field", SIGNAL_HELP.of_field, fname);
            fnw.classList.add("grow");
            fr.appendChild(fnw);
            fr.appendChild(labeled("type", SIGNAL_HELP.of_field_type, ftype));
            fr.appendChild(del);
```

   and for the per-field enum chips inside the repeater (`stringListEditor("values", obj[field].enum, ...)`), add the same heading help icon with `SIGNAL_HELP.values`.

6. **CSS** — if the ✕ in `.of-field-row` now misaligns (labels made rows taller), add next to Task 1's block in `editor.css`:

```css
.of-field-row{align-items:flex-end}
.of-field-row>button.of-field-del{margin-bottom:6px}
```

Do not modify any event handler logic — wrapping only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: all 4 new tests PASS; every pre-existing test (incl. Task-9 regression tests that query `select.signal-of`, `.of-field-row` inputs by value, emitted shapes) still PASS — they use querySelector/value lookups that are insensitive to the wrappers.

- [ ] **Step 5: Full suite + syntax check**

Run: `cd src/scripts/tests/webedit && bun test && node --check ../../../workflow/templates/webedit/formfields.js`
Expected: whole suite green (70 tests), `node --check` silent.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/formfields.js src/workflow/templates/webedit/editor.css src/scripts/tests/webedit/formfields.test.js
git commit -m "feat(webedit): signals help — labeled sub-rows + field popovers"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 intro/empty-state → Task 1; §3.2 mini-labels (main row → Task 1; every sub-row incl. object repeater → Task 2); §3.3 popover table → `SIGNAL_HELP` (Task 1) consumed by both tasks; §4 helper `labeled()` + `editor.css` → Task 1; §5 tests → both tasks' Step 1; compacité → labels 10px `--dim`, depth in popovers, no collapsible.
- **Amendement tooltip:** the spec was amended (same-day) from native `title=` to the existing `helpIcon` popover convention; this plan follows the amended spec, and Task 1 removes the one pre-existing native `title` in `signalsEditor` (exit_code type select) to avoid the double-tooltip the convention warns about.
- **Type consistency:** `labeled(labelText, helpText, controlEl)` and `SIGNAL_HELP` defined in Task 1, consumed verbatim in Task 2 (same module, no import needed). Test selectors use `.childNodes[0].textContent` because `.mini-label`'s `textContent` also concatenates the popover text.
- **Behavior invariance:** both tasks only wrap existing nodes / append presentational nodes; all existing handlers and emitted shapes untouched, pinned by the 63 pre-existing tests staying green.
