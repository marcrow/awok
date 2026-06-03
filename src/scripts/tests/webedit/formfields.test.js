import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { fieldText, fieldTextarea, fieldSelect, fieldCheckbox, fieldDatalist,
         ioRefEditor, triggerEditor } from "../../../workflow/templates/webedit/formfields.js";

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
