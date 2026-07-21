import { describe, expect, test } from "vite-plus/test";
import {
  AnyallExpressionError,
  createFilter,
  type Expression,
  type Predicate,
} from "../src/index.js";

interface Box {
  value: unknown;
}

const boxes = createFilter<Box>()({
  value: (box) => box.value,
});

const expression = (...predicates: readonly Predicate<"value">[]): Expression<"value"> => ({
  v: 1,
  any: [{ all: predicates }],
});

interface ResolutionCase {
  readonly label: string;
  readonly value: unknown;
  readonly needles: {
    readonly equals: string;
    readonly contains: string;
    readonly "starts-with": string;
    readonly "ends-with": string;
    readonly "one-of": readonly string[];
  };
  readonly matchesValueOperators: boolean;
  readonly isEmpty: boolean;
}

const ordinaryNeedles = {
  equals: " ALPHA ",
  contains: " PH ",
  "starts-with": " AL ",
  "ends-with": " HA ",
  "one-of": ["NOPE", " ALPHA "],
} as const;

const resolutionCases: readonly ResolutionCase[] = [
  {
    label: "undefined",
    value: undefined,
    needles: { ...ordinaryNeedles, equals: "undefined" },
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "null",
    value: null,
    needles: { ...ordinaryNeedles, equals: "null" },
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a blank string",
    value: "  \t ",
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "an empty string",
    value: "",
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a string",
    value: " Alpha ",
    needles: ordinaryNeedles,
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "a number",
    value: 42,
    needles: {
      equals: "42",
      contains: "4",
      "starts-with": "4",
      "ends-with": "2",
      "one-of": ["7", "42"],
    },
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "a boolean",
    value: true,
    needles: {
      equals: "true",
      contains: "ru",
      "starts-with": "tr",
      "ends-with": "ue",
      "one-of": ["false", "true"],
    },
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "a bigint",
    value: 42n,
    needles: {
      equals: "42",
      contains: "4",
      "starts-with": "4",
      "ends-with": "2",
      "one-of": ["7", "42"],
    },
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "an object",
    value: { toString: () => "alpha" },
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a Date",
    value: new Date("2026-07-21T00:00:00.000Z"),
    needles: { ...ordinaryNeedles, equals: "Tue Jul 21 2026" },
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a function",
    value: () => "alpha",
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a symbol",
    value: Symbol("alpha"),
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "an empty array",
    value: [],
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a singleton text array",
    value: [" Alpha "],
    needles: ordinaryNeedles,
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "an array whose scalars normalize away",
    value: ["", null],
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
  {
    label: "a mixed array",
    value: [null, "", {}, 42, ["alpha"], " Alpha "],
    needles: ordinaryNeedles,
    matchesValueOperators: true,
    isEmpty: false,
  },
  {
    label: "an array containing only nested arrays",
    value: [["alpha"], [42]],
    needles: ordinaryNeedles,
    matchesValueOperators: false,
    isEmpty: true,
  },
];

describe("compile", () => {
  test.each(resolutionCases)(
    "resolves $label across every operator and its negation",
    ({ value, needles, matchesValueOperators, isEmpty }) => {
      const valueOperators = ["equals", "contains", "starts-with", "ends-with", "one-of"] as const;

      for (const operator of valueOperators) {
        const valuePredicate =
          operator === "one-of"
            ? ({ field: "value", operator, value: needles[operator] } as const)
            : ({ field: "value", operator, value: needles[operator] } as const);

        expect(boxes.compile(expression(valuePredicate))({ value })).toBe(matchesValueOperators);
        expect(boxes.compile(expression({ ...valuePredicate, not: true }))({ value })).toBe(
          !matchesValueOperators,
        );
      }

      expect(boxes.compile(expression({ field: "value", operator: "empty" }))({ value })).toBe(
        isEmpty,
      );
      expect(
        boxes.compile(expression({ field: "value", operator: "empty", not: true }))({ value }),
      ).toBe(!isEmpty);
    },
  );

  test("normalizes needles at compile time and record texts only when evaluated", () => {
    const calls: string[] = [];
    const normalized = createFilter<Box>()({
      value: {
        get: (box) => box.value,
        normalize: (text) => {
          calls.push(text);
          return text.replaceAll(/[- ]/g, "").toLowerCase();
        },
      },
    });

    const matches = normalized.compile({
      v: 1,
      any: [
        {
          all: [{ field: "value", operator: "one-of", value: [" A-B ", "ab", "NOPE"] }],
        },
      ],
    });

    const compileCalls = [...calls];
    expect(compileCalls).toContain(" A-B ");
    expect(compileCalls).toContain("ab");
    expect(compileCalls).toContain("NOPE");

    expect(matches({ value: "a b" })).toBe(true);
    expect(calls.slice(compileCalls.length)).toEqual(["a b"]);

    expect(matches({ value: "a-b" })).toBe(true);
    expect(calls.slice(compileCalls.length)).toEqual(["a b", "a-b"]);
  });

  test("uses one-level some semantics without coercing objects", () => {
    let coercions = 0;
    const object = {
      toString() {
        coercions += 1;
        return "alpha";
      },
    };
    const matches = boxes.compile(
      expression({ field: "value", operator: "equals", value: "alpha" }),
    );

    expect(matches({ value: [object, ["alpha"], "bravo", "alpha"] })).toBe(true);
    expect(matches({ value: [object, ["alpha"]] })).toBe(false);
    expect(coercions).toBe(0);
  });

  test("short-circuits AND predicates and OR groups", () => {
    const calls: string[] = [];
    const filter = createFilter<object>()({
      fail: () => {
        calls.push("fail");
        return "no";
      },
      skippedPredicate: () => {
        calls.push("skipped predicate");
        throw new Error("AND did not short-circuit");
      },
      pass: () => {
        calls.push("pass");
        return "yes";
      },
      skippedGroup: () => {
        calls.push("skipped group");
        throw new Error("OR did not short-circuit");
      },
    });
    const matches = filter.compile({
      v: 1,
      any: [
        {
          all: [
            { field: "fail", operator: "equals", value: "yes" },
            { field: "skippedPredicate", operator: "empty" },
          ],
        },
        { all: [{ field: "pass", operator: "equals", value: "yes" }] },
        { all: [{ field: "skippedGroup", operator: "empty" }] },
      ],
    });

    expect(matches({})).toBe(true);
    expect(calls).toEqual(["fail", "pass"]);
  });

  test("compiles null to a constant-true predicate", () => {
    const matches = boxes.compile(null);

    expect(matches({ value: undefined })).toBe(true);
    expect(matches({ value: Symbol("anything") })).toBe(true);
  });

  test("throws structured expression errors from compile", () => {
    try {
      boxes.compile({ v: 1, any: [] });
      expect.unreachable("expected an invalid expression to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AnyallExpressionError);
      expect(error).toMatchObject({
        name: "AnyallExpressionError",
        issues: [{ code: "empty-expression", path: ["any"] }],
      });
    }
  });

  test("propagates accessor and normalizer failures", () => {
    const accessorFailure = new Error("accessor failed");
    const normalizerFailure = new Error("normalizer failed");
    const badAccessor = createFilter<Box>()({
      value: () => {
        throw accessorFailure;
      },
    }).compile(expression({ field: "value", operator: "empty" }));
    const badRecordNormalizer = createFilter<Box>()({
      value: {
        get: (box) => box.value,
        normalize: (text) => {
          if (text === "record") throw normalizerFailure;
          return text;
        },
      },
    }).compile(expression({ field: "value", operator: "equals", value: "needle" }));

    expect(() => badAccessor({ value: "anything" })).toThrow(accessorFailure);
    expect(() => badRecordNormalizer({ value: "record" })).toThrow(normalizerFailure);
    expect(() =>
      createFilter<Box>()({
        value: {
          get: (box) => box.value,
          normalize: () => {
            throw normalizerFailure;
          },
        },
      }).compile(expression({ field: "value", operator: "equals", value: "needle" })),
    ).toThrow(normalizerFailure);
  });
});

describe("filter", () => {
  const byId = createFilter<{ id: number }>()({
    id: (record) => record.id,
  });

  test("preserves record order and allocates only when a record is excluded", () => {
    const records = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const empty: Array<{ id: number }> = [];

    const selected = byId.filter(records, {
      v: 1,
      any: [{ all: [{ field: "id", operator: "one-of", value: ["3", "2"] }] }],
    });
    const unchanged = byId.filter(records, {
      v: 1,
      any: [{ all: [{ field: "id", operator: "one-of", value: ["3", "1", "2"] }] }],
    });

    expect(selected).toEqual([records[0], records[2]]);
    expect(selected).not.toBe(records);
    expect(unchanged).toBe(records);
    expect(byId.filter(records, null)).toBe(records);
    expect(byId.filter(empty, null)).toBe(empty);
  });

  test("validates before reading records and throws the same structured error", () => {
    expect(() => byId.filter([], { v: 1, any: [] })).toThrow(AnyallExpressionError);

    try {
      byId.filter([], { v: 1, any: [] });
      expect.unreachable("expected an invalid expression to throw");
    } catch (error) {
      expect(error).toMatchObject({
        issues: [{ code: "empty-expression", path: ["any"] }],
      });
    }
  });
});
