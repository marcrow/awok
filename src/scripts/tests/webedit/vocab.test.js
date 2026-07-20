import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { knobView, renderVocabEditor } from "../../../workflow/templates/webedit/vocab.js";

const MERGED = { version: 1, knobs: {
  tone: { kind: "ordinal", optional: true, supports_custom: true,
          prose_template: "Write in a {value} tone.", options: [
    { value: "direct", weight: 10, definition: "To the point.", prose: "Write in a direct tone.", source: "base", overridden: false },
    { value: "warm", weight: 60, label: "warm", definition: "Friendly.", prose: "Write in a warm tone.", source: "overlay", overridden: false, layer: "workdir" } ] },
  language: { kind: "nominal", prose_template: "Respond in {value}.", options: [
    { value: "inherit", weight: 10, label: "↩ inherit", definition: "Default.", prose: "", source: "base", overridden: false } ] },
}};
const PATHS = { engine: "/awok/custom/vocab.yaml", workdir: "/proj/custom/vocab.yaml" };

const fire = (el, type) => el.dispatchEvent(new el.ownerDocument.defaultView.Event(type));
const fireInput = el => fire(el, "input");

function mount(opts = {}) {
  const { document } = parseHTML("<!doctype html><body></body>");
  globalThis.document = document;
  let saved = null;
  const ctx = { getMerged: () => MERGED, sameRoot: !!opts.sameRoot, paths: opts.paths || PATHS,
                onSave: (ov) => { saved = ov; return Promise.resolve({ ok: true, errors: [] }); } };
  const root = document.createElement("div"); document.body.appendChild(root);
  renderVocabEditor(root, ctx);
  return { root, save: () => root.querySelector("[data-vocab-save]").click(), get saved() { return saved; } };
}

const stops = (root, knob) =>
  [...root.querySelectorAll(`[data-knob='${knob}'] .def-slider .stops span`)]
    .map(s => s.textContent).filter(t => t !== "none");
const selectStop = (root, knob, value) =>
  fire([...root.querySelectorAll(`[data-knob='${knob}'] .def-slider .stops span`)]
    .find(s => s.textContent === value), "click");

test("knobView derives scale/labels/hints/defs", () => {
  const kv = knobView(MERGED, "tone");
  expect(kv.scale).toEqual(["direct", "warm"]);
  expect(kv.defs.direct).toBe("To the point.");
});

test("knobView is safe on a missing knob", () => {
  const kv = knobView(MERGED, "nope");
  expect(kv.scale).toEqual([]);
  expect(kv.kind).toBe("ordinal");
});

test("editor renders a slider selector per knob, ordered by weight", () => {
  const { root } = mount();
  expect(root.querySelector("[data-knob='tone'] .def-slider")).toBeTruthy();
  expect(stops(root, "tone")).toEqual(["direct", "warm"]);
});

test("editor shows the edit card for the lowest-weight option by default", () => {
  const { root } = mount();
  const card = root.querySelector("[data-knob='tone'] .vocab-card");
  expect(card.dataset.editing).toBe("tone:direct");
  expect(card.querySelector("[data-field='definition']").value).toBe("To the point.");
  expect(card.querySelector("[data-del]")).toBeNull();          // base is not deletable
});

test("adding a custom option is inline (no prompt) and auto-fills prose from the value", () => {
  const { root } = mount();
  root.querySelector("[data-knob='tone'] [data-add-knob='tone']").click();
  const valInput = root.querySelector("[data-knob='tone'] [data-field='value']");
  expect(valInput).toBeTruthy();
  valInput.value = "brisk"; fireInput(valInput);
  expect(root.querySelector("[data-knob='tone'] [data-field='prose']").value).toBe("Write in a brisk tone.");
});

test("adding then saving writes the custom option to the workdir overlay", async () => {
  const m = mount();
  m.root.querySelector("[data-knob='tone'] [data-add-knob='tone']").click();
  const valInput = m.root.querySelector("[data-knob='tone'] [data-field='value']");
  valInput.value = "brisk"; fireInput(valInput);
  m.save(); await Promise.resolve();
  const brisk = m.saved.workdir.knobs.tone.options.find(o => o.value === "brisk");
  expect(brisk).toBeTruthy();
  expect(brisk.prose).toBe("Write in a brisk tone.");
  expect(m.saved.engine.knobs.tone).toBeUndefined();            // default scope = this project
});

test("a custom option is deletable and disappears from the saved overlay", async () => {
  const m = mount();
  selectStop(m.root, "tone", "warm");
  const card = m.root.querySelector("[data-knob='tone'] .vocab-card");
  expect(card.dataset.editing).toBe("tone:warm");
  const del = card.querySelector("[data-del]");
  expect(del).toBeTruthy();
  del.click();
  m.save(); await Promise.resolve();
  expect(m.saved.workdir.knobs.tone).toBeUndefined();           // only custom → tone drops out
});

test("editing a weight reorders the slider", () => {
  const m = mount();
  selectStop(m.root, "tone", "warm");
  const w = m.root.querySelector("[data-knob='tone'] [data-field='weight']");
  w.value = "5"; fireInput(w);
  expect(stops(m.root, "tone")).toEqual(["warm", "direct"]);
});

test("editing a base option's definition writes an override to the workdir overlay", async () => {
  const m = mount();
  const def = m.root.querySelector("[data-knob='tone'] [data-field='definition']");
  def.value = "Blunt and plain."; fireInput(def);
  m.save(); await Promise.resolve();
  const direct = m.saved.workdir.knobs.tone.options.find(o => o.value === "direct");
  expect(direct.definition).toBe("Blunt and plain.");
});

test("scope toggle routes a custom option to the shared (engine) overlay", async () => {
  const m = mount();
  selectStop(m.root, "tone", "warm");
  const shared = [...m.root.querySelectorAll("[data-knob='tone'] .vocab-scope-opt")]
    .find(b => b.dataset.scope === "engine");
  expect(shared).toBeTruthy();
  shared.click();
  m.save(); await Promise.resolve();
  expect(m.saved.engine.knobs.tone.options.find(o => o.value === "warm")).toBeTruthy();
  expect(m.saved.workdir.knobs.tone).toBeUndefined();           // moved out of the project overlay
});

test("scope toggle is hidden when the two roots are the same file", () => {
  const m = mount({ sameRoot: true });
  expect(m.root.querySelector(".vocab-scope")).toBeNull();
  // custom option with no scope choice still saves (to workdir, the single file)
});
