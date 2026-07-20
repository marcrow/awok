# Editable Formatter Vocabularies (C5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the formatter prompt-assist knobs (length/tone/format/audience/language/stance) into a data-driven, documented, user-extensible vocabulary: an engine base plus a user overlay that survives upgrades, read by `compile_style` and by the Web UI, editable from a dedicated awok settings page.

**Architecture:** A base YAML (`src/workflow/vocab.yaml`, engine-owned) is merged under a per-root user overlay (`custom/vocab.yaml`, gitignored) by the engine's `load_vocab()`; `compile_style()` reads the merged store instead of hardcoded maps. The editor fetches the merged store once and renders knobs data-driven (no duplicated JS constants), and a new top-level awok page (opened by a ⚙ button) hosts a `vocab.js` editor that PUTs the overlay.

**Tech Stack:** Python stdlib + PyYAML (engine, single file `src/scripts/bb-workflow`); ES-module vanilla JS (`src/workflow/templates/webedit/`); pytest (engine tests); bun + linkedom (webedit tests).

## Global Constraints

- Design doc (source of truth): `docs/superpowers/specs/2026-07-20-editable-formatter-vocabularies-design.md`.
- Docs and code in **English**; the assistant may converse in French.
- **Never** hand-edit a generated `SKILL.md`. Agents keep `model: inherit`.
- **D5 holds**: the compiled-style preview stays server-rendered (`definition_preview`); the UI never recompiles style in JS.
- Overlay writes are **project-scoped only** — the server writes `CONTENT_ROOT/custom/vocab.yaml` from a server-derived path, never a request-supplied path (`awok edit` is local, not exposed — TODO.md E1).
- Overlay may **add** or **reword** options; **never delete** a base option. The **knob set is fixed** (options extend, knobs do not).
- `def_formatter.style` in `src/workflow/workflow.schema.json` **stays open** (`{"type":"object"}`) — do not tighten.
- Behavior preservation: base `prose` reproduces today's `compile_style` output **verbatim** (no shipped workflow uses `formatter.style`, so `awok generate` yields zero `SKILL.md` diff; the new content is the human `definition` fields).
- Engine path globals: `ENGINE_ROOT` and `CONTENT_ROOT` are module-level (`src/scripts/bb-workflow` lines ~86-89); vocab functions read them at call time (like other path helpers). No threading through call sites.
- After engine work: run `awok validate && awok generate && awok check` (all green, zero diff expected); commit any regenerated artifacts in the same commit; redeploy with `./install.sh`.

---

## File Structure

**Engine — `src/scripts/bb-workflow`** (single file):
- New `vocab.yaml` loader block: `_vocab_overlay_paths()`, `load_vocab()`, `save_vocab_overlay()`.
- `compile_style()` (lines ~2705-2731) rewritten to read `load_vocab()`; delete `_LEN_HINT`/`_FMT_PROSE` (lines ~2698-2702).
- New routes `GET /api/vocab` (in `_route_get`, ~line 4288) and `PUT /api/vocab` (in `_route_put`, ~line 4370).

**Engine data — `src/workflow/vocab.yaml`** (new): canonical base vocabulary.

**Repo — `.gitignore`**: add `/custom/`.

**Web UI — `src/workflow/templates/webedit/`**:
- New `vocab.js`: `knobView(vocab, name)` (pure) + `renderVocabEditor(root, ctx)` (editor component).
- `definition.js`: delete the local scale constants (lines ~29-39); render knobs from `ctx.vocab`; surface per-option `definition` via slider-stop / chip `title`.
- `editor.js`: fetch `/api/vocab` once → `state.vocab`; expose merged via `definitionCtx()`; ⚙ button handler + top-level awok-page view toggle mounting `renderVocabEditor`.
- `editor.html`: ⚙ button in the `brand` zone; `<section id="page-awok">`.
- `editor.css`: awok-page + vocab-editor styles.

**Tests**:
- New `src/scripts/tests/test_workflow_vocab.py` (merge/provenance/save/compile_style-via-vocab).
- `src/scripts/tests/test_workflow_definition.py`: add a base-prose pin; golden substrings stay green.
- New `src/scripts/tests/webedit/vocab.test.js` (knobView + editor patch build).
- `src/scripts/tests/webedit/definition.test.js`: pass a `ctx.vocab` fixture.

---

## Task 1: Base `vocab.yaml` + `load_vocab()` merge

**Files:**
- Create: `src/workflow/vocab.yaml`
- Modify: `src/scripts/bb-workflow` (add loader block near the other path helpers, e.g. after `_apply_roots`, ~line 78)
- Test: `src/scripts/tests/test_workflow_vocab.py`

**Interfaces:**
- Produces:
  - `_vocab_overlay_paths() -> list[Path]` — ordered writable-overlay paths that exist to apply: `[ENGINE_ROOT/custom/vocab.yaml, CONTENT_ROOT/custom/vocab.yaml]`, de-duplicated (same file when no `--workdir`).
  - `load_vocab() -> dict` — merged vocab: `{"version": 1, "knobs": {<name>: {"kind","optional","supports_custom","prose_template","hint_fallback"?, "options": [ {"value","definition","prose","label"?,"hint"?,"source":"base"|"overlay","overridden": bool} ]}}}`. Options: base order first, then overlay-added, appended in file order.

