// Regression guards for the Haiku effort gating in the web editor: the effort
// selector must be visibly greyed (disabled) AND show a "why" tooltip when the
// invocation's model can't run reasoning effort (haiku). The native disabled look
// is hidden by the theme's custom select colors, and a disabled <select> won't
// surface its own title — hence the explicit CSS + the titled wrapper.
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../../../workflow/templates/webedit/editor.css");
const editorJs = read("../../../workflow/templates/webedit/editor.js");
const settingsJs = read("../../../workflow/templates/webedit/settings.js");

test("editor.css greys disabled selects and styles the effort wrapper", () => {
  expect(css).toMatch(/select:disabled\s*\{[^}]*opacity:\s*0?\.\d+/);   // visibly greyed
  expect(css).toMatch(/select:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  expect(css).toMatch(/\.inv-effort-wrap\s*\{/);                         // tooltip wrapper
});

test("editor.js disables the effort selector on haiku and carries a hover message", () => {
  expect(editorJs).toMatch(/effortOff\s*=\s*inv\.model\s*===\s*"haiku"/);
  expect(editorJs).toMatch(/effort\.disabled\s*=\s*effortOff/);
  // disabled select wrapped in a titled span (a disabled control hides its own title)
  expect(editorJs).toMatch(/inv-effort-wrap/);
  expect(editorJs).toMatch(/wrap\.title\s*=\s*effortTip/);
  expect(editorJs).toMatch(/Haiku doesn't support reasoning effort/);
  // switching the model to haiku clears any stale effort pin
  expect(editorJs).toMatch(/model\.value === "haiku"\)\s*delete inv\.effort/);
});

test("settings.js disables the on-demand effort selector on haiku", () => {
  expect(settingsJs).toMatch(/o\.model === "haiku"/);
  expect(settingsJs).toMatch(/sel\.disabled = true/);
  expect(settingsJs).toMatch(/effortRow\.title\s*=/);   // hover message on the row
});
