import { describe, expect, test } from "vite-plus/test";
import { createFilter } from "../src/index.js";

interface Customer {
  name: string;
  status?: string;
}

const customers = createFilter<Customer>()({
  name: (customer) => customer.name,
  status: {
    get: (customer) => customer.status,
    normalize: (text) => text.replaceAll("-", "").trim().toLowerCase(),
  },
});

describe("parse", () => {
  test("treats every string as JSON text", () => {
    expect(customers.parse("not JSON")).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-json", path: [] }],
    });
    expect(customers.parse('"name"')).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape", path: [] }],
    });
  });

  test.each([null, "null"])("accepts the explicit no-filter value %#", (input) => {
    expect(customers.parse(input)).toEqual({ ok: true, expression: null });
  });

  test("rebuilds canonical plain data without rewriting or deduplicating needles", () => {
    const tokens = ["Open", "open"];
    const predicate = {
      field: "status",
      operator: "one-of",
      value: tokens,
      not: undefined,
    };
    const group = { all: [predicate] };
    const input = { v: 1, any: [group] };

    const result = customers.parse(input);

    expect(result).toEqual({
      ok: true,
      expression: {
        v: 1,
        any: [{ all: [{ field: "status", operator: "one-of", value: ["Open", "open"] }] }],
      },
    });
    if (!result.ok || result.expression === null) {
      expect.unreachable("expected a canonical expression");
    }
    const rebuiltGroup = result.expression.any[0];
    const rebuiltPredicate = rebuiltGroup?.all[0];
    expect(result.expression).not.toBe(input);
    expect(result.expression.any).not.toBe(input.any);
    expect(rebuiltGroup).not.toBe(group);
    expect(rebuiltGroup?.all).not.toBe(group.all);
    expect(rebuiltPredicate).not.toBe(predicate);
    expect(
      rebuiltPredicate && "value" in rebuiltPredicate ? rebuiltPredicate.value : undefined,
    ).not.toBe(tokens);
    expect(rebuiltPredicate).not.toHaveProperty("not");
    expect(Object.getPrototypeOf(result.expression)).toBe(Object.prototype);
  });

  test("rejects sparse expression containers instead of blessing holes", () => {
    expect(customers.parse({ v: 1, any: Array(1) })).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape", path: ["any", 0] }],
    });
    expect(customers.parse({ v: 1, any: [{ all: Array(1) }] })).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape", path: ["any", 0, "all", 0] }],
    });
  });

  test("rebuilds array subclasses as plain arrays", () => {
    class InputArray<T> extends Array<T> {}
    const all = new InputArray({ field: "name", operator: "empty" });
    const any = new InputArray({ all });

    const result = customers.parse({ v: 1, any });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok || result.expression === null) {
      expect.unreachable("expected a canonical expression");
    }
    expect(Object.getPrototypeOf(result.expression.any)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(result.expression.any[0]?.all)).toBe(Array.prototype);
  });

  test("reports an unsupported wire version without judging a foreign grammar", () => {
    const result = customers.parse({ extra: true, v: 2, any: [] });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "unsupported-version", path: ["v"] }],
    });
    if (result.ok) expect.unreachable("expected an unsupported version");
    expect(result.issues).toHaveLength(1);
  });

  test("reports reachable issues in grammar order, independent of object key order", () => {
    for (const input of [
      { extra: true, any: [] },
      { any: [], extra: true },
    ]) {
      const result = customers.parse(input);
      if (result.ok) expect.unreachable("expected invalid input");

      expect(result.issues.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: "invalid-shape", path: ["v"] },
        { code: "empty-expression", path: ["any"] },
        { code: "invalid-shape", path: ["extra"] },
      ]);
    }
  });

  test("treats an undefined version as a missing required value", () => {
    expect(
      customers.parse({
        v: undefined,
        any: [{ all: [{ field: "name", operator: "empty" }] }],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape", path: ["v"] }],
    });
  });

  test("rejects non-enumerable unknown string keys", () => {
    const input = { v: 1, any: [{ all: [{ field: "name", operator: "empty" }] }] };
    Object.defineProperty(input, "extra", { value: true });

    expect(customers.parse(input)).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape", path: ["extra"] }],
    });
  });

  test.each([
    [
      "a missing version",
      { any: [{ all: [{ field: "name", operator: "empty" }] }] },
      "invalid-shape",
      ["v"],
    ],
    [
      "a future version",
      { v: 2, any: [{ all: [{ field: "name", operator: "empty" }] }] },
      "unsupported-version",
      ["v"],
    ],
    ["a non-array any", { v: 1, any: {} }, "invalid-shape", ["any"]],
    ["an empty expression", { v: 1, any: [] }, "empty-expression", ["any"]],
    ["a non-object group", { v: 1, any: [null] }, "invalid-shape", ["any", 0]],
    ["an empty group", { v: 1, any: [{ all: [] }] }, "empty-group", ["any", 0, "all"]],
    [
      "an unknown root key",
      { v: 1, any: [{ all: [{ field: "name", operator: "empty" }] }], extra: true },
      "invalid-shape",
      ["extra"],
    ],
    [
      "an unknown group key",
      { v: 1, any: [{ all: [{ field: "name", operator: "empty" }], extra: true }] },
      "invalid-shape",
      ["any", 0, "extra"],
    ],
    [
      "an unknown predicate key",
      { v: 1, any: [{ all: [{ field: "name", operator: "empty", extra: true }] }] },
      "invalid-shape",
      ["any", 0, "all", 0, "extra"],
    ],
  ] as const)("rejects %s", (_case, input, code, path) => {
    expect(customers.parse(input)).toMatchObject({ ok: false, issues: [{ code, path }] });
  });

  test("reports independent reachable issues in grammar order", () => {
    const result = customers.parse({
      v: 1,
      any: [
        {
          all: [
            { field: "retired", operator: "unknown", value: false, not: false },
            null,
            { field: "name", operator: "equals", value: "   " },
            { field: "status", operator: "one-of", value: ["open", " - ", 4] },
            { field: "name", operator: "empty", value: "surplus" },
          ],
        },
        { all: [] },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        { code: "unknown-field", path: ["any", 0, "all", 0, "field"] },
        { code: "unknown-operator", path: ["any", 0, "all", 0, "operator"] },
        { code: "invalid-value", path: ["any", 0, "all", 0, "not"] },
        { code: "invalid-shape", path: ["any", 0, "all", 1] },
        { code: "empty-needle", path: ["any", 0, "all", 2, "value"] },
        { code: "empty-needle", path: ["any", 0, "all", 3, "value", 1] },
        { code: "invalid-value", path: ["any", 0, "all", 3, "value", 2] },
        { code: "invalid-value", path: ["any", 0, "all", 4, "value"] },
        { code: "empty-group", path: ["any", 1, "all"] },
      ],
    });
  });

  test.each([
    ["missing field", { operator: "empty" }, "invalid-shape", ["field"]],
    ["non-string field", { field: 1, operator: "empty" }, "invalid-shape", ["field"]],
    ["missing operator", { field: "name" }, "invalid-shape", ["operator"]],
    [
      "scalar one-of",
      { field: "name", operator: "one-of", value: "Ada" },
      "invalid-value",
      ["value"],
    ],
    ["empty one-of", { field: "name", operator: "one-of", value: [] }, "empty-needle", ["value"]],
    ["missing scalar value", { field: "name", operator: "equals" }, "invalid-value", ["value"]],
    ["false not", { field: "name", operator: "empty", not: false }, "invalid-value", ["not"]],
  ] as const)("rejects predicate with %s", (_case, predicate, code, suffix) => {
    expect(customers.parse({ v: 1, any: [{ all: [predicate] }] })).toMatchObject({
      ok: false,
      issues: [{ code, path: ["any", 0, "all", 0, ...suffix] }],
    });
  });
});