- [ ] **Step 1: Write `src/workflow/vocab.yaml`** (verbatim — this is the canonical base; `prose` reproduces today's `compile_style` output exactly):

```yaml
version: 1
knobs:
  length:
    kind: ordinal
    optional: true
    prose_template: "Keep the answer {value} ({hint})."
    hint_fallback: "appropriate length"
    options:
      - value: terse
        hint: "~40 words"
        definition: "Just the answer, no elaboration or supporting reasoning."
        prose: "Keep the answer terse (~40 words)."
      - value: brief
        hint: "~150 words"
        definition: "A short answer that still gives the key reasoning, not only the verdict."
        prose: "Keep the answer brief (~150 words)."
      - value: standard
        hint: "~400 words"
        definition: "A full answer with reasoning and the main caveats."
        prose: "Keep the answer standard (~400 words)."
      - value: detailed
        hint: "~800 words"
        definition: "A thorough answer covering edge cases and alternatives."
        prose: "Keep the answer detailed (~800 words)."
      - value: exhaustive
        hint: "as long as needed"
        definition: "Leave nothing out; length is not a constraint."
        prose: "Keep the answer exhaustive (as long as needed)."
  tone:
    kind: ordinal
    optional: true
    supports_custom: true
    prose_template: "Write in a {value} tone."
    options:
      - value: direct
        definition: "Straight to the point; no preamble, hedging, or throat-clearing."
        prose: "Write in a direct tone."
      - value: professional
        definition: "Neutral and businesslike, for a work audience."
        prose: "Write in a professional tone."
      - value: didactic
        definition: "Explains as it goes, teaching the reasoning, not just stating it."
        prose: "Write in a didactic tone."
      - value: beginner
        definition: "Assumes the reader is smart but new to this exact topic."
        prose: "Write in a beginner tone."
      - value: zero-knowledge
        definition: "Assumes no prior context at all; define every term."
        prose: "Write in a zero-knowledge tone."
  format:
    kind: ordinal
    optional: true
    prose_template: "Format as {value}."
    options:
      - value: prose
        definition: "Flowing paragraphs, no lists or headers."
        prose: "Write as flowing prose."
      - value: tldr
        label: "TL;DR"
        definition: "A one-line takeaway first, then the supporting detail."
        prose: "Lead with a TL;DR, then the detail."
      - value: bullets
        definition: "A bulleted list of points rather than paragraphs."
        prose: "Structure as bullet points."
      - value: sections
        definition: "Organized under headers, one per theme."
        prose: "Organize under section headers."
      - value: table
        definition: "A table when the content is comparable rows and columns."
        prose: "Present as a table."
  audience:
    kind: ordinal
    optional: true
    prose_template: "Written for a {value}."
    options:
      - value: maintainer
        definition: "A developer who owns this code and knows the domain."
        prose: "Written for a maintainer."
      - value: external stakeholder
        label: "external"
        definition: "A reader outside the team — no code access, cares about outcomes."
        prose: "Written for an external stakeholder."
      - value: downstream workflow
        label: "downstream"
        definition: "Another automated workflow that will parse this, not a human."
        prose: "Written for a downstream workflow."
  language:
    kind: nominal
    prose_template: "Respond in {value}."
    options:
      - value: inherit
        label: "↩ inherit"
        definition: "Follow the session / default language; inject nothing."
        prose: ""
      - value: English
        label: "🇬🇧 English"
        definition: "Answer in English regardless of the input language."
        prose: "Respond in English."
      - value: French
        label: "🇫🇷 French"
        definition: "Answer in French regardless of the input language."
        prose: "Respond in French."
      - value: German
        label: "🇩🇪 German"
        definition: "Answer in German regardless of the input language."
        prose: "Respond in German."
      - value: Spanish
        label: "🇪🇸 Spanish"
        definition: "Answer in Spanish regardless of the input language."
        prose: "Respond in Spanish."
  stance:
    kind: nominal
    optional: true
    prose_template: "{value}"
    options:
      - value: recommend
        definition: "Commit to one clear pick rather than laying out choices."
        prose: "Give a clear recommendation."
      - value: present
        definition: "Lay out the options and their trade-offs without choosing."
        prose: "Present options rather than a single pick."
```

- [ ] **Step 2: Write the failing test** — `src/scripts/tests/test_workflow_vocab.py`:

```python
# bb-workflow is extension-less, so spec_from_file_location returns None —
# load it via SourceFileLoader, matching test_workflow_definition.py / conftest.py.
import importlib.util, pathlib
from importlib.machinery import SourceFileLoader

ROOT = pathlib.Path(__file__).resolve().parents[3]   # repo root (tests are at src/scripts/tests/)
_loader = SourceFileLoader("bbw", str(ROOT / "src" / "scripts" / "bb-workflow"))
_spec = importlib.util.spec_from_loader("bbw", _loader)
bbw = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(bbw)


def test_load_vocab_base_shape(monkeypatch):
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [])  # base-only isolation
    v = bbw.load_vocab()
    assert v["version"] == 1
    tone = v["knobs"]["tone"]
    assert tone["kind"] == "ordinal" and tone["supports_custom"] is True
    values = [o["value"] for o in tone["options"]]
    assert values == ["direct", "professional", "didactic", "beginner", "zero-knowledge"]
    direct = tone["options"][0]
    assert direct["source"] == "base" and direct["overridden"] is False
    assert direct["prose"] == "Write in a direct tone."
    assert direct["definition"]  # non-empty human definition
    # language: inherit injects nothing
    lang = {o["value"]: o for o in v["knobs"]["language"]["options"]}
    assert lang["inherit"]["prose"] == ""


def test_load_vocab_merges_overlay(tmp_path, monkeypatch):
    # An overlay that rewords a base option AND adds a new one.
    overlay_dir = tmp_path / "custom"; overlay_dir.mkdir()
    (overlay_dir / "vocab.yaml").write_text(
        "version: 1\n"
        "knobs:\n"
        "  tone:\n"
        "    options:\n"
        "      - value: beginner\n"
        "        definition: Reworded beginner meaning.\n"
        "      - value: warm\n"
        "        definition: Friendly and encouraging.\n"
        "        prose: Write in a warm tone.\n",
        encoding="utf-8")
    # Deterministic: base from the engine, exactly one overlay (this tmp file).
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [overlay_dir / "vocab.yaml"])
    tone = {o["value"]: o for o in bbw.load_vocab()["knobs"]["tone"]["options"]}
    # reworded base option: definition overridden, prose kept from base, flagged
    assert tone["beginner"]["definition"] == "Reworded beginner meaning."
    assert tone["beginner"]["prose"] == "Write in a beginner tone."
    assert tone["beginner"]["source"] == "base" and tone["beginner"]["overridden"] is True
    # added option: overlay-sourced, appended
    assert tone["warm"]["source"] == "overlay"
    assert bbw.load_vocab.__doc__ is not None
```

- [ ] **Step 3: Run to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_vocab.py -v`
Expected: FAIL — `AttributeError: module 'bbw' has no attribute 'load_vocab'`.

- [ ] **Step 4: Implement the loader block** in `src/scripts/bb-workflow`. Place it **after** the `ENGINE_ROOT`/`CONTENT_ROOT` assignments + `_apply_roots(...)` call (~line 89) — the functions read `ENGINE_ROOT`/`CONTENT_ROOT` at **call time** (never at import), matching how the other path helpers behave and keeping `--workdir` / monkeypatch overrides effective:

```python
def _vocab_base_path():
    """The engine base vocabulary path, resolved at call time so ENGINE_ROOT
    overrides (--workdir, tests) take effect."""
    return ENGINE_ROOT / "src" / "workflow" / "vocab.yaml"


def _vocab_overlay_paths():
    """Writable per-root overlays to apply over the base, engine then workdir.
    De-duplicated: with no --workdir, ENGINE_ROOT == CONTENT_ROOT so the two
    collapse to one file (applied once)."""
    seen, out = set(), []
    for root in (ENGINE_ROOT, CONTENT_ROOT):
        p = (root / "custom" / "vocab.yaml").resolve()
        if p not in seen:
            seen.add(p); out.append(p)
    return out


def _apply_vocab_overlay(knobs, overlay):
    """Mutate `knobs` (merged so far) with one overlay dict, keyed by
    (knob, value): reword an existing option (fields win, `overridden=True`)
    or append a new one (`source='overlay'`)."""
    for kname, kpatch in (overlay.get("knobs") or {}).items():
        knob = knobs.get(kname)
        if knob is None:
            continue  # overlays extend options within fixed knobs, never add knobs
        by_value = {o["value"]: o for o in knob["options"]}
        for opt in (kpatch.get("options") or []):
            val = opt.get("value")
            if val is None:
                continue
            if val in by_value:
                target = by_value[val]
                for k, x in opt.items():
                    if k != "value":
                        target[k] = x
                target["overridden"] = True
            else:
                new = dict(opt); new.setdefault("source", "overlay")
                new.setdefault("overridden", False)
                knob["options"].append(new); by_value[val] = new


def load_vocab():
    """Merged prompt-assist vocabulary: engine base <- engine overlay <-
    workdir overlay, keyed by (knob, option-value). Each option is tagged with
    provenance (`source`, `overridden`). Single source consumed by both
    compile_style() and GET /api/vocab."""
    base = yaml.safe_load(_vocab_base_path().read_text(encoding="utf-8")) or {}
    knobs = base.get("knobs") or {}
    for knob in knobs.values():
        for opt in knob.get("options") or []:
            opt.setdefault("source", "base")
            opt.setdefault("overridden", False)
    for path in _vocab_overlay_paths():
        if path.is_file():
            overlay = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            _apply_vocab_overlay(knobs, overlay)
    return {"version": base.get("version", 1), "knobs": knobs}
```

- [ ] **Step 5: Run to verify pass**

Run: `pytest src/scripts/tests/test_workflow_vocab.py -v`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/vocab.yaml src/scripts/bb-workflow src/scripts/tests/test_workflow_vocab.py
git commit -m "feat(vocab): base vocab.yaml + load_vocab() merge (base <- overlays)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `compile_style()` reads the merged vocab

**Files:**
- Modify: `src/scripts/bb-workflow` — rewrite `compile_style` (lines ~2705-2731); delete `_LEN_HINT`/`_FMT_PROSE` (lines ~2698-2702)
- Test: `src/scripts/tests/test_workflow_vocab.py` (add cases); `src/scripts/tests/test_workflow_definition.py` (add a pin)

**Interfaces:**
- Consumes: `load_vocab()` (Task 1).
- Produces: `compile_style(style: dict) -> list[str]` — same signature/behavior as before for known values; unknown values fall back to the knob `prose_template`.

- [ ] **Step 1: Add failing tests** to `src/scripts/tests/test_workflow_vocab.py`:

```python
def test_compile_style_reads_vocab(monkeypatch):
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [])  # base-only isolation
    # Known values -> the option's prose verbatim (reproduces legacy output).
    lines = bbw.compile_style({"length": "brief", "tone": "professional",
                               "format": "bullets", "audience": "maintainer",
                               "language": "French", "stance": "recommend"})
    assert "Keep the answer brief (~150 words)." in lines
    assert "Write in a professional tone." in lines
    assert "Structure as bullet points." in lines
    assert "Written for a maintainer." in lines
    assert "Respond in French." in lines
    assert "Give a clear recommendation." in lines


