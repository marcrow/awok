import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { makeCard, section, helpNote, helpIcon } from "../../../workflow/templates/webedit/render-helpers.js";
import { computeDropDepends, renderEdges, descendantIds, safeDropDepends,
         blockedDependents, buildNotice, aggregateInvocationIo, applyPhaseGroup,
         opportunisticMode, opportunisticGuidance, setOpportunistic,
         globalOpportunisticState, setGlobalOpportunistic, resolvedOppLabel } from "../../../workflow/templates/webedit/editlogic.js";

test("applyPhaseGroup auto-defines a brand-new group (keeps workflow coherent)", () => {
  const model = { groups: { setup: { description: "x" } } };
  const phase = { id: "P1", group: "setup" };
  expect(applyPhaseGroup(model, phase, "my-custom")).toBe(true);
  expect(phase.group).toBe("my-custom");
  expect(model.groups["my-custom"]).toEqual({ description: "" });   // created
  // existing group is reused, not overwritten
  applyPhaseGroup(model, phase, "setup");
  expect(model.groups.setup).toEqual({ description: "x" });
});

test("applyPhaseGroup ignores empty/whitespace (group is required)", () => {
  const model = { groups: {} };
  const phase = { group: "keep" };
  expect(applyPhaseGroup(model, phase, "   ")).toBe(false);
  expect(phase.group).toBe("keep");
  expect(Object.keys(model.groups)).toEqual([]);
});

test("aggregateInvocationIo rolls up per-invocation io (matches dataflow source)", () => {
  const phase = { invocations: [
    { agent: "a1", inputs: [{ path: "in/x.md" }], outputs: [{ path: "out/y.md" }] },
    { agent: "a2" },                                  // no io -> skipped
    { agent: "a3", outputs: [{ path: "out/z.json" }] },
  ] };
  const agg = aggregateInvocationIo(phase);
  expect(agg.map(g => g.agent)).toEqual(["a1", "a3"]);
  expect(agg[0].inputs[0].path).toBe("in/x.md");
  expect(agg[1].outputs[0].path).toBe("out/z.json");
});

test("aggregateInvocationIo is empty for phase-level-only io", () => {
  expect(aggregateInvocationIo({ inputs: [{ path: "p.md" }] })).toEqual([]);
  expect(aggregateInvocationIo({})).toEqual([]);
});

test("makeCard renders id/name as inert text (no XSS)", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const card = makeCard({ id: "X');alert(1)//", name: "<img src=x onerror=alert(2)>", type: "agent" });
  document.body.appendChild(card);
  expect(document.querySelector("img")).toBeNull();
  expect(card.textContent).toContain("X');alert(1)//");
  expect(card.getAttribute("data-id")).toBe("X');alert(1)//");
});

test("section builds a collapsible details with a body", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const d = section("Fichiers", false);
  expect(d.tagName.toLowerCase()).toBe("details");
  expect(d.hasAttribute("open")).toBe(false);
  expect(section("Open one", true).hasAttribute("open")).toBe(true);
  expect(d.querySelector("summary").textContent).toBe("Fichiers");
  d.body.appendChild(document.createElement("input"));
  expect(d.querySelector(".section-body input")).not.toBeNull();
});

test("helpNote renders muted inert text", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const n = helpNote("<b>x</b> explained");
  expect(n.querySelector("b")).toBeNull();
  expect(n.className).toBe("help-note");
  expect(n.textContent).toContain("explained");
});

test("helpIcon shows a ? badge with an inert hover popover", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const s = helpIcon("<img onerror=x> optional means…");
  expect(s.querySelector("img")).toBeNull();
  expect(s.textContent).toContain("?");
  expect(s.querySelector(".help-pop").textContent).toContain("optional means");
  // no native title — it would double up with the CSS popover on hover
  expect(s.getAttribute("title")).toBeNull();
});

test("renderEdges draws one line per edge", () => {
  const { document } = parseHTML("<!DOCTYPE html><body><svg id='ov'></svg></body>");
  globalThis.document = document;
  const svg = document.getElementById("ov");
  const pos = { A: { x: 10, y: 10 }, B: { x: 50, y: 60 }, C: { x: 90, y: 60 } };
  renderEdges(svg, [{ from: "A", to: "B" }, { from: "A", to: "C" }], pos);
  expect(svg.querySelectorAll("line").length).toBe(2);
});

test("computeDropDepends: level 0 clears, level N = previous-row ids", () => {
  const rows = [["A"], ["B", "C"], ["D"]];
  expect(computeDropDepends(rows, 0, "D")).toEqual([]);
  expect(computeDropDepends(rows, 2, "D")).toEqual(["B", "C"]);
  expect(computeDropDepends(rows, 1, "B")).toEqual(["A"]);
});

test("descendantIds finds transitive dependents", () => {
  // A <- B <- C  (B depends on A, C depends on B)
  const phases = [
    { id: "A" },
    { id: "B", depends_on: ["A"] },
    { id: "C", depends_on: ["B"] },
  ];
  expect([...descendantIds(phases, "A")].sort()).toEqual(["B", "C"]);
  expect([...descendantIds(phases, "C")]).toEqual([]);
});

