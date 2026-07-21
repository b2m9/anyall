import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { createFilter, type Expression, type FilterRow, type Predicate } from "../src/index.js";

type FieldName = "a" | "b" | "c" | "d";

interface LawRecord {
  readonly id: number;
  readonly a: unknown;
  readonly b: unknown;
  readonly c: unknown;
  readonly d: unknown;
}

interface GeneratedRow {
  readonly row: FilterRow;
  readonly predicate: Predicate<FieldName>;
}

const LAW_SEED = 0x0a11a11;
const LAW_RUNS = 200;
const TOTALITY_RUNS = 300;
const lawParameters = { seed: LAW_SEED, numRuns: LAW_RUNS, endOnFailure: true } as const;

const filters = createFilter<LawRecord>()({
  a: (record) => record.a,
  b: (record) => record.b,
  c: (record) => record.c,
  d: (record) => record.d,
});

const fieldArbitrary = fc.constantFrom<FieldName>("a", "b", "c", "d");
const tokenCoreArbitrary = fc
  .array(fc.constantFrom("a", "b", "c", "d", "e", "x", "y", "z", "0", "1", "9", "-"), {
    minLength: 1,
    maxLength: 8,
  })
  .map((characters) => characters.join(""));
const tokenArbitrary = fc
  .tuple(fc.constantFrom("", " ", "  "), tokenCoreArbitrary, fc.constantFrom("", " ", "  "))
  .map(([before, token, after]) => `${before}${token}${after}`);

const plainPredicateArbitrary: fc.Arbitrary<Predicate<FieldName>> = fc.oneof(
  fc.record({
    field: fieldArbitrary,
    operator: fc.constantFrom("equals", "contains", "starts-with", "ends-with"),
    value: tokenArbitrary,
  }),
  fc
    .tuple(fieldArbitrary, tokenArbitrary, fc.array(tokenArbitrary, { maxLength: 3 }))
    .map(([field, duplicate, remainder]) => ({
      field,
      operator: "one-of" as const,
      value: [duplicate, duplicate, ...remainder],
    })),
  fieldArbitrary.map((field) => ({ field, operator: "empty" as const })),
);

const predicateArbitrary: fc.Arbitrary<Predicate<FieldName>> = fc
  .tuple(plainPredicateArbitrary, fc.boolean())
  .map(([predicate, negated]) => (negated ? ({ ...predicate, not: true } as const) : predicate));

const expressionArbitrary: fc.Arbitrary<Expression<FieldName>> = fc
  .array(fc.array(predicateArbitrary, { minLength: 1, maxLength: 3 }), {
    minLength: 1,
    maxLength: 3,
  })
  .map((groups) => ({ v: 1 as const, any: groups.map((all) => ({ all })) }));
const nullableExpressionArbitrary = fc.option(expressionArbitrary, { nil: null });

const jsonishScalarArbitrary = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer({ min: -100, max: 100 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);
const comparisonValueArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  jsonishScalarArbitrary,
  fc.array(jsonishScalarArbitrary, { maxLength: 5 }),
  fc.record({ label: fc.string({ maxLength: 8 }) }),
  fc.bigInt({ min: -100n, max: 100n }),
  fc.date({ min: new Date(0), max: new Date("2030-01-01T00:00:00.000Z") }),
);
const recordArbitrary: fc.Arbitrary<LawRecord> = fc.record(
  {
    id: fc.nat({ max: 1_000 }),
    a: comparisonValueArbitrary,
    b: comparisonValueArbitrary,
    c: comparisonValueArbitrary,
    d: comparisonValueArbitrary,
  },
  { requiredKeys: ["id", "a", "b", "c", "d"] },
);

const generatedRowArbitrary: fc.Arbitrary<GeneratedRow> = fc
  .tuple(
    plainPredicateArbitrary,
    fc.constantFrom<"and" | "or" | undefined>(undefined, "and", "or"),
    fc.boolean(),
  )
  .map(([plain, join, negated]) => {
    const predicate: Predicate<FieldName> = negated ? ({ ...plain, not: true } as const) : plain;
    const row: FilterRow = { ...plain, ...(join === undefined ? {} : { join }), not: negated };
    return { row, predicate };
  });

