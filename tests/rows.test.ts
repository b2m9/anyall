import { describe, expect, test } from "vite-plus/test";
import { AnyallConfigError, createFilter, type FilterRow } from "../src/index.js";

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

const predicate = (field: "name" | "status", value: string) => ({
  field,
  operator: "equals" as const,
  value,
});

describe("fromRows", () => {
  test("segments at each non-leading or before validating rows", () => {
    expect(
      customers.fromRows([
        { join: "or", ...predicate("name", "A") },
        { ...predicate("status", "B") },
        { join: "or", ...predicate("name", "C") },
        { join: "or", ...predicate("status", "D") },
        { join: "and", ...predicate("name", "E") },
      ]),
    ).toEqual({
      ok: true,
      expression: {
        v: 1,
        any: [
          { all: [predicate("name", "A"), predicate("status", "B")] },
          { all: [predicate("name", "C")] },
          { all: [predicate("status", "D"), predicate("name", "E")] },
        ],
      },
    });
  });

  test.each([
    ["a missing field", { operator: "empty" }],
    ["an unknown field", { field: "retired", operator: "empty" }],
    ["a missing operator", { field: "name" }],
    ["an unknown operator", { field: "name", operator: "matches", value: "Ada" }],
    ["a number scalar value", { field: "name", operator: "equals", value: 42 }],
    ["a boolean scalar value", { field: "name", operator: "contains", value: true }],
    ["an undefined scalar value", { field: "name", operator: "equals", value: undefined }],
    ["a post-normalization empty scalar", { field: "status", operator: "equals", value: " - " }],
    ["a value on empty", { field: "name", operator: "empty", value: "Ada" }],
    ["a scalar one-of value", { field: "name", operator: "one-of", value: "Ada" }],
    ["an empty one-of list", { field: "name", operator: "one-of", value: [] }],
    ["a malformed one-of token", { field: "name", operator: "one-of", value: ["Ada", 42] }],
    [
      "a post-normalization empty one-of token",
      { field: "status", operator: "one-of", value: ["-"] },
    ],
    ["a junk join", { join: "xor", field: "name", operator: "empty" }],
    ["a non-boolean not", { not: "yes", field: "name", operator: "empty" }],
  ])("rejects %s as one incomplete row", (_case, row) => {
    expect(customers.fromRows([row as FilterRow])).toMatchObject({
      ok: false,
      issues: [{ code: "incomplete-row", path: [0] }],
    });
  });

  test("rejects every incomplete row by default in source order", () => {
    const rows = [
      { field: "name" },
      { field: "name", operator: "equals", value: 42 },
      { field: "retired", operator: "empty" },
    ] as readonly FilterRow[];

    expect(customers.fromRows(rows)).toMatchObject({
      ok: false,
      issues: [
        { code: "incomplete-row", path: [0] },
        { code: "incomplete-row", path: [1] },
        { code: "incomplete-row", path: [2] },
      ],
    });
    expect(customers.fromRows(rows, { incomplete: "reject" })).toEqual(customers.fromRows(rows));
  });

  test("explains why each incomplete row cannot form a predicate", () => {
    expect(
      customers.fromRows([
        { field: "retired", operator: "empty" },
        { field: "name", operator: "equals", value: 42 },
        { join: "xor", field: "name", operator: "empty" } as never,
        { not: "yes", field: "name", operator: "empty" } as never,
      ]),
    ).toEqual({
      ok: false,
      issues: [
        { code: "incomplete-row", path: [0], message: 'unknown field "retired"' },
        {
          code: "incomplete-row",
          path: [1],
          message: "equals requires a string value",
        },
        {
          code: "incomplete-row",
          path: [2],
          message: 'join must be "and" or "or" when present',
        },
        {
          code: "incomplete-row",
          path: [3],
          message: "not must be a boolean when present",
        },
      ],
    });
  });

  test("rejects a malformed runtime policy explicitly", () => {
    expect(() =>
      customers.fromRows([predicate("name", "A")], { incomplete: "typo" } as never),
    ).toThrow(AnyallConfigError);
  });

  test("emits not only for true", () => {
    expect(
      customers.fromRows([
        { ...predicate("name", "A"), not: true },
        { ...predicate("name", "B"), not: false },
        predicate("name", "C"),
      ]),
    ).toMatchObject({
      ok: true,
      expression: {
        any: [
          {
            all: [
              { ...predicate("name", "A"), not: true },
              predicate("name", "B"),
              predicate("name", "C"),
            ],
          },
        ],
      },
    });
  });

  test("treats explicit undefined row state as absent", () => {
    expect(
      customers.fromRows([
        {
          join: undefined,
          field: "name",
          operator: "empty",
          value: undefined,
          not: undefined,
        } as never,
      ]),
    ).toEqual({
      ok: true,
      expression: { v: 1, any: [{ all: [{ field: "name", operator: "empty" }] }] },
    });
  });

  test("ignores inherited negation flags", () => {
    const inherited = Object.assign(Object.create({ not: true }) as object, {
      field: "name",
      operator: "empty",
    }) as FilterRow;
    expect(customers.fromRows([inherited])).toEqual({
      ok: true,
      expression: { v: 1, any: [{ all: [{ field: "name", operator: "empty" }] }] },
    });
  });

  test("ignores inherited join values", () => {
    const inheritedOr = Object.assign(Object.create({ join: "or" }) as object, {
      ...predicate("name", "B"),
    }) as FilterRow;
    const inheritedJunk = Object.assign(Object.create({ join: "xor" }) as object, {
      ...predicate("status", "C"),
    }) as FilterRow;

    expect(customers.fromRows([predicate("name", "A"), inheritedOr, inheritedJunk])).toEqual({
      ok: true,
      expression: {
        v: 1,
        any: [
          {
            all: [predicate("name", "A"), predicate("name", "B"), predicate("status", "C")],
          },
        ],
      },
    });
  });

  test("reports sparse rows instead of silently dropping holes", () => {
    expect(customers.fromRows(Array<FilterRow>(1))).toEqual({
      ok: false,
      issues: [{ code: "incomplete-row", path: [0], message: "row must be an object" }],
    });
  });

  test("discards invalid rows without changing the groups around them", () => {
    expect(
      customers.fromRows(
        [
          predicate("name", "A"),
          { join: "or", field: "name" },
          { join: "and", ...predicate("name", "B") },
        ],
        { incomplete: "discard" },
      ),
    ).toEqual({
      ok: true,
      expression: {
        v: 1,
        any: [{ all: [predicate("name", "A")] }, { all: [predicate("name", "B")] }],
      },
    });
  });

  test("drops emptied groups and returns null when no predicate survives", () => {
    expect(
      customers.fromRows(
        [
          { field: "name" },
          { join: "or", ...predicate("name", "A") },
          { join: "or", field: "status", operator: "one-of", value: [] },
        ],
        { incomplete: "discard" },
      ),
    ).toEqual({
      ok: true,
      expression: { v: 1, any: [{ all: [predicate("name", "A")] }] },
    });
    expect(customers.fromRows([])).toEqual({
      ok: true,
      expression: null,
    });
    expect(customers.fromRows([{ field: "name" }], { incomplete: "discard" })).toEqual({
      ok: true,
      expression: null,
    });
  });

  test("returns fresh canonical plain data while preserving raw needles", () => {
    const tokens = [" Open ", "open"];
    const row = { field: "status", operator: "one-of", value: tokens, not: false } as const;

    const result = customers.fromRows([row]);

    expect(result).toEqual({
      ok: true,
      expression: {
        v: 1,
        any: [{ all: [{ field: "status", operator: "one-of", value: [" Open ", "open"] }] }],
      },
    });
    if (!result.ok || result.expression === null) {
      expect.unreachable("expected an expression");
    }
    const group = result.expression.any[0];
    const built = group?.all[0];
    expect(result.expression).not.toBe(row);
    expect(built).not.toBe(row);
    expect(built && "value" in built ? built.value : undefined).not.toBe(tokens);
    expect(built).not.toHaveProperty("not");
    expect(Object.getPrototypeOf(result.expression)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.expression.any)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(group)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(group?.all)).toBe(Array.prototype);
    expect(Object.getPrototypeOf(built)).toBe(Object.prototype);
  });
});
