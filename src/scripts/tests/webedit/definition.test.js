// Workflow definition tab (src/workflow/templates/webedit/definition.js).
// Fixture mirrors src/scripts/tests/fixtures/workflows/definition_demo.yaml
// (hand-built as a JS object — this suite never parses YAML, same as the
// other webedit tests). Covers the four behaviors called out in the task-12
// brief: mounts cleanly, a param edit round-trips through ctx.refreshView,
// the D2 "create emit needs a json formatter output" rule surfaces its
// disabled/error state, and the D5 preview is read verbatim from
// ctx.view.definition_preview — never recompiled client-side from the style
// knobs.
import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { renderDefinition } from "../../../workflow/templates/webedit/definition.js";

function dom(){ const { document } = parseHTML("<!DOCTYPE html><body></body>"); globalThis.document = document; return document; }
function ev(node){ return new node.ownerDocument.defaultView.Event("change"); }

function buildModel() {
  return {
    skill: {
      name: "definition-demo",
      description: "Fixture workflow exercising the workflow-level definition contract end to end.",
      title: "/definition-demo — I/O contract fixture",
    },
    namespaces: { work: "work/definition-demo" },
    groups: {
      collect: { description: "Gather the raw material for the channel summary" },
      synthesize: { description: "Turn the raw material into internal artifacts the boundary reads" },
    },
    phases: [
      {
        id: "GATHER", name: "Gather channel highlights", group: "collect", type: "main_agent",
        outputs: [{ role: "work:highlights", kind: "json" }],
      },
      {
        id: "ANALYZE", name: "Analyze sentiment and action items", group: "synthesize", type: "main_agent",
        depends_on: ["GATHER"],
        inputs: [{ role: "work:highlights", kind: "json" }],
        outputs: [{ role: "work:action-items", kind: "md" }],
        emits: [{ name: "sentiment", type: "enum", values: ["positive", "neutral", "negative"], source: "token" }],
      },
    ],
    definition: {
      params: [
        { name: "channel", type: "string", required: true, description: "Target channel name to summarize." },
        { name: "tone", type: "enum", values: ["neutral", "casual", "formal"], default: "neutral" },
        { name: "max_items", type: "number", default: 5 },
        { name: "labels", type: "list", of: "string" },
      ],
      outputs: [
        { role: "work:action-items", kind: "md", produced_by: "promote" },
        { role: "work:summary", kind: "json", produced_by: "formatter" },
      ],
      emits: [
        { name: "sentiment", type: "enum", values: ["positive", "neutral", "negative"], source: "promote", from: "analyze.sentiment" },
        { name: "summary_len", type: "number", source: "create", from: "work:summary", field: "length" },
      ],
      formatter: {
        enabled: true,
        prompt: "Compose the final channel summary from the gathered highlights.",
        invoke: { type: "main_agent" },
        inputs: [{ role: "work:highlights", kind: "json" }],
        style: {
          length: "brief", tone: "professional", format: "bullets", language: "inherit",
          mustInclude: ["channel name"], avoid: ["internal jargon"], stance: "recommend",
        },
      },
    },
  };
}

// Mirrors settings.js's real ctx shape (getModel/setModel/refreshView/view) —
// see how editor.js wires renderSettings/renderDefinition. refreshView is a
// spy: it never mutates the model or re-renders on its own (that's what the
// real one does after the server round-trip resolves), so tests that assert
// "no client-side recompute" can call renderDefinition again themselves to
// simulate the moment right after an edit, before any new view has arrived.
function makeCtx(model, view = {}) {
  let refreshCount = 0;
  const ctx = {
    getModel: () => model,
    setModel: () => {},
    refreshView: () => { refreshCount++; },
    view,
  };
  return { ctx, count: () => refreshCount };
}

test("renderDefinition mounts without throwing on the fixture model and renders every section", () => {
  dom();
  const model = buildModel();
  const { ctx } = makeCtx(model, { errors: [] });
  const root = document.createElement("div");
  expect(() => renderDefinition(root, ctx)).not.toThrow();
  // The front-door hero is a distinct .def-hero (not a .settings-card), with an
  // accent eyebrow and a mode badge; the remaining five sections are cards.
  const hero = root.querySelector(".def-hero");
  expect(!!hero).toBe(true);
  expect(hero.querySelector(".eyebrow .lbl").textContent).toContain("front door");
  expect(!!hero.querySelector(".def-mode.format")).toBe(true); // fixture has an enabled formatter
  const titles = [...root.querySelectorAll(".settings-card .head .t")].map(t => t.textContent);
  expect(titles).toEqual([
    "Params — input side", "Return — outputs & emits",
    "Formatter", "Caller preview", "Stats",
  ]);
});

