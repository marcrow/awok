import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor, resolveIoPath, stringListEditor, signalsEditor } from "../../../workflow/templates/webedit/formfields.js";

function dom(){ const { document } = parseHTML("<!DOCTYPE html><body></body>"); globalThis.document = document; return document; }
function ev(node){ return new node.ownerDocument.defaultView.Event("change"); }
function click(node){ return new node.ownerDocument.defaultView.Event("click"); }

test("fieldText binds value and fires onChange", () => {
  dom();
  let got = null;
  const r = fieldText("name", "hello", v => { got = v; });
  const input = r.querySelector("input");
  expect(input.value).toBe("hello");
  input.value = "world"; input.dispatchEvent(ev(input));
  expect(got).toBe("world");
  expect(r.querySelector("label").textContent).toBe("name");
});

test("fieldDatalist allows free text and lists suggestions", () => {
  dom();
  let got = null;
  const r = fieldDatalist("group", "setup", ["setup", "active-recon"], v => { got = v; });
  const input = r.querySelector("input");
  const dl = r.querySelector("datalist");
  expect(input.value).toBe("setup");
  // suggestions present and wired to the input via list/id
  expect([...dl.querySelectorAll("option")].map(o => o.value)).toEqual(["setup", "active-recon"]);
  expect(input.getAttribute("list")).toBe(dl.id);
  // free text not in the suggestion list is accepted
  input.value = "my-brand-new-group"; input.dispatchEvent(ev(input));
  expect(got).toBe("my-brand-new-group");
});

test("fieldTextarea binds multiline + anti-XSS", () => {
  dom();
  const r = fieldTextarea("desc", "<img onerror=x>\nline2", () => {});
  expect(r.querySelector("img")).toBeNull();
  expect(r.querySelector("textarea").value).toContain("line2");
});

test("fieldSelect selects current + lists options", () => {
  dom();
  let got=null;
  const r = fieldSelect("model", "sonnet", ["inherit","haiku","sonnet","opus"], v=>got=v);
  const sel = r.querySelector("select");
  expect(sel.value).toBe("sonnet");
  expect(sel.querySelectorAll("option").length).toBe(4);
  // linkedom: select.value is readonly; simulate selection via option.selected
  [...sel.querySelectorAll("option")].forEach(o => o.selected = o.value === "opus");
  sel.dispatchEvent(ev(sel));
  expect(got).toBe("opus");
});

test("fieldCheckbox binds boolean", () => {
  dom();
  let got=null;
  const r = fieldCheckbox("background", true, v=>got=v);
  const cb = r.querySelector("input[type=checkbox]");
  expect(cb.checked).toBe(true);
  cb.checked=false; cb.dispatchEvent(ev(cb));
  expect(got).toBe(false);
});

test("ioRefEditor renders rows and adds", () => {
  dom();
  const list = [{ path: "a/b.md", kind: "md" }];
  let changed = null;
  const node = ioRefEditor("inputs", list, next => { changed = next; });
  expect(node.querySelector(".help-icon .help-pop").textContent).toContain("external");
  expect(node.querySelectorAll(".ioref-row").length).toBe(1);
  expect(node.querySelector(".ioref-row input[data-k=path]").value).toBe("a/b.md");
  expect(node.querySelector(".ioref-row select[data-k=kind]").value).toBe("md");
  node.querySelector(".ioref-add").dispatchEvent(click(node));
  expect(changed.length).toBe(2);
  expect(changed[1].kind).toBe("json");
});

test("resolveIoPath mirrors bb-workflow: role+namespaces → path, kind ext, dir, override", () => {
  const ns = { work: "work/onboard" };
  expect(resolveIoPath({ role: "work:inventory", kind: "md" }, ns)).toBe("work/onboard/inventory.md");
  expect(resolveIoPath({ role: "work:db", kind: "sqlite" }, ns)).toBe("work/onboard/db.sqlite");
  expect(resolveIoPath({ role: "work:out", kind: "dir" }, ns)).toBe("work/onboard/out/");
  // role with separate namespace field
  expect(resolveIoPath({ role: "x", namespace: "work", kind: "json" }, ns)).toBe("work/onboard/x.json");
  // explicit path always wins (escape hatch)
  expect(resolveIoPath({ role: "work:inventory", kind: "md", path: "custom/p.md" }, ns)).toBe("custom/p.md");
  // unresolved: unknown namespace / no role
  expect(resolveIoPath({ role: "ghost:x", kind: "md" }, ns)).toBe("");
  expect(resolveIoPath({ kind: "md" }, ns)).toBe("");
});

