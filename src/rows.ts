import type { FieldRegistry } from "./fields.js";
import type { ExpressionResult, FilterRow, Issue, Predicate } from "./types.js";
import { validatePredicateInput } from "./validation.js";

interface IndexedRow {
  readonly index: number;
  readonly row: FilterRow;
}

export function expressionFromRows<R, Name extends string>(
  rows: readonly FilterRow[],
  registry: FieldRegistry<R, Name>,
  incomplete: "reject" | "discard" = "reject",
): ExpressionResult<Name> {
  const issues: Issue[] = [];
  const any: Array<{ readonly all: readonly Predicate<Name>[] }> = [];

  for (const slice of segmentRows(rows)) {
    const all: Predicate<Name>[] = [];
    for (const { index, row } of slice) {
      const predicate = predicateFromRow(row, registry);
      if (predicate === undefined) {
        issues.push({
          code: "incomplete-row",
          path: [index],
          message: "row does not form a valid predicate",
        });
      } else {
        all.push(predicate);
      }
    }
    if (all.length > 0) {
      any.push({ all });
    }
  }

  if (incomplete !== "discard" && issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, expression: any.length === 0 ? null : { v: 1, any } };
}

function segmentRows(rows: readonly FilterRow[]): IndexedRow[][] {
  const slices: IndexedRow[][] = [[]];
  Array.from(rows).forEach((row, index) => {
    // Boundaries come from the authored sequence, so later discards cannot
    // silently move a predicate into a different boolean group.
    if (index > 0 && isObject(row) && row.join === "or") {
      slices.push([]);
    }
    slices[slices.length - 1]!.push({ index, row });
  });
  return slices;
}

function predicateFromRow<R, Name extends string>(
  row: FilterRow,
  registry: FieldRegistry<R, Name>,
): Predicate<Name> | undefined {
  if (!isObject(row) || !hasValidJoin(row) || !hasValidNot(row)) {
    return undefined;
  }

  const candidate: Record<string, unknown> = {};
  copyOwn(row, candidate, "field");
  copyOwn(row, candidate, "operator");
  copyOwn(row, candidate, "value");
  if (Object.hasOwn(row, "not") && row.not === true) {
    candidate.not = true;
  }

  // A shared boundary keeps rows and stored data from growing subtly
  // different definitions of a predicate.
  return validatePredicateInput(candidate, registry);
}

function hasValidJoin(row: Record<string, unknown>): boolean {
  return row.join === undefined || row.join === "and" || row.join === "or";
}

function hasValidNot(row: Record<string, unknown>): boolean {
  return !Object.hasOwn(row, "not") || typeof row.not === "boolean";
}

function copyOwn(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: "field" | "operator" | "value",
): void {
  if (Object.hasOwn(source, key)) {
    target[key] = source[key];
  }
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
