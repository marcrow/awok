import { test, expect } from "bun:test";
import { parseRole, ioLabel, nsColor, computeLevels, classifyLinkSpan,
         dataflowFiles, validateModel } from "../../../workflow/templates/webedit/editlogic.js";

test("parseRole splits ns:name, falls back to namespace field / bare role", () => {
  expect(parseRole({ role: "work:inventory" })).toEqual({ ns: "work", name: "inventory" });
  expect(parseRole({ role: "x", namespace: "work" })).toEqual({ ns: "work", name: "x" });
  expect(parseRole({ role: "bare" })).toEqual({ ns: "", name: "bare" });
  expect(parseRole({})).toEqual({ ns: "", name: "" });
});

test("ioLabel: role wins over path", () => {
  expect(ioLabel({ role: "work:a", path: "p/x.md" })).toBe("work:a");
  expect(ioLabel({ path: "p/x.md" })).toBe("p/x.md");
  expect(ioLabel({})).toBe("");
});

test("nsColor is stable per namespace and falls back for unknown", () => {
  const ns = { work: "work/x", scratch: "tmp" };
  expect(nsColor("work", ns)).toBe(nsColor("work", ns));
  expect(nsColor("work", ns)).not.toBe(nsColor("scratch", ns));
  expect(nsColor("", ns)).toBe("#64748b");
});

test("computeLevels mirrors the server: roots are 0, longest path wins, parallels share", () => {
  const model = { phases: [
    { id: "A" },
    { id: "B", depends_on: ["A"] },
    { id: "C", depends_on: ["A"] },
    { id: "D", depends_on: ["B", "C"] },
    { id: "E", depends_on: ["A", "D"] },   // longest path A->B->D->E = 3
  ] };
  const lv = computeLevels(model);
  expect(lv.A).toBe(0);
  expect(lv.B).toBe(1);
  expect(lv.C).toBe(1);           // parallel with B
  expect(lv.D).toBe(2);
  expect(lv.E).toBe(3);           // longest path, not 1
});

test("classifyLinkSpan: same / direct / far", () => {
  expect(classifyLinkSpan(2, 2)).toBe("same");
  expect(classifyLinkSpan(1, 2)).toBe("direct");
  expect(classifyLinkSpan(0, 3)).toBe("far");
});

test("dataflowFiles aggregates phase + invocation io, dedups producers, resolves paths", () => {
  const model = {
    namespaces: { work: "work/onboard" },
    phases: [
      { id: "A", outputs: [{ role: "work:inv", kind: "md" }] },
      { id: "B", depends_on: ["A"],
        inputs: [{ role: "work:inv", kind: "md" }],
        invocations: [{ agent: "x", outputs: [{ role: "work:rep", kind: "md", terminal: true }] }] },
    ],
  };
  const files = dataflowFiles(model);
  const byLabel = {}; files.forEach(f => byLabel[f.label] = f);
  expect(byLabel["work:inv"].producers).toEqual(["A"]);
  expect(byLabel["work:inv"].consumers).toEqual(["B"]);
  expect(byLabel["work:inv"].path).toBe("work/onboard/inv.md");
  expect(byLabel["work:inv"].external).toBe(false);
  // invocation-level output is picked up, terminal flag carried through
  expect(byLabel["work:rep"].producers).toEqual(["B"]);
  expect(byLabel["work:rep"].terminal).toBe(true);
  expect(byLabel["work:rep"].path).toBe("work/onboard/rep.md");
});

test("dataflowFiles marks a never-produced file external and an undeclared ns nsBad", () => {
  const model = {
    namespaces: { work: "work/onboard" },
    phases: [
      { id: "A", inputs: [{ role: "work:seed", kind: "md" }] },         // consumed, never produced
      { id: "B", outputs: [{ role: "ghost:out", kind: "json" }] },      // undeclared namespace
    ],
  };
  const byLabel = {}; dataflowFiles(model).forEach(f => byLabel[f.label] = f);
  expect(byLabel["work:seed"].external).toBe(true);                      // no producer
  expect(byLabel["ghost:out"].nsBad).toBe(true);
  expect(byLabel["ghost:out"].path).toBe("");                           // unresolved
});

test("validateModel: undeclared ns is an error, real orphans are warnings, flags suppress them", () => {
  const model = {
    namespaces: { work: "work/onboard" },
    phases: [
      { id: "A", outputs: [{ role: "work:inv", kind: "md" }] },          // produced + consumed → ok
      { id: "B", inputs: [{ role: "work:inv", kind: "md" }],
                 outputs: [{ role: "work:rep", kind: "md", terminal: true }] }, // terminal → no warning
      { id: "C", outputs: [{ role: "work:orphan", kind: "md" }] },       // produced, never read → warning
      { id: "D", inputs: [{ role: "ghost:x", kind: "md" }] },            // undeclared ns → error
    ],
  };
  const v = validateModel(model);
  expect(v.errors.some(m => m.includes('"ghost:"'))).toBe(true);
  expect(v.warnings.some(m => m.includes("work:orphan") || m.includes("never read"))).toBe(true);
  // the terminal output and the produced+consumed file raise no warning
  expect(v.warnings.some(m => m.includes("work:rep"))).toBe(false);
});

test("validateModel: a consumed-but-unproduced input warns unless optional/external", () => {
  const warns = m => validateModel(m).warnings.length;
  const base = (extra) => ({ namespaces: { work: "w" }, phases: [{ id: "A", inputs: [{ role: "work:x", kind: "md", ...extra }] }] });
  expect(warns(base({}))).toBe(1);              // plain orphan input → warning
  expect(warns(base({ optional: true }))).toBe(0);
  expect(warns(base({ external: true }))).toBe(0);
});
