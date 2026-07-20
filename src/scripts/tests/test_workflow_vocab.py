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


def test_load_vocab_merges_two_overlays_in_sequence(tmp_path, monkeypatch):
    # The headline 3-layer merge: base <- engine-global overlay <- workdir
    # overlay, applied in order. Exercises all three provenance shapes at once:
    # a base option reworded by BOTH overlays, an overlay-added option reworded
    # by the SECOND overlay, and an option only the second overlay ever touches.
    dir_a = tmp_path / "a"; dir_a.mkdir()
    dir_b = tmp_path / "b"; dir_b.mkdir()
    (dir_a / "vocab.yaml").write_text(
        "version: 1\n"
        "knobs:\n"
        "  tone:\n"
        "    options:\n"
        "      - value: direct\n"
        "        definition: \"Overlay-A reworded: blunt and to the point.\"\n"
        "      - value: warm\n"
        "        definition: \"Overlay-A: friendly and encouraging.\"\n"
        "        prose: \"Write in a warm tone.\"\n",
        encoding="utf-8")
    (dir_b / "vocab.yaml").write_text(
        "version: 1\n"
        "knobs:\n"
        "  tone:\n"
        "    options:\n"
        "      - value: direct\n"
        "        prose: \"Overlay-B reworded: speak like a drill sergeant.\"\n"
        "      - value: warm\n"
        "        definition: \"Overlay-B reworded: warm and reassuring.\"\n"
        "      - value: playful\n"
        "        definition: \"Overlay-B added: light and fun.\"\n"
        "        prose: \"Write in a playful tone.\"\n",
        encoding="utf-8")
    # Order matters: engine-global (a) applied first, workdir (b) second.
    monkeypatch.setattr(bbw, "_vocab_overlay_paths",
                         lambda: [dir_a / "vocab.yaml", dir_b / "vocab.yaml"])
    tone = {o["value"]: o for o in bbw.load_vocab()["knobs"]["tone"]["options"]}

    # 1. base option reworded by A then B: both edits land, base provenance kept.
    direct = tone["direct"]
    assert direct["definition"] == "Overlay-A reworded: blunt and to the point."
    assert direct["prose"] == "Overlay-B reworded: speak like a drill sergeant."
    assert direct["source"] == "base" and direct["overridden"] is True

    # 2. overlay-A-added option reworded by overlay B: B's edit wins, A's
    #    untouched field survives, provenance stays "overlay".
    warm = tone["warm"]
    assert warm["definition"] == "Overlay-B reworded: warm and reassuring."
    assert warm["prose"] == "Write in a warm tone."
    assert warm["source"] == "overlay"

    # 3. option only overlay B ever introduces.
    playful = tone["playful"]
    assert playful["definition"] == "Overlay-B added: light and fun."
    assert playful["prose"] == "Write in a playful tone."
    assert playful["source"] == "overlay"


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


def test_compile_style_reflects_overlay(tmp_path, monkeypatch):
    # Prove compile_style reads the MERGED vocab, not just the base: an
    # overlay that rewords tone's `direct` prose must show up verbatim, and
    # the base wording must be gone. If the overlay path were dropped (or
    # _vocab_overlay_paths regressed to []), this would fail on both asserts.
    overlay_dir = tmp_path / "custom"; overlay_dir.mkdir()
    (overlay_dir / "vocab.yaml").write_text(
        "version: 1\n"
        "knobs:\n"
        "  tone:\n"
        "    options:\n"
        "      - value: direct\n"
        "        prose: \"Speak plainly and bluntly.\"\n",
        encoding="utf-8")
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [overlay_dir / "vocab.yaml"])
    lines = bbw.compile_style({"tone": "direct"})
    assert "Speak plainly and bluntly." in lines
    assert "Write in a direct tone." not in lines


def test_vocab_prose_degrades_on_malformed_prose_template(monkeypatch):
    # A malformed prose_template (stray brace) must degrade to no line, not
    # crash `awok generate` with a ValueError.
    def fake_load_vocab():
        return {
            "version": 1,
            "knobs": {
                "tone": {
                    "kind": "ordinal",
                    "prose_template": "Weird {value",
                    "options": [],
                }
            },
        }
    monkeypatch.setattr(bbw, "load_vocab", fake_load_vocab)
    assert bbw.compile_style({"tone": "whatever"}) == []


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


def test_save_vocab_overlay_rejects_non_dict_knob_patch(tmp_path, monkeypatch):
    # A knob patch that isn't an object (e.g. a bare string) must be reported
    # as a clean error, not crash with AttributeError (-> HTTP 500) on
    # kpatch.get(...).
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"knobs": {"tone": "oops"}})
    assert errs and any("tone" in e for e in errs)
    assert not (tmp_path / "custom" / "vocab.yaml").exists()


def test_save_vocab_overlay_rejects_non_dict_option(tmp_path, monkeypatch):
    # A malformed option entry (a bare string instead of an object) must also
    # degrade to a clean error rather than crash on opt.get(...).
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"knobs": {"tone": {"options": ["oops"]}}})
    assert errs and any("tone" in e for e in errs)
    assert not (tmp_path / "custom" / "vocab.yaml").exists()


def test_load_vocab_sorts_options_by_weight(tmp_path, monkeypatch):
    # An overlay-added option with a weight between two base weights lands
    # between them on the slider (options are returned in weight order).
    overlay_dir = tmp_path / "custom"; overlay_dir.mkdir()
    (overlay_dir / "vocab.yaml").write_text(
        "version: 1\n"
        "knobs:\n"
        "  tone:\n"
        "    options:\n"
        "      - value: brisk\n"
        "        weight: 15\n"
        "        prose: Write in a brisk tone.\n",
        encoding="utf-8")
    monkeypatch.setattr(bbw, "_vocab_overlay_paths", lambda: [overlay_dir / "vocab.yaml"])
    order = [o["value"] for o in bbw.load_vocab()["knobs"]["tone"]["options"]]
    assert order[:3] == ["direct", "brisk", "professional"]   # 10, 15, 20


def test_save_vocab_overlay_accepts_weight(tmp_path, monkeypatch):
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"version": 1, "knobs": {"tone": {"options": [
        {"value": "warm", "prose": "Write in a warm tone.", "weight": 25}]}}})
    assert errs == []
    import yaml as _y
    got = _y.safe_load((tmp_path / "custom" / "vocab.yaml").read_text())
    assert got["knobs"]["tone"]["options"][0]["weight"] == 25


def test_save_vocab_overlay_rejects_non_number_weight(tmp_path, monkeypatch):
    monkeypatch.setattr(bbw, "CONTENT_ROOT", tmp_path)
    errs = bbw.save_vocab_overlay({"knobs": {"tone": {"options": [
        {"value": "warm", "weight": "heavy"}]}}})
    assert errs and any("weight" in e for e in errs)
    assert not (tmp_path / "custom" / "vocab.yaml").exists()