test("editing a param field calls ctx.refreshView and updates the model in place", () => {
  dom();
  const model = buildModel();
  const { ctx, count } = makeCtx(model);
  const root = document.createElement("div");
  renderDefinition(root, ctx);

  // "description (recommended)" is unique to a param row (the hero's skill
  // description field is labeled plain "description") — first match is
  // definition.params[0] ("channel").
  const label = [...root.querySelectorAll("label")].find(l => l.textContent.startsWith("description (recommended)"));
  expect(!!label).toBe(true);
  const input = label.parentElement.querySelector("input");
  expect(input.value).toBe("Target channel name to summarize.");

  const before = count();
  input.value = "Updated param description";
  input.dispatchEvent(ev(input));

  expect(count()).toBe(before + 1);
  expect(model.definition.params[0].description).toBe("Updated param description");
});

test("a create emit whose chosen output is not kind json surfaces the disabled/error state (D2)", () => {
  dom();
  const model = buildModel();
  // work:summary (the only formatter output) is downgraded to md — the
  // summary_len emit's `from` no longer points at a json output.
  model.definition.outputs[1].kind = "md";
  const { ctx } = makeCtx(model);
  const root = document.createElement("div");
  renderDefinition(root, ctx);

  const fromLabel = [...root.querySelectorAll("label")].find(l => l.textContent.startsWith("from — formatter output (kind json only)"));
  expect(!!fromLabel).toBe(true);
  const fromSelect = fromLabel.parentElement.querySelector("select");
  // no json-kind formatter output exists to choose from -> the dropdown is disabled
  expect(fromSelect.disabled).toBe(true);

  const warn = [...root.querySelectorAll(".warn-box")].find(w => w.textContent.includes("not (or no longer) a formatter output of kind json"));
  expect(!!warn).toBe(true);
});

test("a create emit pointing at a valid json formatter output does NOT surface the D2 warning", () => {
  dom();
  const model = buildModel(); // work:summary stays kind json
  const { ctx } = makeCtx(model);
  const root = document.createElement("div");
  renderDefinition(root, ctx);

  const fromLabel = [...root.querySelectorAll("label")].find(l => l.textContent.startsWith("from — formatter output (kind json only)"));
  const fromSelect = fromLabel.parentElement.querySelector("select");
  expect(fromSelect.disabled).toBe(false);
  const warn = [...root.querySelectorAll(".warn-box")].find(w => w.textContent.includes("not (or no longer) a formatter output of kind json"));
  expect(warn).toBe(undefined);
});

test("the preview reads view.definition_preview verbatim and never recomputes from style knobs client-side (D5)", () => {
  dom();
  const model = buildModel();
  const preview = {
    io_line: "reads work:highlights (json)",
    compiled: ["length: brief", "tone: professional"],
    prompt: "SERVER-COMPOSED FINAL PROMPT",
  };
  const { ctx } = makeCtx(model, { definition_preview: preview, errors: [] });
  const root = document.createElement("div");
  renderDefinition(root, ctx);

  const pre = [...root.querySelectorAll("pre.yaml-pre")].find(p => p.textContent === "SERVER-COMPOSED FINAL PROMPT");
  expect(!!pre).toBe(true);

  // Change a style knob directly on the model (simulating the user's edit)
  // and re-render BEFORE any new server-side view has arrived — ctx.view is
  // deliberately left untouched. A client-side compile would make the
  // rendered prompt/compiled lines track `style.length` immediately; the
  // real implementation must keep showing the same stale server prompt
  // until a fresh definition_preview lands via ctx.view.
  model.definition.formatter.style.length = "exhaustive";
  renderDefinition(root, ctx);

  const preAfter = [...root.querySelectorAll("pre.yaml-pre")].find(p => p.textContent === "SERVER-COMPOSED FINAL PROMPT");
  expect(!!preAfter).toBe(true);
  // the compiled-style chips still list the OLD server knobs from the stale
  // view — not a freshly recomputed "length: exhaustive"
  const chips = [...root.querySelectorAll(".def-style-chip")].map(c => c.textContent);
  expect(chips).toContain("tone: professional");
  expect(chips.some(c => c.includes("exhaustive"))).toBe(false);
});

test("dragging the 'length' slider calls ctx.refreshView, mutates the model, and does NOT tear the tab down (D5)", () => {
  dom();
  const model = buildModel();
  const preview = { io_line: "", compiled: ["length: brief"], prompt: "STALE PROMPT" };
  const { ctx, count } = makeCtx(model, { definition_preview: preview });
  const root = document.createElement("div");
  renderDefinition(root, ctx);

  // length is now an ordinal slider (not a select): find the .def-slider whose
  // header label reads "length", then drive its range input.
  const slider = [...root.querySelectorAll(".def-slider")].find(s => s.querySelector(".lab").textContent.startsWith("length"));
  expect(!!slider).toBe(true);
  const range = slider.querySelector("input[type=range]");
  expect(!!range).toBe(true);
  // full scale is ["","terse","brief","standard","detailed","exhaustive"] -> idx 5
  range.value = "5";
  const inputEv = new range.ownerDocument.defaultView.Event("input");

  const before = count();
  range.dispatchEvent(inputEv);

  expect(count()).toBe(before + 1);
  expect(model.definition.formatter.style.length).toBe("exhaustive");
  // commit() never rerenders -> the tab is not torn down, the stale server
  // preview <pre> is still present (no client recompute), and the readout
  // updated in place from the slider itself (not from a new server view).
  const pre = [...root.querySelectorAll("pre.yaml-pre")].find(p => p.textContent === "STALE PROMPT");
  expect(!!pre).toBe(true);
  expect(slider.querySelector(".readout").textContent).toContain("exhaustive");
});