def test_compile_style_inherit_and_custom_and_lists(monkeypatch):
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [])  # base-only isolation
    assert bbw.compile_style({"language": "inherit"}) == []          # empty prose -> nothing
    assert bbw.compile_style({"tone": "custom", "toneCustom": "like a pirate"}) == ["like a pirate"]
    assert bbw.compile_style({}) == []
    out = bbw.compile_style({"mustInclude": ["TL;DR"], "avoid": ["preamble"]})
    assert "Always include: TL;DR." in out and "Avoid: preamble." in out


def test_compile_style_unknown_value_falls_back_to_template(monkeypatch):
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [])  # base-only isolation
    # A value not in the vocab degrades via the knob's prose_template.
    assert bbw.compile_style({"tone": "sardonic"}) == ["Write in a sardonic tone."]
    assert bbw.compile_style({"length": "epic"}) == ["Keep the answer epic (appropriate length)."]
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_vocab.py -v`
Expected: FAIL — legacy `compile_style` produces `"Format as ..."`/interpolated strings that differ (e.g. no vocab lookup), and `language: inherit` handling differs.

- [ ] **Step 3: Delete the hardcoded maps and rewrite `compile_style`.** Remove lines ~2698-2702 (`_LEN_HINT`, `_FMT_PROSE`). Replace `compile_style` (lines ~2705-2731) with:

```python
def _vocab_prose(knob, value):
    """Injected prose for one (knob, value): the option's explicit `prose`
    (verbatim; '' -> inject nothing) else the knob's prose_template
    interpolated with {value} and {hint}. Returns None to inject nothing."""
    for opt in knob.get("options") or []:
        if opt.get("value") == value:
            if "prose" in opt:
                return opt["prose"] or None
            break
    tmpl = knob.get("prose_template")
    if not tmpl:
        return None
    hint = knob.get("hint_fallback", "")
    for opt in knob.get("options") or []:
        if opt.get("value") == value:
            hint = opt.get("hint", hint); break
    try:
        return tmpl.format(value=value, hint=hint) or None
    except (KeyError, IndexError):
        return None


def compile_style(style: dict) -> list:
    """Prompt-assist knobs -> deterministic prose lines (single source of truth;
    the WebUI preview renders these verbatim). Reads the merged vocabulary
    (load_vocab). Free prompt is concatenated after by the caller."""
    st = style or {}
    knobs = load_vocab()["knobs"]
    parts = []
    if st.get("length"):
        line = _vocab_prose(knobs["length"], st["length"])
        if line: parts.append(line)
    if st.get("tone") == "custom":
        if st.get("toneCustom"):
            parts.append(st["toneCustom"])
    elif st.get("tone"):
        line = _vocab_prose(knobs["tone"], st["tone"])
        if line: parts.append(line)
    if st.get("format"):
        line = _vocab_prose(knobs["format"], st["format"])
        if line: parts.append(line)
    if st.get("language") and st["language"] != "inherit":
        line = _vocab_prose(knobs["language"], st["language"])
        if line: parts.append(line)
    if st.get("audience"):
        line = _vocab_prose(knobs["audience"], st["audience"])
        if line: parts.append(line)
    for m in st.get("mustInclude", []) or []:
        parts.append(f"Always include: {m}.")
    for a in st.get("avoid", []) or []:
        parts.append(f"Avoid: {a}.")
    if st.get("stance"):
        line = _vocab_prose(knobs["stance"], st["stance"])
        if line: parts.append(line)
    return parts
```

- [ ] **Step 4: Add a base-prose pin** to `src/scripts/tests/test_workflow_definition.py` (after `test_compile_style`, ~line 171):

```python
def test_base_vocab_prose_pinned(monkeypatch):
    # Pins the required-knob base prose so any wording change is deliberate.
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [])  # base-only isolation
    knobs = bbw.load_vocab()["knobs"]
    def prose(k, v): return {o["value"]: o["prose"] for o in knobs[k]["options"]}[v]
    assert prose("length", "brief") == "Keep the answer brief (~150 words)."
    assert prose("tone", "didactic") == "Write in a didactic tone."
    assert prose("format", "bullets") == "Structure as bullet points."
    assert prose("audience", "maintainer") == "Written for a maintainer."
    assert prose("language", "French") == "Respond in French."
