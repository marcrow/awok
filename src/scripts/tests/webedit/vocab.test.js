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