test("moving the 'length' slider to the none position clears the knob", () => {
  dom();
  const model = buildModel(); // starts at length: "brief"
  const { ctx } = makeCtx(model, { definition_preview: { io_line: "", compiled: [], prompt: "" } });
  const root = document.createElement("div");
  renderDefinition(root, ctx);
  const slider = [...root.querySelectorAll(".def-slider")].find(s => s.querySelector(".lab").textContent.startsWith("length"));
  const range = slider.querySelector("input[type=range]");
  range.value = "0"; // "none"
  range.dispatchEvent(new range.ownerDocument.defaultView.Event("input"));
  expect("length" in model.definition.formatter.style).toBe(false);
});

test("produced_by is a segmented chip control that reclassifies the output on click", () => {
  dom();
  const model = buildModel();
  const { ctx } = makeCtx(model, {});
  const root = document.createElement("div");
  renderDefinition(root, ctx);
  // the first produced_by chip group is the promoted output (work:action-items)
  const pbLabel = [...root.querySelectorAll(".field > label")].find(l => l.textContent.startsWith("produced_by"));
  expect(!!pbLabel).toBe(true);
  const chips = pbLabel.parentElement.querySelector(".def-chips");
  const formatterChip = [...chips.querySelectorAll(".def-chip")].find(c => c.textContent === "formatter");
  expect(!!formatterChip).toBe(true);
  formatterChip.dispatchEvent(new formatterChip.ownerDocument.defaultView.Event("click"));
  expect(model.definition.outputs[0].produced_by).toBe("formatter");
});

test("boolean flags render as awok-flag pill toggles and update the model on click", () => {
  dom();
  const model = buildModel();
  const { ctx } = makeCtx(model, {});
  const root = document.createElement("div");
  renderDefinition(root, ctx);
  // param 'channel' is required -> its flag is pressed
  const reqFlag = [...root.querySelectorAll(".awok-flag")].find(f => f.querySelector(".awok-flag__label").textContent === "required");
  expect(!!reqFlag).toBe(true);
  expect(reqFlag.getAttribute("aria-pressed")).toBe("true");
  // outputs carry terminal/optional flags; the first output (work:action-items)
  // has no terminal -> toggling it flips aria-pressed in place (no rerender) and
  // sets the model.
  const termFlag = [...root.querySelectorAll(".awok-flag")].find(f => f.querySelector(".awok-flag__label").textContent === "terminal");
  expect(!!termFlag).toBe(true);
  expect(termFlag.getAttribute("aria-pressed")).toBe("false");
  termFlag.dispatchEvent(new termFlag.ownerDocument.defaultView.Event("click"));
  expect(model.definition.outputs[0].terminal).toBe(true);
  expect(termFlag.getAttribute("aria-pressed")).toBe("true");
});

test("stats render in the sticky right rail (.def-aside), the form in .def-main", () => {
  dom();
  const model = buildModel();
  const { ctx } = makeCtx(model, {});
  const root = document.createElement("div");
  renderDefinition(root, ctx);
  const aside = root.querySelector(".def-aside");
  expect(!!aside).toBe(true);
  expect([...aside.querySelectorAll(".settings-card .head .t")].map(t => t.textContent)).toContain("Stats");
  const main = root.querySelector(".def-main");
  expect([...main.querySelectorAll(".settings-card .head .t")].map(t => t.textContent)).toContain("Params — input side");
});

test("language chips single-select and commit the chosen language", () => {
  dom();
  const model = buildModel(); // language: "inherit"
  const { ctx, count } = makeCtx(model, { definition_preview: { io_line: "", compiled: [], prompt: "" } });
  const root = document.createElement("div");
  renderDefinition(root, ctx);
  const langLabel = [...root.querySelectorAll(".field > label")].find(l => l.textContent.startsWith("language"));
  expect(!!langLabel).toBe(true);
  const chips = langLabel.parentElement.querySelector(".def-chips");
  const french = [...chips.querySelectorAll(".def-chip")].find(c => c.textContent.includes("French"));
  expect(!!french).toBe(true);
  const before = count();
  french.dispatchEvent(new french.ownerDocument.defaultView.Event("click"));
  expect(count()).toBe(before + 1);
  expect(model.definition.formatter.style.language).toBe("French");
  expect(french.classList.contains("on")).toBe(true);
});