```

- [ ] **Step 5: Run the affected suites**

Run: `pytest src/scripts/tests/test_workflow_vocab.py src/scripts/tests/test_workflow_definition.py -v`
Expected: PASS — including the pre-existing `test_compile_style`, `test_generate_renders_definition`, and `test_definition_demo_fixture_renders_golden_substrings` (golden substrings `"Keep the answer brief"`, `"Write in a professional tone."`, `"Structure as bullet points."` are reproduced verbatim by the base prose).

- [ ] **Step 6: Full engine suite (no regressions)**

Run: `pytest src/scripts/tests/test_workflow_*.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_vocab.py src/scripts/tests/test_workflow_definition.py
git commit -m "refactor(vocab): compile_style reads merged vocab; drop hardcoded maps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `save_vocab_overlay()` + `GET`/`PUT /api/vocab` + `.gitignore`

**Files:**
- Modify: `src/scripts/bb-workflow` — add `save_vocab_overlay`; routes in `_route_get` (~4288) and `_route_put` (~4370)
- Modify: `.gitignore` — add `/custom/`
- Test: `src/scripts/tests/test_workflow_vocab.py`

**Interfaces:**
- Consumes: `load_vocab()` (Task 1).
- Produces:
  - `save_vocab_overlay(overlay: dict) -> list[str]` — writes `CONTENT_ROOT/custom/vocab.yaml` (creating `custom/`); returns `[]` on success or a list of error strings on shape rejection. Never writes the base.
  - `GET /api/vocab` → `{"merged": <load_vocab()>, "overlay": <raw CONTENT_ROOT overlay dict or {}>}`.
  - `PUT /api/vocab` (body = overlay dict) → `{"ok": bool, "errors": [str]}`.

- [ ] **Step 1: Add failing tests** to `src/scripts/tests/test_workflow_vocab.py`:

```python
def test_save_vocab_overlay_writes_only_overlay(tmp_path, monkeypatch):
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"version": 1, "knobs": {"tone": {"options": [
        {"value": "warm", "definition": "Friendly.", "prose": "Write in a warm tone."}]}}})
    assert errs == []
    written = tmp_path / "custom" / "vocab.yaml"
    assert written.is_file()
    import yaml as _y
    got = _y.safe_load(written.read_text())
    assert got["knobs"]["tone"]["options"][0]["value"] == "warm"


def test_save_vocab_overlay_rejects_unknown_knob(tmp_path, monkeypatch):
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"knobs": {"nope": {"options": []}}})
    assert errs and any("nope" in e for e in errs)
    assert not (tmp_path / "custom" / "vocab.yaml").exists()
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_vocab.py -k save_vocab -v`
Expected: FAIL — `save_vocab_overlay` undefined.

- [ ] **Step 3: Implement `save_vocab_overlay`** in `src/scripts/bb-workflow` (next to `load_vocab`):

```python
_VOCAB_KNOBS = ("length", "tone", "format", "audience", "language", "stance")


def save_vocab_overlay(overlay):
    """Validate (shape only) and write the current root's overlay
    (CONTENT_ROOT/custom/vocab.yaml). Never touches the base. Returns [] or
    a list of error strings. The knob set is fixed; overlays only extend
    options within it."""
    errors = []
    if not isinstance(overlay, dict):
        return ["overlay must be an object"]
    knobs = overlay.get("knobs") or {}
    if not isinstance(knobs, dict):
        return ["knobs must be an object"]
    for kname, kpatch in knobs.items():
        if kname not in _VOCAB_KNOBS:
            errors.append(f"unknown knob '{kname}'")
            continue
        for opt in (kpatch.get("options") or []):
            v = opt.get("value")
            if not isinstance(v, str) or not v.strip():
                errors.append(f"{kname}: option missing a string value")
            for field in ("definition", "prose", "label", "hint"):
                if field in opt and not isinstance(opt[field], str):
                    errors.append(f"{kname}.{v}: {field} must be a string")
    if errors:
        return errors
    out = {"version": overlay.get("version", 1),
           "knobs": {k: knobs[k] for k in knobs}}
    dest = CONTENT_ROOT / "custom" / "vocab.yaml"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(yaml.safe_dump(out, sort_keys=False, allow_unicode=True),
                    encoding="utf-8")
    return []


def _raw_vocab_overlay():
    """The current root's overlay dict as-authored (for the editor to edit and
    PUT back), or {} if absent."""
    p = CONTENT_ROOT / "custom" / "vocab.yaml"
    return (yaml.safe_load(p.read_text(encoding="utf-8")) or {}) if p.is_file() else {}
```

- [ ] **Step 4: Add the GET route.** In `_route_get`, before the final `return self._json(404, ...)` (~line 4331):

```python
            if p == "/api/vocab":
                return self._json(200, {"merged": load_vocab(),
                                        "overlay": _raw_vocab_overlay()})
```

- [ ] **Step 5: Add the PUT route.** In `_route_put`, before its final `return` (~line 4398):

```python
            if p == "/api/vocab":
                errs = save_vocab_overlay(self._body())
                return self._json(200 if not errs else 422,
                                  {"ok": not errs, "errors": errs})
```

- [ ] **Step 6: Add `.gitignore` rule.** Append to `.gitignore`:

```
# User vocabulary / config overlay (survives engine upgrades; never committed)
/custom/
```

- [ ] **Step 7: Run tests**

Run: `pytest src/scripts/tests/test_workflow_vocab.py -v`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/scripts/bb-workflow .gitignore src/scripts/tests/test_workflow_vocab.py
git commit -m "feat(vocab): save_vocab_overlay + GET/PUT /api/vocab; gitignore /custom/

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `vocab.js` — `knobView` + `renderVocabEditor` (+ bun tests)

**Files:**
- Create: `src/workflow/templates/webedit/vocab.js`
- Test: `src/scripts/tests/webedit/vocab.test.js`

**Interfaces:**
- Consumes: the `GET /api/vocab` payload shape (Task 3).
- Produces:
  - `knobView(vocab, name) -> {kind, optional, supportsCustom, options, scale, labels, hints, defs}` — pure derivation from a merged vocab object. `labels`/`scale` are arrays aligned by index; `hints`/`defs` are `{value: string}` maps. Safe defaults when `vocab`/knob is absent.
  - `renderVocabEditor(root, ctx)` — mounts the editor into `root`. `ctx = {getMerged(): object, getOverlay(): object, onSave(overlay): Promise<{ok,errors}>}`. Base options render read-only-badged but editable (edits become overrides); an "add option" control prefills prose from the knob template. "Save" calls `ctx.onSave(overlay)`.

- [ ] **Step 1: Write the failing test** — `src/scripts/tests/webedit/vocab.test.js`:

