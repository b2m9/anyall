import { AnyallConfigError } from "./errors.js";
import type { FieldRegistry } from "./fields.js";
import type { ExpressionResult, FilterRow, Issue, Predicate } from "./types.js";
import { validatePredicateInput } from "./validation.js";

interface IndexedRow {
  readonly index: number;
  readonly row: FilterRow;
}

type RowConversion<Name extends string> =
  | { readonly ok: true; readonly predicate: Predicate<Name> }
  | { readonly ok: false; readonly message: string };

export function expressionFromRows<R, Name extends string>(
  rows: readonly FilterRow[],
  registry: FieldRegistry<R, Name>,
  incomplete: "reject" | "discard" = "reject",
): ExpressionResult<Name> {
  if (incomplete !== "reject" && incomplete !== "discard") {
    throw new AnyallConfigError('incomplete must be "reject" or "discard"');
  }

  const issues: Issue[] = [];
  const any: Array<{ readonly all: readonly Predicate<Name>[] }> = [];

  for (const slice of segmentRows(rows)) {
    const all: Predicate<Name>[] = [];
    for (const { index, row } of slice) {
      const converted = predicateFromRow(row, registry);
      if (!converted.ok) {
        issues.push({
          code: "incomplete-row",
          path: [index],
          message: converted.message,
        });
      } else {
        all.push(converted.predicate);
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
  // Materializing the sequence visits holes so sparse UI state is reported
  // as incomplete instead of silently changing the authored filter.
  Array.from(rows).forEach((row, index) => {
    // Boundaries come from the authored sequence, so later discards cannot
    // silently move a predicate into a different boolean group.
    if (index > 0 && isObject(row) && Object.hasOwn(row, "join") && row.join === "or") {
      slices.push([]);
    }
    slices[slices.length - 1]!.push({ index, row });
  });
  return slices;
}

function predicateFromRow<R, Name extends string>(
  row: FilterRow,
  registry: FieldRegistry<R, Name>,
): RowConversion<Name> {
  if (!isObject(row)) {
    return { ok: false, message: "row must be an object" };
  }

  if (
    Object.hasOwn(row, "join") &&
    row.join !== undefined &&
    row.join !== "and" &&
    row.join !== "or"
  ) {
    return { ok: false, message: 'join must be "and" or "or" when present' };
  }
  if (Object.hasOwn(row, "not") && row.not !== undefined && typeof row.not !== "boolean") {
    return { ok: false, message: "not must be a boolean when present" };
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
  const validated = validatePredicateInput(candidate, registry);
  if (!validated.ok) {
    // Rows expose one issue by index; combining predicate reasons preserves
    // that stable cardinality without reducing the message to a generic fault.
    return { ok: false, message: validated.issues.map((issue) => issue.message).join("; ") };
  }
  return { ok: true, predicate: validated.predicate };
}

function copyOwn(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: "field" | "operator" | "value",
): void {
  if (Object.hasOwn(source, key) && source[key] !== undefined) {
    target[key] = source[key];
  }
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