function resolveTexts(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const texts: string[] = [];
  for (const candidate of values) {
    const type = typeof candidate;
    if (type !== "string" && type !== "number" && type !== "boolean" && type !== "bigint") {
      continue;
    }
    const normalized = String(candidate).trim().toLowerCase();
    if (normalized !== "") texts.push(normalized);
  }
  return texts;
}

function evaluatePredicate(record: LawRecord, predicate: Predicate<FieldName>): boolean {
  const texts = resolveTexts(record[predicate.field]);
  let result: boolean;

  switch (predicate.operator) {
    case "empty":
      result = texts.length === 0;
      break;
    case "one-of": {
      const needles = new Set(predicate.value.map((value) => value.trim().toLowerCase()));
      result = texts.some((text) => needles.has(text));
      break;
    }
    case "equals": {
      const needle = predicate.value.trim().toLowerCase();
      result = texts.some((text) => text === needle);
      break;
    }
    case "contains": {
      const needle = predicate.value.trim().toLowerCase();
      result = texts.some((text) => text.includes(needle));
      break;
    }
    case "starts-with": {
      const needle = predicate.value.trim().toLowerCase();
      result = texts.some((text) => text.startsWith(needle));
      break;
    }
    case "ends-with": {
      const needle = predicate.value.trim().toLowerCase();
      result = texts.some((text) => text.endsWith(needle));
      break;
    }
  }

  return predicate.not === true ? !result : result;
}

function evaluateExhaustively(
  record: LawRecord,
  expression: Expression<FieldName> | null,
): boolean {
  if (expression === null) return true;

  // Materializing every intermediate result makes this deliberately unlike
  // the short-circuiting implementation whose observable result it checks.
  const groups = expression.any.map((group) => {
    const predicates = group.all.map((predicate) => evaluatePredicate(record, predicate));
    return predicates.every(Boolean);
  });
  return groups.some(Boolean);
}

function handBuildExpression(rows: readonly GeneratedRow[]): Expression<FieldName> {
  const any: Array<{ all: Predicate<FieldName>[] }> = [{ all: [] }];
  rows.forEach(({ row, predicate }, index) => {
    if (index > 0 && row.join === "or") any.push({ all: [] });
    any.at(-1)!.all.push(predicate);
  });
  return { v: 1, any };
}

function evaluateLeftToRight(a: boolean, b: boolean, c: boolean, d: boolean): boolean {
  return ((a && b) || c) && d;
}

describe("wire and row laws", () => {
  test("round-trips every valid expression and null without changing evaluation", () => {
    fc.assert(
      fc.property(nullableExpressionArbitrary, recordArbitrary, (expression, record) => {
        const parsed = filters.parse(JSON.stringify(expression));

        expect(parsed).toMatchObject({ ok: true });
        if (!parsed.ok) return;
        expect(parsed.expression).toEqual(expression);
        expect(filters.compile(parsed.expression)(record)).toBe(
          filters.compile(expression)(record),
        );
      }),
      lawParameters,
    );
  });

  test("round-trips duplicate one-of tokens verbatim", () => {
    const expression: Expression<FieldName> = {
      v: 1,
      any: [{ all: [{ field: "a", operator: "one-of", value: [" Alpha ", " Alpha "] }] }],
    };
    const parsed = filters.parse(JSON.stringify(expression));

    expect(parsed).toEqual({ ok: true, expression });
    if (!parsed.ok) return;
    const matches = filters.compile(parsed.expression);
    expect(matches({ id: 1, a: "alpha", b: null, c: null, d: null })).toBe(true);
    expect(matches({ id: 2, a: "omega", b: null, c: null, d: null })).toBe(false);
  });

  test("round-trips the null produced by an empty row list", () => {
    const built = filters.fromRows([]);

    expect(built).toEqual({ ok: true, expression: null });
    if (!built.ok) return;
    expect(filters.parse(JSON.stringify(built.expression))).toEqual(built);
  });

  test("fromRows preserves authored DNF semantics, including not", () => {
    fc.assert(
      fc.property(
        fc.array(generatedRowArbitrary, { minLength: 1, maxLength: 8 }),
        recordArbitrary,
        (generatedRows, record) => {
          const rows = generatedRows.map(({ row }) => row);
          const snapshot = structuredClone(rows);
          const expected = handBuildExpression(generatedRows);
          const built = filters.fromRows(rows);

          expect(built).toEqual({ ok: true, expression: expected });
          expect(rows).toEqual(snapshot);
          if (!built.ok) return;
          expect(filters.compile(built.expression)(record)).toBe(
            evaluateExhaustively(record, expected),
          );
        },
      ),
      lawParameters,
    );
  });
});