```javascript
import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { knobView, renderVocabEditor } from "../../../workflow/templates/webedit/vocab.js";

const MERGED = { version: 1, knobs: {
  tone: { kind: "ordinal", optional: true, supports_custom: true,
          prose_template: "Write in a {value} tone.", options: [
    { value: "direct", definition: "To the point.", prose: "Write in a direct tone.", source: "base", overridden: false },
    { value: "warm", label: "warm", definition: "Friendly.", prose: "Write in a warm tone.", source: "overlay", overridden: false } ] },
  language: { kind: "nominal", prose_template: "Respond in {value}.", options: [
    { value: "inherit", label: "↩ inherit", definition: "Default.", prose: "", source: "base", overridden: false } ] },
}};

test("knobView derives scale/labels/hints/defs", () => {
  const kv = knobView(MERGED, "tone");
  expect(kv.kind).toBe("ordinal");
  expect(kv.supportsCustom).toBe(true);
  expect(kv.scale).toEqual(["direct", "warm"]);
  expect(kv.labels).toEqual(["direct", "warm"]);
  expect(kv.defs.direct).toBe("To the point.");
});

test("knobView is safe on a missing knob", () => {
  const kv = knobView(MERGED, "nope");
  expect(kv.scale).toEqual([]);
  expect(kv.kind).toBe("ordinal");
});

test("editor: adding an option prefills prose from the template and builds the overlay", async () => {
  const { document } = parseHTML("<!doctype html><body></body>");
  globalThis.document = document;
  let saved = null;
  const ctx = { getMerged: () => MERGED, getOverlay: () => ({ version: 1, knobs: {} }),
                onSave: (ov) => { saved = ov; return Promise.resolve({ ok: true, errors: [] }); } };
  const root = document.createElement("div"); document.body.appendChild(root);
  renderVocabEditor(root, ctx);
  // add a "brisk" option to tone
  const addBtn = [...root.querySelectorAll("[data-add-knob='tone']")][0];
  expect(addBtn).toBeTruthy();
  addBtn.dataset.testValue = "brisk";     // the impl reads a prompt shim (see below)
  addBtn.click();
  const proseInput = root.querySelector("[data-opt='tone:brisk'] [data-field='prose']");
  expect(proseInput.value).toBe("Write in a brisk tone.");   // prefilled, NOT an "e.g." example
  root.querySelector("[data-vocab-save]").click();
  await Promise.resolve();
  expect(saved.knobs.tone.options.find(o => o.value === "brisk")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src/scripts/tests/webedit && bun test vocab.test.js`
Expected: FAIL — `vocab.js` does not exist.

- [ ] **Step 3: Implement `src/workflow/templates/webedit/vocab.js`:**

```javascript
// Reusable prompt-assist vocabulary module. `knobView` derives widget-ready
// data from the merged /api/vocab payload (so definition.js drops its local
// constants); `renderVocabEditor` is the editor mounted on the awok settings
// page. Both are consumed by the Definition tab today and reusable by a future
// agent-style editor. The engine stays the source of truth — this never
// recompiles style prose (D5).

export function knobView(vocab, name) {
  const k = vocab && vocab.knobs && vocab.knobs[name];
  if (!k) return { kind: "ordinal", optional: false, supportsCustom: false,
                   options: [], scale: [], labels: [], hints: {}, defs: {} };
  const options = k.options || [];
  const label = o => (o.label != null ? o.label : o.value);
  return {
    kind: k.kind || "ordinal",
    optional: !!k.optional,
    supportsCustom: !!k.supports_custom,
    options,
    scale: options.map(o => o.value),
    labels: options.map(label),
    hints: Object.fromEntries(options.map(o => [o.value, o.hint || ""])),
    defs: Object.fromEntries(options.map(o => [o.value, o.definition || ""])),
  };
}

// Prefill a new option's prose from the knob's template — a real, usable
// sentence, never phrased as an example (so it does not pollute the prompt).
function prefillProse(knob, value) {
  const tmpl = (knob && knob.prose_template) || "";
  return tmpl.replace(/\{value\}/g, value).replace(/\{hint\}/g, "").trim();
}

// Test seam: overridable so bun tests can inject a value without a real prompt.
export function _askOptionValue(btn) {
  if (btn && btn.dataset && btn.dataset.testValue) return btn.dataset.testValue;
  return (typeof prompt === "function") ? prompt("New option value:") : null;
}

const KNOB_ORDER = ["length", "tone", "format", "audience", "language", "stance"];

export function renderVocabEditor(root, ctx) {
  root.replaceChildren();
  const merged = ctx.getMerged() || { knobs: {} };
  // Working overlay copy the editor mutates; PUT back on Save.
  const overlay = JSON.parse(JSON.stringify(ctx.getOverlay() || { version: 1, knobs: {} }));
  overlay.version = overlay.version || 1;
  overlay.knobs = overlay.knobs || {};

  const upsert = (knob, value, field, val) => {
    overlay.knobs[knob] = overlay.knobs[knob] || { options: [] };
    const opts = overlay.knobs[knob].options = overlay.knobs[knob].options || [];
    let o = opts.find(x => x.value === value);
    if (!o) { o = { value }; opts.push(o); }
    o[field] = val;
  };

  const wrap = document.createElement("div"); wrap.className = "vocab-editor";
  const intro = document.createElement("p"); intro.className = "vocab-intro";
  intro.textContent = "Prompt-assist vocabulary — global to awok. Base options are shipped; your edits and additions are saved to this project's custom/ overlay and survive engine upgrades.";
  wrap.appendChild(intro);

  KNOB_ORDER.forEach(name => {
    const kmeta = (merged.knobs && merged.knobs[name]) || null;
    if (!kmeta) return;
    const sec = document.createElement("section"); sec.className = "vocab-knob";
    const h = document.createElement("h3"); h.textContent = name; sec.appendChild(h);

    (kmeta.options || []).forEach(o => {
      const row = document.createElement("div"); row.className = "vocab-opt";
      row.dataset.opt = name + ":" + o.value;
      const head = document.createElement("div"); head.className = "vocab-opt-head";
      const val = document.createElement("span"); val.className = "vocab-val"; val.textContent = o.value;
      const badge = document.createElement("span"); badge.className = "vocab-src vocab-src-" + o.source;
      badge.textContent = o.source === "base" ? (o.overridden ? "base · reworded" : "base") : "custom";
      head.appendChild(val); head.appendChild(badge); row.appendChild(head);

      const mk = (field, ph) => {
        const inp = document.createElement("input");
        inp.type = "text"; inp.dataset.field = field; inp.placeholder = ph;
        inp.value = o[field] || "";
        inp.addEventListener("input", () => upsert(name, o.value, field, inp.value));
        const l = document.createElement("label"); l.className = "vocab-field";
        l.append(field, inp); return l;
      };
      row.appendChild(mk("definition", "what this option means (shown in the editor)"));
      row.appendChild(mk("prose", "sentence injected into the prompt"));
      sec.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "vocab-add"; add.textContent = "+ option"; add.dataset.addKnob = name;
    add.addEventListener("click", () => {
      const v = _askOptionValue(add);
      if (!v) return;
      const prose = prefillProse(kmeta, v);
      upsert(name, v, "prose", prose);
      upsert(name, v, "definition", "");
      // Reflect the new option live: append a row mirroring the base rows.
      const row = document.createElement("div"); row.className = "vocab-opt"; row.dataset.opt = name + ":" + v;
      const head = document.createElement("div"); head.className = "vocab-opt-head";
      const val = document.createElement("span"); val.className = "vocab-val"; val.textContent = v;
      const badge = document.createElement("span"); badge.className = "vocab-src vocab-src-overlay"; badge.textContent = "custom";
      head.appendChild(val); head.appendChild(badge); row.appendChild(head);
      const mk = (field, value) => {
        const inp = document.createElement("input"); inp.type = "text"; inp.dataset.field = field; inp.value = value;
        inp.addEventListener("input", () => upsert(name, v, field, inp.value));
        const l = document.createElement("label"); l.className = "vocab-field"; l.append(field, inp); return l;
      };
      row.appendChild(mk("definition", "")); row.appendChild(mk("prose", prose));
      add.parentElement.insertBefore(row, add);
    });
    sec.appendChild(add);
    wrap.appendChild(sec);
  });

  const bar = document.createElement("div"); bar.className = "vocab-bar";
  const save = document.createElement("button"); save.textContent = "Save vocabulary";
  save.dataset.vocabSave = "1";
  const status = document.createElement("span"); status.className = "vocab-status";
  save.addEventListener("click", async () => {
    const r = await ctx.onSave(overlay);
    status.textContent = r && r.ok ? "✓ saved" : "✗ " + (((r && r.errors) || ["error"]).join("; "));
  });
  bar.appendChild(save); bar.appendChild(status); wrap.appendChild(bar);
  root.appendChild(wrap);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src/scripts/tests/webedit && bun test vocab.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/vocab.js src/scripts/tests/webedit/vocab.test.js
git commit -m "feat(webedit): vocab.js — knobView + renderVocabEditor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `definition.js` consumes the vocab (drop constants)

**Files:**
- Modify: `src/workflow/templates/webedit/definition.js` (delete lines ~29-39; `formatterSection` knob wiring ~430-463; `bigSlider`/`chipsControl` signatures ~722, ~765)
- Modify: `src/workflow/templates/webedit/editor.js` (fetch `/api/vocab`; `definitionCtx`)
- Test: `src/scripts/tests/webedit/definition.test.js` (provide `ctx.vocab`)

**Interfaces:**
- Consumes: `knobView` (Task 4); `ctx.vocab` = the merged vocab object.
- Produces: `definitionCtx()` now returns `{..., vocab: <merged>}`; `renderDefinition` reads `ctx.vocab` (falls back to empty knobs when absent).

- [ ] **Step 1: Update the failing test** — in `src/scripts/tests/webedit/definition.test.js`, add a shared merged-vocab fixture and pass it in `ctx`. Add near the top (after imports):

```javascript
const VOCAB = { version: 1, knobs: {
  length: { kind: "ordinal", optional: true, options: [
    { value: "terse", hint: "~40 words", definition: "d", prose: "p", source: "base", overridden: false },
    { value: "brief", hint: "~150 words", definition: "d", prose: "p", source: "base", overridden: false },
    { value: "standard", hint: "~400 words", definition: "d", prose: "p", source: "base", overridden: false } ] },
  tone: { kind: "ordinal", optional: true, supports_custom: true, options: [
    { value: "direct", definition: "d", prose: "p", source: "base", overridden: false } ] },
  format: { kind: "ordinal", optional: true, options: [
    { value: "prose", definition: "d", prose: "p", source: "base", overridden: false } ] },
  audience: { kind: "ordinal", optional: true, options: [
    { value: "maintainer", definition: "d", prose: "p", source: "base", overridden: false } ] },
  language: { kind: "nominal", options: [
    { value: "inherit", label: "↩ inherit", definition: "d", prose: "", source: "base", overridden: false },
    { value: "French", label: "🇫🇷 French", definition: "d", prose: "p", source: "base", overridden: false } ] },
  stance: { kind: "nominal", optional: true, options: [
    { value: "recommend", definition: "d", prose: "p", source: "base", overridden: false } ] },
}};
```

Then, in every place the test builds a `ctx` for `renderDefinition`, add `vocab: VOCAB`. (Search the file for the `ctx` object literals passed to `renderDefinition`; add the key to each. The existing assertions on the `length` slider and the `French` chip must still pass — they now come from `VOCAB`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd src/scripts/tests/webedit && bun test definition.test.js`
Expected: FAIL — `renderDefinition` still reads the deleted constants (once Step 3 lands) / the slider is empty without `ctx.vocab`. (If run before Step 3, it passes on old constants — so run after Step 3 to see the wiring.)