test("ioRefEditor renders role + resolved-path hint, keeps model role-based", () => {
  dom();
  const list = [{ role: "work:inventory", kind: "md" }];
  let changed = null;
  const node = ioRefEditor("inputs", list, next => { changed = next; }, { work: "work/onboard" });
  expect(node.querySelector(".ioref-row input[data-k=role]").value).toBe("work:inventory");
  expect(node.querySelector(".ioref-resolved").textContent).toContain("work/onboard/inventory.md");
  // editing the role must NOT inject a path key (model stays role-based)
  const roleIn = node.querySelector("input[data-k=role]");
  roleIn.value = "work:structure"; roleIn.dispatchEvent(ev(roleIn));
  expect(changed[0].role).toBe("work:structure");
  expect("path" in changed[0]).toBe(false);
});

test("ioRefEditor edits path/flags through callback", () => {
  dom();
  const list = [{ path: "x", kind: "md" }];
  let changed = null;
  const node = ioRefEditor("outputs", list, next => { changed = next; });
  const pathIn = node.querySelector("input[data-k=path]");
  pathIn.value = "y/z.json"; pathIn.dispatchEvent(ev(pathIn));
  expect(changed[0].path).toBe("y/z.json");
  const ext = node.querySelector("input[data-k=external]");
  ext.checked = true; ext.dispatchEvent(ev(ext));
  expect(changed[0].external).toBe(true);
});

test("triggerEditor lists, adds, reflects 'on'", () => {
  dom();
  const list = [{ on: "file_appears", path: "x" }];
  let changed = null;
  const node = triggerEditor("triggers", list, next => changed = next);
  expect(node.querySelector(".help-icon .help-pop").textContent.length).toBeGreaterThan(10);
  expect(node.querySelectorAll(".trigger-row").length).toBe(1);
  expect(node.querySelector("select[data-k=on]").value).toBe("file_appears");
  node.querySelector(".trigger-add").dispatchEvent(click(node));
  expect(changed.length).toBe(2);
});

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