describe("evaluation laws", () => {
  test("is deterministic, stateless, and does not mutate records or expressions", () => {
    fc.assert(
      fc.property(
        fc.array(recordArbitrary, { maxLength: 12 }),
        nullableExpressionArbitrary,
        (records, expression) => {
          const recordsSnapshot = structuredClone(records);
          const expressionSnapshot = structuredClone(expression);
          const predicate = filters.compile(expression);

          const firstPredicateRun = records.map(predicate);
          const secondPredicateRun = records.map(predicate);
          const firstFilterRun = filters.filter(records, expression);
          const secondFilterRun = filters.filter(records, expression);

          expect(secondPredicateRun).toEqual(firstPredicateRun);
          expect(secondFilterRun).toEqual(firstFilterRun);
          expect(records).toEqual(recordsSnapshot);
          expect(expression).toEqual(expressionSnapshot);
        },
      ),
      lawParameters,
    );
  });

  test("negation exactly complements the plain predicate", () => {
    fc.assert(
      fc.property(plainPredicateArbitrary, recordArbitrary, (plain, record) => {
        const plainExpression: Expression<FieldName> = {
          v: 1,
          any: [{ all: [plain] }],
        };
        const negatedExpression: Expression<FieldName> = {
          v: 1,
          any: [{ all: [{ ...plain, not: true }] }],
        };

        expect(filters.compile(negatedExpression)(record)).toBe(
          !filters.compile(plainExpression)(record),
        );
      }),
      lawParameters,
    );
  });

  test("agrees with an exhaustive reference evaluator", () => {
    fc.assert(
      fc.property(nullableExpressionArbitrary, recordArbitrary, (expression, record) => {
        expect(filters.compile(expression)(record)).toBe(evaluateExhaustively(record, expression));
      }),
      lawParameters,
    );
  });

  test("compiled predicates own their structure and needles", () => {
    const tokens = [" Alpha ", "alpha"];
    const all: Predicate<FieldName>[] = [{ field: "a", operator: "one-of", value: tokens }];
    const any = [{ all }];
    const source: Expression<FieldName> = { v: 1, any };
    const matches = filters.compile(source);
    const probes: LawRecord[] = [
      { id: 1, a: "alpha", b: null, c: null, d: null },
      { id: 2, a: "omega", b: null, c: null, d: null },
    ];

    const beforeMutation = probes.map(matches);
    tokens.splice(0, tokens.length, "omega");
    all.splice(0, all.length, { field: "a", operator: "empty" });
    any.splice(0, any.length);

    expect(beforeMutation).toEqual([true, false]);
    expect(probes.map(matches)).toEqual(beforeMutation);
  });

  test("returns the input reference iff no record is excluded and otherwise stays stable", () => {
    fc.assert(
      fc.property(
        fc.array(recordArbitrary, { maxLength: 12 }),
        nullableExpressionArbitrary,
        (records, expression) => {
          const expected = records.filter((record) => evaluateExhaustively(record, expression));
          const actual = filters.filter(records, expression);

          expect(actual).toEqual(expected);
          actual.forEach((record, index) => expect(record).toBe(expected[index]));
          if (expected.length === records.length) {
            expect(actual).toBe(records);
          } else {
            expect(actual).not.toBe(records);
          }
        },
      ),
      lawParameters,
    );
  });
});