- [ ] **Step 3: Rewire `definition.js`.** Delete the constants block (lines ~29-39). Add the import (line ~16 area):

```javascript
import { knobView } from "./vocab.js";
```

Replace the knob wiring inside `formatterSection` (lines ~429-463) with vocab-driven equivalents:

```javascript
  const V = ctx.vocab || { knobs: {} };
  const kLen = knobView(V, "length"), kTone = knobView(V, "tone"),
        kFmt = knobView(V, "format"), kAud = knobView(V, "audience"),
        kLang = knobView(V, "language"), kStance = knobView(V, "stance");

  // length — ordinal slider with a word-count readout + per-option definitions.
  knobs.appendChild(bigSlider("length", "How long should the final answer be?", kLen.scale, kLen.labels,
    st.length || "", v => (v ? v + (kLen.hints[v] ? " · " + kLen.hints[v] : "") : "none"),
    v => { if (v) st.length = v; else delete st.length; ctx.refreshView(); }, kLen.defs));

  if (st.tone === "custom") {
    const cf = fieldText("tone · custom voice", st.toneCustom || "", v => { if (v) st.toneCustom = v; else delete st.toneCustom; ctx.refreshView(); });
    cf.querySelector("input").placeholder = "e.g. warm, like explaining to a smart friend";
    knobs.appendChild(cf);
    knobs.appendChild(actionChip("↩ use the tone scale", () => { delete st.tone; delete st.toneCustom; rerender(); ctx.refreshView(); }));
  } else {
    knobs.appendChild(bigSlider("tone", "Most direct → most beginner-friendly.", kTone.scale, kTone.labels,
      st.tone || "", v => v || "none",
      v => { if (v) st.tone = v; else delete st.tone; ctx.refreshView(); }, kTone.defs));
    if (kTone.supportsCustom)
      knobs.appendChild(actionChip("✎ custom voice…", () => { st.tone = "custom"; delete st.toneCustom; rerender(); ctx.refreshView(); }));
  }

  knobs.appendChild(bigSlider("format", "Least → most structured.", kFmt.scale, kFmt.labels,
    st.format || "", v => { const i = kFmt.scale.indexOf(v); return i < 0 ? "none" : kFmt.labels[i]; },
    v => { if (v) st.format = v; else delete st.format; ctx.refreshView(); }, kFmt.defs));

  knobs.appendChild(bigSlider("audience (optional)", "Internal → external reader.", kAud.scale, kAud.labels,
    st.audience || "", v => { const i = kAud.scale.indexOf(v); return i < 0 ? "none" : kAud.labels[i]; },
    v => { if (v) st.audience = v; else delete st.audience; ctx.refreshView(); }, kAud.defs));

  const langLabels = Object.fromEntries(kLang.scale.map((v, i) => [v, kLang.labels[i]]));
  knobs.appendChild(chipField("language", "Output language; inherit = follow the session/default.",
    chipsControl(kLang.scale, st.language || "inherit", v => { st.language = v; ctx.refreshView(); }, langLabels, kLang.defs)));

  const stanceLabels = Object.fromEntries(kStance.scale.map((v, i) => [v, kStance.labels[i]]));
  knobs.appendChild(chipField("stance (optional)", "recommend = give a clear pick · present = lay out options.",
    chipsControl(["", ...kStance.scale], st.stance || "", v => { if (v) st.stance = v; else delete st.stance; ctx.refreshView(); }, stanceLabels, kStance.defs)));
```

