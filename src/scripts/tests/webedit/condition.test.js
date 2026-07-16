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