test("safeDropDepends never depends on a descendant (no cycle)", () => {
  // chain A<-B<-C; rows reflect levels A,B,C
  const phases = [
    { id: "A" },
    { id: "B", depends_on: ["A"] },
    { id: "C", depends_on: ["B"] },
  ];
  const rows = [["A"], ["B"], ["C"]];
  // dragging A to the bottom would naively depend on C (its own descendant) -> filtered out
  expect(safeDropDepends(phases, rows, 3, "A")).toEqual([]);
  // dragging C up to level 1 depends on A (not a descendant) -> kept
  expect(safeDropDepends(phases, rows, 1, "C")).toEqual(["A"]);
});

test("blockedDependents lists the links that block the move", () => {
  const phases = [
    { id: "A" },
    { id: "B", depends_on: ["A"] },
    { id: "C", depends_on: ["B"] },
  ];
  const rows = [["A"], ["B"], ["C"]];
  expect(blockedDependents(phases, rows, 3, "A")).toEqual(["C"]);
  expect(blockedDependents(phases, rows, 1, "C")).toEqual([]);
});

test("buildNotice renders title + lines as inert text", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const node = buildNotice("Déplacement bloqué", ["<img onerror=x>", "C dépend de A"]);
  document.body.appendChild(node);
  expect(document.querySelector("img")).toBeNull();
  expect(node.querySelector(".notice-title").textContent).toBe("Déplacement bloqué");
  expect(node.querySelectorAll(".notice-line").length).toBe(2);
});

test("opportunisticMode maps raw value to UI mode", () => {
  expect(opportunisticMode({})).toBe("inherit");
  expect(opportunisticMode({ opportunistic: false })).toBe("locked");
  expect(opportunisticMode({ opportunistic: true })).toBe("enabled");
  expect(opportunisticMode({ opportunistic: { when: "x" } })).toBe("enabled");
});

test("opportunisticGuidance reads object guidance", () => {
  expect(opportunisticGuidance({})).toEqual({ when: "", examples: [] });
  expect(opportunisticGuidance({ opportunistic: true })).toEqual({ when: "", examples: [] });
  expect(opportunisticGuidance({ opportunistic: { when: "w", examples: ["e"] } }))
    .toEqual({ when: "w", examples: ["e"] });
});

test("setOpportunistic serializes minimally", () => {
  let p = { opportunistic: { when: "x" } };
  setOpportunistic(p, "inherit"); expect("opportunistic" in p).toBe(false);
  p = {}; setOpportunistic(p, "locked"); expect(p.opportunistic).toBe(false);
  p = {}; setOpportunistic(p, "enabled", "", []); expect(p.opportunistic).toBe(true);
  p = {}; setOpportunistic(p, "enabled", "  w  ", ["a", " ", "b"]);
  expect(p.opportunistic).toEqual({ when: "w", examples: ["a", "b"] });
  p = {}; setOpportunistic(p, "enabled", "", ["only"]);
  expect(p.opportunistic).toEqual({ examples: ["only"] });
});

test("globalOpportunisticState reads the top-level value", () => {
  expect(globalOpportunisticState({})).toEqual({ enabled: false, when: "", examples: [] });
  expect(globalOpportunisticState({ opportunistic: true })).toEqual({ enabled: true, when: "", examples: [] });
  expect(globalOpportunisticState({ opportunistic: { enabled: true, when: "w", examples: ["e"] } }))
    .toEqual({ enabled: true, when: "w", examples: ["e"] });
  expect(globalOpportunisticState({ opportunistic: false }).enabled).toBe(false);
});

test("setGlobalOpportunistic keeps enabled:true in object form", () => {
  let m = {}; setGlobalOpportunistic(m, false); expect("opportunistic" in m).toBe(false);
  m = {}; setGlobalOpportunistic(m, true, "", []); expect(m.opportunistic).toBe(true);
  m = {}; setGlobalOpportunistic(m, true, "w", ["e"]);
  expect(m.opportunistic).toEqual({ enabled: true, when: "w", examples: ["e"] });
});

test("resolvedOppLabel maps the /api/view block", () => {
  const v = { phases: {
    A: { mark: "opportunistic", note_kind: "short", enabled: true },
    B: { mark: "locked", note_kind: "locked", enabled: false },
    C: { mark: null, note_kind: null, enabled: true },
    D: { mark: null, note_kind: null, enabled: false },
  } };
  expect(resolvedOppLabel(v, "A")).toContain("Targeted lead");
  expect(resolvedOppLabel(v, "B")).toContain("Locked");
  expect(resolvedOppLabel(v, "C")).toContain("Inherited");
  expect(resolvedOppLabel(v, "D")).toBe("Off");
  expect(resolvedOppLabel(v, "missing")).toBe("");
});

test("makeCard shows the opportunistic / locked badge from oppMark", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>"); globalThis.document = document;
  const a = makeCard({ id: "A", name: "a", type: "agent" }, null, "opportunistic");
  expect(a.querySelector(".opp-badge.opp-on").textContent).toBe("🧭");
  const b = makeCard({ id: "B", name: "b", type: "agent" }, null, "locked");
  expect(b.querySelector(".opp-badge.opp-locked").textContent).toBe("⛔");
  const c = makeCard({ id: "C", name: "c", type: "agent" }, null, null);
  expect(c.querySelector(".opp-badge")).toBeNull();
});