test("signalsEditor shows an item-type dropdown for a list signal", () => {
  dom();
  let model = [{ name: "hits", type: "list", source: "field", of: "string" }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", model, phase, v => { model = v; });
  const ofSel = r.querySelector("select.signal-of");
  expect(ofSel).not.toBeNull();
  expect(ofSel.value).toBe("string");
});

test("signalsEditor emits of=object with a flat field", () => {
  dom();
  let model = [{ name: "f", type: "list", source: "field", of: { path: "string" } }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", model, phase, v => { model = v; });
  // the object field row exposes a field-name input pre-filled with "path"
  const fieldName = [...r.querySelectorAll("input")].find(i => i.value === "path");
  expect(fieldName).not.toBeNull();
});

test("signalsEditor of-object field rename: collision is a no-op, no data loss", () => {
  dom();
  const of = { a: "string", b: { enum: ["x", "y"] } };
  let model = [{ name: "f", type: "list", source: "field", of }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", model, phase, v => { model = v; });
  const aInput = [...r.querySelectorAll(".of-field-name")].find(i => i.value === "a");
  aInput.value = "b";
  aInput.dispatchEvent(ev(aInput));
  // no-op rename: both fields still present (input snapped back to "a" on re-render),
  // "b" keeps its enum values — not silently overwritten by "a"'s spec
  const names = [...r.querySelectorAll(".of-field-name")].map(i => i.value);
  expect(names).toEqual(["a", "b"]);
  const bChips = [...r.querySelectorAll(".stringlist-row input")].map(i => i.value);
  expect(bChips).toEqual(["x", "y"]);
});

test("signalsEditor of-object structural edits clone-then-reassign, never mutate the original object", () => {
  dom();
  const originalOf = { a: "string" };
  let model = [{ name: "f", type: "list", source: "field", of: originalOf }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  let emitted = null;
  const r = signalsEditor("emits", model, phase, v => { emitted = v; });
  r.querySelector(".of-field-add").dispatchEvent(click(r));
  // the object passed in by the caller must be untouched — the new field lives
  // only in the emitted payload's (cloned) `of`
  expect(Object.keys(originalOf)).toEqual(["a"]);
  expect(Object.keys(emitted[0].of)).toEqual(["a", "field2"]);
});

test("signalsEditor of-select enum-to-object switch clears stale values", () => {
  dom();
  let model = [{ name: "hits", type: "list", source: "field", of: "enum", values: ["a", "b"] }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  let emitted = null;
  const r = signalsEditor("emits", model, phase, v => { emitted = v; });
  const ofSel = r.querySelector("select.signal-of");
  // linkedom: select.value is readonly; simulate selection via option.selected (see fieldSelect test)
  [...ofSel.querySelectorAll("option")].forEach(o => o.selected = o.value === "object");
  ofSel.dispatchEvent(ev(ofSel));
  // the stale enum `values` must not survive the switch to `of: object` — it is
  // invisible (chips only render for curOf === "enum") and blocks save-time validation
  expect(emitted[0].of).toEqual({});
  expect("values" in emitted[0]).toBe(false);
});

test("signalsEditor render-time exit_code coercion clears stale of/values", () => {
  dom();
  let model = [{ name: "e", type: "list", source: "exit_code", of: "string" }];
  const phase = { id: "S1", type: "script" };
  let emitted = null;
  const r = signalsEditor("emits", model, phase, v => { emitted = v; });
  // render already forced type -> "bool" (exit_code only accepts bool|number); fire a
  // benign change to force an emit and read back the coerced, cleaned-up item
  const nameInput = r.querySelector(".signal-name");
  nameInput.dispatchEvent(ev(nameInput));
  expect(emitted[0].type).toBe("bool");
  expect("of" in emitted[0]).toBe(false);
});

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

test("each signal and its sub-rows share one framed .signal-block", () => {
  dom();
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", [{ name: "hits", type: "list", source: "field", from: "work:t1", of: "string" }], phase, () => {});
  const blocks = r.querySelectorAll(".signal-block");
  expect(blocks.length).toBe(1);
  const b = blocks[0];
  expect(b.querySelector(".signal-row")).not.toBeNull();
  // the `from` sub-row AND the `of` sub-row live inside the SAME block
  expect(b.querySelectorAll(".signal-subrow").length).toBeGreaterThanOrEqual(2);
  // no sub-row escaped the block (all subrows are inside a block)
  expect([...r.querySelectorAll(".signal-subrow")].every(s => s.closest(".signal-block"))).toBe(true);
});

test("two signals render two separate blocks", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [
    { name: "a", type: "string", source: "token" },
    { name: "b", type: "string", source: "token" },
  ], phase, () => {});
  expect(r.querySelectorAll(".signal-block").length).toBe(2);
});

test("type and source labels anchor their popover to the right edge", () => {
  dom();
  const phase = { id: "T1", type: "agent" };
  const r = signalsEditor("emits", [{ name: "s", type: "string", source: "token" }], phase, () => {});
  const rightLabels = [...r.querySelectorAll(".signal-row .mini-label.help-align-right")]
    .map(l => l.childNodes[0].textContent);
  expect(rightLabels).toContain("type");
  expect(rightLabels).toContain("source");
  // the name label keeps the default (left-anchored) popover
  const nameLabel = [...r.querySelectorAll(".signal-row .mini-label")]
    .find(l => l.childNodes[0].textContent === "name");
  expect(nameLabel.classList.contains("help-align-right")).toBe(false);
});