Enhance `bigSlider` (line ~722) to accept an optional `defs` map and set `title` on each stop. Change the signature and the stop-building loop:

```javascript
function bigSlider(labelText, help, scale, labels, current, readoutFor, commit, defs) {
```
and inside the `full.forEach((v, i) => {...})` loop, after computing `sp`, add:
```javascript
    if (defs && defs[v]) sp.title = defs[v];
```

Enhance `chipsControl` (line ~765) to accept an optional `defs` map:
```javascript
function chipsControl(values, current, commit, labels, defs) {
```
and inside its `values.forEach(v => {...})`, after setting `chip.textContent`, add:
```javascript
    if (defs && defs[v]) chip.title = defs[v];
```

- [ ] **Step 4: Wire the vocab fetch in `editor.js`.** Add `vocab: null` to the `state` initializer (line ~34). In the `DOMContentLoaded` handler (line ~1139, near `loadList()`), fetch once:

```javascript
  api("GET", "/api/vocab").then(r => { state.vocab = (r.j && r.j.merged) || { knobs: {} };
    if (state.tab === "definition") definition.renderDefinition($("#definition"), definitionCtx()); });
```

Update `definitionCtx()` (line ~1077) to expose the merged vocab:

```javascript
function definitionCtx() {
  return { getModel: () => state.model, setModel: m => { state.model = m; }, refreshView,
           view: state.view || {}, vocab: state.vocab || { knobs: {} } };
}
```

- [ ] **Step 5: Run the webedit suite**

Run: `cd src/scripts/tests/webedit && bun test`
Expected: PASS — `definition.test.js` (now vocab-fed), `vocab.test.js`, and the rest.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/definition.js src/workflow/templates/webedit/editor.js src/scripts/tests/webedit/definition.test.js
git commit -m "refactor(webedit): definition tab renders knobs from the vocab (drop constants)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: awok settings page (⚙ button + top-level view toggle) hosting the vocab editor

**Files:**
- Modify: `src/workflow/templates/webedit/editor.html` (⚙ button in `brand`; `<section id="page-awok">`)
- Modify: `src/workflow/templates/webedit/editor.js` (view toggle + mount `renderVocabEditor`)
- Modify: `src/workflow/templates/webedit/editor.css` (page + editor styles)
- Test: `src/scripts/tests/webedit/vocab.test.js` (add a mount-toggle DOM assertion is optional — the manual smoke below is the acceptance)

**Interfaces:**
- Consumes: `renderVocabEditor` (Task 4); `GET`/`PUT /api/vocab` (Task 3).
- Produces: `enterAwokPage()` / `exitAwokPage()` in `editor.js` — a top-level view toggle distinct from `switchTab`, preserving the in-memory workflow model.

- [ ] **Step 1: Add the ⚙ button + page section** in `editor.html`. In the `brand` div (lines ~14-17), after the wordmark:

```html
      <button id="awok-settings-btn" class="icon-btn" title="awok settings (vocabulary)">⚙</button>
```

After the closing `</main>` (or as the last child of `<main>`), add the page section:

```html
    <!-- awok settings (global, outside any workflow) -->
    <section id="page-awok" class="awok-page" hidden>
      <header class="awok-page-head">
        <button id="awok-back" class="btn-ghost">← Workflow</button>
        <h2>awok settings</h2>
      </header>
      <nav class="awok-page-nav"><button class="awok-sec active" data-sec="vocab">Vocabulary</button></nav>
      <div id="awok-vocab"></div>
    </section>
```

- [ ] **Step 2: Implement the view toggle** in `editor.js`. Add near `switchTab` (~line 1126):

```javascript
import { renderVocabEditor } from "./vocab.js";

async function openVocabEditor() {
  const { j } = await api("GET", "/api/vocab");
  const merged = (j && j.merged) || { knobs: {} };
  const overlay = (j && j.overlay) || { version: 1, knobs: {} };
  state.vocab = merged;   // keep the definition tab in sync with any fresh edits
  renderVocabEditor($("#awok-vocab"), {
    getMerged: () => merged,
    getOverlay: () => overlay,
    onSave: async (ov) => {
      const r = await api("PUT", "/api/vocab", ov);
      if (r.status === 200) {
        const fresh = await api("GET", "/api/vocab");
        state.vocab = (fresh.j && fresh.j.merged) || merged;
      }
      return (r.j) || { ok: r.status === 200, errors: [] };
    },
  });
}
function enterAwokPage() {
  document.querySelectorAll("#tabs, main > .panel").forEach(el => el.classList.add("awok-hidden"));
  $("#page-awok").hidden = false;
  openVocabEditor();
}
function exitAwokPage() {
  $("#page-awok").hidden = true;
  document.querySelectorAll("#tabs, main > .panel").forEach(el => el.classList.remove("awok-hidden"));
  // Re-render the active workflow tab from the (preserved) in-memory model.
  if (state.tab === "definition") definition.renderDefinition($("#definition"), definitionCtx());
}
```

Wire the buttons in `DOMContentLoaded` (after the `wf-save` listener, ~line 1150):

```javascript
  $("#awok-settings-btn").addEventListener("click", enterAwokPage);
  $("#awok-back").addEventListener("click", exitAwokPage);
```

- [ ] **Step 3: Add styles** to `editor.css` (append at end):

```css
/* awok settings — a top-level page outside any workflow */
.awok-hidden { display: none !important; }
.awok-page { padding: 18px 22px; max-width: 900px; margin: 0 auto; }
.awok-page-head { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
.awok-page-head h2 { margin: 0; font-size: 18px; }
.awok-page-nav { display: flex; gap: 8px; margin: 10px 0 18px; border-bottom: 1px solid var(--border); }
.awok-sec { background: transparent; border: none; color: var(--dim); padding: 8px 10px; cursor: pointer; }
.awok-sec.active { color: var(--text); border-bottom: 2px solid var(--accent); }
.vocab-intro { color: var(--dim); font-size: 12px; line-height: 1.6; margin: 0 0 16px; }
.vocab-knob { margin-bottom: 20px; }
.vocab-knob h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); margin: 0 0 8px; }
.vocab-opt { background: var(--well); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.vocab-opt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.vocab-val { font: 12px var(--mono); color: var(--text); }
.vocab-src { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--dim); }
.vocab-src-overlay { color: var(--accent); border-color: var(--accent); }
.vocab-field { display: flex; flex-direction: column; gap: 3px; font-size: 10px; color: var(--dim); margin-top: 6px; }
.vocab-field input { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 6px 8px; font: 12px var(--mono); outline: none; }
.vocab-add { margin-top: 4px; background: transparent; border: 1px dashed var(--border); border-radius: 7px; color: var(--dim); padding: 6px 12px; cursor: pointer; }
.vocab-bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 12px 0; background: var(--bg); border-top: 1px solid var(--border); }
.vocab-status { font-size: 12px; color: var(--dim); }
```

