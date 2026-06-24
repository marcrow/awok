// Regression guards for the web-editor workflow-switch fixes:
//  - dataflow filters must not leak from one workflow onto the next (reset()).
//  - the issues badge must actually hide when emptied (the author display:flex
//    rule used to beat the UA [hidden] rule, so a previous workflow's error
//    count stayed pinned top-right on a clean workflow).
import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createDataflow } from "../../../workflow/templates/webedit/dataflow.js";

const cssPath = fileURLToPath(new URL("../../../workflow/templates/webedit/editor.css", import.meta.url));

test("createDataflow exposes reset() and it clears a left-on filter toggle", () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <button id="df-add-file"></button>
    <button id="df-ns"></button>
    <div id="df-scroll"></div>
  </body></html>`);
  globalThis.document = document;
  try {
    const df = createDataflow({ getModel: () => ({ phases: [] }), refreshView: () => {}, setStatus: () => {} });
    expect(typeof df.reset).toBe("function");
    // a namespaces panel the user left open in workflow A
    document.querySelector("#df-ns").classList.add("on");
    df.reset();
    expect(document.querySelector("#df-ns").classList.contains("on")).toBe(false);
  } finally {
    delete globalThis.document;
  }
});

test("the issues badge has an explicit [hidden] guard so hidden=true really hides it", () => {
  const css = readFileSync(cssPath, "utf8");
  // Without this rule, .issues-badge{display:flex} (author) overrides the UA
  // [hidden]{display:none} and the badge never hides — leaking across workflows.
  expect(css).toMatch(/\.issues-badge\[hidden\]\s*\{\s*display:\s*none/);
});
