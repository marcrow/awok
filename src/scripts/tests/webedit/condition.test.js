import { test, expect } from "bun:test";
import {
  condKind, isGroupCond, conditionSignalKeys,
  getCondAt, setCondAt, toggleNotAt, toggleConnectorAt,
  addComparisonAt, addSubgroupAt, removeCondAt,
} from "../../../workflow/templates/webedit/editlogic.js";

const SAMPLE = { or: [
  { and: [ { op: "==", left: "recon.waf", right: "true" },
           { op: ">",  left: "scan.risk", right: "7" } ] },
  { not: { and: [ { op: "==", left: "scan.status", right: "open" },
                  { op: "exists", left: { file_exists: "/etc/passwd" } } ] } },
] };

test("condKind classifies each node", () => {
  expect(condKind(SAMPLE)).toBe("or");
  expect(condKind(SAMPLE.or[0])).toBe("and");
  expect(condKind(SAMPLE.or[1])).toBe("not");
  expect(condKind(SAMPLE.or[0].and[0])).toBe("leaf");
  expect(condKind("free text")).toBe("escape");
  expect(isGroupCond(SAMPLE)).toBe(true);
  expect(isGroupCond(SAMPLE.or[0].and[0])).toBe(false);
});

test("conditionSignalKeys collects every operand string across the tree", () => {
  const keys = conditionSignalKeys(SAMPLE);
  expect(keys).toContain("recon.waf");
  expect(keys).toContain("scan.risk");
  expect(keys).toContain("scan.status");
  // builtin operand (object) is NOT a string key
  expect(keys.every(k => typeof k === "string")).toBe(true);
});

test("getCondAt / setCondAt address nested nodes by path", () => {
  expect(getCondAt(SAMPLE, ["or", 0, "and", 1, "op"])).toBe(">");
  const next = setCondAt(SAMPLE, ["or", 0, "and", 1, "op"], "<=");
  expect(getCondAt(next, ["or", 0, "and", 1, "op"])).toBe("<=");
  expect(getCondAt(SAMPLE, ["or", 0, "and", 1, "op"])).toBe(">"); // input not mutated
});

test("toggleNotAt wraps a bare node and unwraps a not node", () => {
  const wrapped = toggleNotAt(SAMPLE, ["or", 0]);          // wrap the first AND group
  expect(condKind(getCondAt(wrapped, ["or", 0]))).toBe("not");
  const unwrapped = toggleNotAt(wrapped, ["or", 0]);       // toggle back
  expect(condKind(getCondAt(unwrapped, ["or", 0]))).toBe("and");
});

test("toggleConnectorAt swaps and<->or preserving members", () => {
  const next = toggleConnectorAt(SAMPLE, ["or", 0]);
  const g = getCondAt(next, ["or", 0]);
  expect(condKind(g)).toBe("or");
  expect(g.or.length).toBe(2);
});

test("addComparisonAt / addSubgroupAt / removeCondAt mutate group members", () => {
  const added = addComparisonAt(SAMPLE, ["or", 0], { op: "==", left: "scan.risk", right: "" });
  expect(getCondAt(added, ["or", 0]).and.length).toBe(3);
  const withGrp = addSubgroupAt(added, ["or", 0], { and: [{ op: "exists", left: "exploit.ok" }] });
  expect(condKind(getCondAt(withGrp, ["or", 0, "and", 3]))).toBe("and");
  const removed = removeCondAt(withGrp, ["or", 0, "and", 3]);
  expect(getCondAt(removed, ["or", 0]).and.length).toBe(3);
});

// --- immutability regression tests --------------------------------------
// The mutators must return a root that shares NO object identity with the
// input at the touched path, and mutating the result must never affect the
// original SAMPLE. Deep-freeze SAMPLE so any accidental write through a
// shared reference throws (or silently no-ops in non-strict mode — the
// nested-value snapshot check below catches that case too).
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
deepFreeze(SAMPLE);

test("toggleNotAt does not alias the touched subtree into the result", () => {
  const originalNode = SAMPLE.or[0];
  const snapshotLeft = SAMPLE.or[0].and[0].left;

  const wrapped = toggleNotAt(SAMPLE, ["or", 0]);

  // The wrapped node's inner value must be a clone, not the live SAMPLE subtree.
  expect(wrapped.or[0].not).not.toBe(originalNode);
  expect(wrapped.or[0].not.and[0]).not.toBe(originalNode.and[0]);

  // Mutating the result must not touch SAMPLE.
  wrapped.or[0].not.and[0].left = "mutated";
  expect(SAMPLE.or[0].and[0].left).toBe(snapshotLeft);
});

test("toggleConnectorAt does not alias the group's members into the result", () => {
  const originalMembers = SAMPLE.or[0].and;
  const snapshotLeft = SAMPLE.or[0].and[0].left;

  const next = toggleConnectorAt(SAMPLE, ["or", 0]);

  // The new group's member array/objects must be clones, not the live ones.
  expect(next.or[0].or).not.toBe(originalMembers);
  expect(next.or[0].or[0]).not.toBe(originalMembers[0]);

  // Mutating the result must not touch SAMPLE.
  next.or[0].or[0].left = "mutated";
  expect(SAMPLE.or[0].and[0].left).toBe(snapshotLeft);
});

test("removeCondAt does not alias surviving siblings into the result", () => {
  const added = addComparisonAt(SAMPLE, ["or", 0], { op: "==", left: "scan.risk", right: "" });
  const originalSurvivor = added.or[0].and[0];
  const snapshotLeft = added.or[0].and[0].left;

  const removed = removeCondAt(added, ["or", 0, "and", 1]);

  // The surviving leaf must be a clone, not the same object as in `added`.
  expect(removed.or[0].and[0]).not.toBe(originalSurvivor);

  // Mutating the result must not touch the previous root `added` (nor SAMPLE).
  removed.or[0].and[0].left = "mutated";
  expect(added.or[0].and[0].left).toBe(snapshotLeft);
  expect(SAMPLE.or[0].and[0].left).toBe(snapshotLeft);
});

test("removeCondAt no-op branch still returns a fresh clone, not the same root", () => {
  // path parent is not an array -> no-op branch; must still honor "always a new root".
  const result = removeCondAt(SAMPLE, ["or", 0, "and", 0, "op"]);
  expect(result).not.toBe(SAMPLE);
  expect(result).toEqual(SAMPLE);
});