(If any CSS var above is undefined in `editor.css`, substitute the nearest existing one — check the `:root` block at the top of `editor.css`.)

- [ ] **Step 4: Manual smoke test.** Run the editor and verify the page toggles and a save round-trips:

```bash
./install.sh >/dev/null 2>&1; awok edit --no-browser --port 8765 &
sleep 1
curl -s localhost:8765/api/vocab | python3 -c "import sys,json; d=json.load(sys.stdin); print('knobs', list(d['merged']['knobs'])); print('overlay', d['overlay'])"
curl -s -X PUT localhost:8765/api/vocab -H 'Content-Type: application/json' \
  -d '{"version":1,"knobs":{"tone":{"options":[{"value":"warm","definition":"Friendly.","prose":"Write in a warm tone."}]}}}' | cat
curl -s localhost:8765/api/vocab | python3 -c "import sys,json; d=json.load(sys.stdin); print([o['value'] for o in d['merged']['knobs']['tone']['options']])"
kill %1
```

Expected: first call lists the six knobs and `overlay {}`; the PUT returns `{"ok": true, "errors": []}`; the third call shows `warm` appended to tone. Then **delete the smoke overlay** so it does not linger: `rm -f custom/vocab.yaml` (it is gitignored regardless).

- [ ] **Step 5: Run the full webedit suite (no regressions)**

Run: `cd src/scripts/tests/webedit && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/editor.html src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(webedit): awok settings page hosting the vocabulary editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Ripple, docs, and TODO

**Files:**
- Regenerate: `src/skills/*/SKILL.md`, `docs/architecture-cartography/*` (expect **zero** diff)
- Modify: `CLAUDE.md` (document the vocab store), `TODO.md` (check off C5)

**Interfaces:** none (finalization).

- [ ] **Step 1: Validate + regenerate + drift-check**

Run:
```bash
awok validate && awok generate && awok check
```
Expected: `validate` clean; `generate` writes no change to any `SKILL.md`/cartography (confirm with `git status --short` showing no `src/skills/` or `docs/architecture-cartography/` changes); `check` exits 0 (green).

- [ ] **Step 2: Run the entire test suite**

Run:
```bash
pytest src/scripts/tests/test_workflow_*.py -q && (cd src/scripts/tests/webedit && bun test)
```
Expected: all PASS.

- [ ] **Step 3: Document the vocab store in `CLAUDE.md`.** Add a subsection under "Workflow conventions" (after the "Descriptions convention" section) — concise, matching the file's tone:

```markdown
### Prompt-assist vocabularies (`vocab.yaml` + `custom/` overlay)

The formatter's prompt-assist knobs (`length`, `tone`, `format`, `audience`,
`language`, `stance`) are a **data-driven vocabulary**, global to the engine
(not per-workflow). Two layers, merged by `load_vocab()`:

- **Base** — `src/workflow/vocab.yaml` (engine, canonical, versioned). Each option
  carries a human `definition` and the injected `prose`.
- **User overlay** — `custom/vocab.yaml` at the project root (**gitignored**, survives
  engine upgrades and `install.sh`). Resolution: base ← `ENGINE_ROOT/custom` ←
  `CONTENT_ROOT/custom`. An overlay may **add** or **reword** options, never delete;
  the knob set is fixed.

`compile_style()` reads the merged store (no hardcoded maps); unknown values fall back
to the knob's `prose_template`, so `def_formatter.style` stays schema-open. The web
editor reads it via `GET /api/vocab` and edits the current root's overlay via
`PUT /api/vocab` (a dedicated awok settings page, the ⚙ button). Never hand-edit a
generated SKILL.md. Design: `docs/superpowers/specs/2026-07-20-editable-formatter-vocabularies-design.md`.
```

- [ ] **Step 4: Check off C5 in `TODO.md`.** Change the `- [ ] **C5 —` line to `- [x] **C5 —` and append a one-line closure note (mirroring C6's style) referencing the design/plan docs and the `custom/vocab.yaml` overlay.

- [ ] **Step 5: Commit (with the ripple trailer)**

```bash
git add -A
git commit -m "docs(vocab): document the vocab store; close C5

Regen: no SKILL.md change (no workflow uses formatter.style yet);
       workdir owners run \`awok generate && awok deploy\` after pulling.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Redeploy**

Run: `./install.sh`
Expected: wrappers + skills/agents deployed; no restart needed (no new agent).

---

## Self-Review

**Spec coverage** (against `2026-07-20-editable-formatter-vocabularies-design.md`):
- §3 storage/3-layer/merge → Task 1 (`_vocab_overlay_paths`, `load_vocab` merge, provenance) + Task 3 (`.gitignore /custom/`). ✔
- §4 option model (definition + prose editable, extras, prose_template fallback, schema open) → Task 1 (base file) + Task 2 (`compile_style` + fallback; schema untouched). ✔
- §4.4 base prose optimal/behavior-preserving → Task 2 (golden substrings reproduced, base-prose pin). ✔
- §5 engine module (`load_vocab`, `save_vocab_overlay`) → Tasks 1 & 3. ✔
- §6 API (`GET`/`PUT /api/vocab`, project-scoped, preview unchanged) → Task 3. ✔
- §7.1 `vocab.js` generic module; definition.js drops constants; add-option prefill (not an example) → Tasks 4 & 5. ✔
- §7.2 separate top-level awok page via ⚙, back affordance, workflow model preserved → Task 6. ✔
- §8 tests (merge, upgrade survival, compile_style+fallback, save scope, knobView, editor patch) → Tasks 1-6. ✔ (Upgrade survival: `save_vocab_overlay` is the only writer of `custom/`; `load_vocab`/`generate` never write it — asserted in `test_save_vocab_overlay_writes_only_overlay` and the zero-diff `awok check` in Task 7.)
- §9 ripple discipline → Task 7. ✔
- §10 out-of-scope items are not implemented (no delete/hidden, no knob add, no schema tighten). ✔

**Placeholder scan:** every code step carries full code; no TBD/TODO. ✔

**Type consistency:** `load_vocab()` return shape (knobs→options with `source`/`overridden`) is consumed identically by `compile_style` (`_vocab_prose`), the GET route, and `knobView`. `knobView` output (`scale`/`labels`/`hints`/`defs`/`supportsCustom`) matches definition.js usage. `renderVocabEditor` ctx (`getMerged`/`getOverlay`/`onSave`) matches the editor.js wiring in Task 6 and the bun test in Task 4. ⚙ handlers (`enterAwokPage`/`exitAwokPage`) match the `editor.html` ids (`awok-settings-btn`, `awok-back`, `page-awok`, `awok-vocab`). ✔

**Note for the implementer:** exact line numbers are pre-change references — always locate by the quoted surrounding code, which is authoritative.