describe("resolution totality", () => {
  const values = createFilter<{ readonly value: unknown }>()({
    value: (record) => record.value,
  });
  const valueExpressionArbitrary: fc.Arbitrary<Expression<"value">> = fc
    .array(
      fc.array(
        predicateArbitrary.map(
          (predicate): Predicate<"value"> => ({
            ...predicate,
            field: "value",
          }),
        ),
        { minLength: 1, maxLength: 3 },
      ),
      { minLength: 1, maxLength: 3 },
    )
    .map((groups) => ({ v: 1 as const, any: groups.map((all) => ({ all })) }));
  const exoticAtomArbitrary = fc.oneof(
    fc.string({ maxLength: 12 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.bigInt(),
    fc.date(),
    fc.string({ maxLength: 8 }).map((description) => Symbol(description)),
    fc.string({ maxLength: 8 }).map((result) => () => result),
  );
  const inertAccessorValueArbitrary: fc.Arbitrary<unknown> = fc.oneof(
    fc.jsonValue(),
    exoticAtomArbitrary,
    fc.array(exoticAtomArbitrary, { maxLength: 6 }),
  );

  test("is total for JSON data, functions, symbols, bigints, Dates, and mixtures", () => {
    fc.assert(
      fc.property(inertAccessorValueArbitrary, valueExpressionArbitrary, (value, expression) => {
        const matches = values.compile(expression);
        expect(() => matches({ value })).not.toThrow();
        expect(typeof matches({ value })).toBe("boolean");
      }),
      { ...lawParameters, numRuns: TOTALITY_RUNS },
    );
  });

  test("treats post-normalization empties as empty", () => {
    const normalized = createFilter<{ readonly value: unknown }>()({
      value: {
        get: (record) => record.value,
        normalize: (text) => text.replaceAll(/[\s-]/g, "").toLowerCase(),
      },
    });
    const isEmpty = normalized.compile({
      v: 1,
      any: [{ all: [{ field: "value", operator: "empty" }] }],
    });
    const isAlpha = normalized.compile({
      v: 1,
      any: [{ all: [{ field: "value", operator: "equals", value: "alpha" }] }],
    });

    expect(isEmpty({ value: " - " })).toBe(true);
    expect(isEmpty({ value: ["--", " "] })).toBe(true);
    expect(isAlpha({ value: ["--", " alpha "] })).toBe(true);
  });

  test("keeps zero and false as matchable texts", () => {
    const isZero = values.compile({
      v: 1,
      any: [{ all: [{ field: "value", operator: "equals", value: "0" }] }],
    });
    const isFalse = values.compile({
      v: 1,
      any: [{ all: [{ field: "value", operator: "equals", value: "false" }] }],
    });
    const isEmpty = values.compile({
      v: 1,
      any: [{ all: [{ field: "value", operator: "empty" }] }],
    });

    expect(isZero({ value: 0 })).toBe(true);
    expect(isFalse({ value: false })).toBe(true);
    expect(isEmpty({ value: 0 })).toBe(false);
    expect(isEmpty({ value: false })).toBe(false);
  });
});

describe("the four-row grouping case", () => {
  test("evaluates (A && B) || (C && D) for the full truth table", () => {
    const built = filters.fromRows([
      { field: "a", operator: "equals", value: "true" },
      { join: "and", field: "b", operator: "equals", value: "true" },
      { join: "or", field: "c", operator: "equals", value: "true" },
      { join: "and", field: "d", operator: "equals", value: "true" },
    ]);

    expect(built).toMatchObject({ ok: true });
    if (!built.ok) return;
    const matches = filters.compile(built.expression);
    let id = 0;

    for (const a of [false, true]) {
      for (const b of [false, true]) {
        for (const c of [false, true]) {
          for (const d of [false, true]) {
            const record = { id: id++, a, b, c, d };
            expect(matches(record), JSON.stringify({ a, b, c, d })).toBe((a && b) || (c && d));
          }
        }
      }
    }

    expect(matches({ id, a: true, b: true, c: false, d: false })).toBe(true);
    expect(evaluateLeftToRight(true, true, false, false)).toBe(false);
  });
});
