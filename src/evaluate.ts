import { AnyallExpressionError } from "./errors.js";
import type { FieldRegistry, RegisteredField } from "./fields.js";
import type { Expression, Predicate } from "./types.js";
import { validateExpression } from "./validation.js";

type CompiledPredicate<R> = (record: R) => boolean;

export function compileExpression<R, Name extends string>(
  expression: Expression<Name> | null,
  registry: FieldRegistry<R, Name>,
): (record: R) => boolean {
  const normalizedNeedles: string[] = [];
  // Validation already normalizes needles to reject empty ones; capturing that
  // exact result avoids duplicate domain work at the compile boundary.
  const result = validateExpression(expression, registry, (needle) => {
    normalizedNeedles.push(needle);
  });
  if (!result.ok) {
    throw new AnyallExpressionError("invalid filter expression", result.issues);
  }
  if (result.expression === null) {
    return () => true;
  }

  let needleIndex = 0;
  const groups = result.expression.any.map((group) =>
    group.all.map((predicate) => {
      const compiled = compilePredicate(predicate, registry, normalizedNeedles, needleIndex);
      needleIndex = compiled.nextNeedleIndex;
      return compiled.matches;
    }),
  );

  return (record) => groups.some((group) => group.every((matches) => matches(record)));
}

export function filterRecords<R>(
  records: readonly R[],
  matches: (record: R) => boolean,
): readonly R[] {
  let selected: R[] | undefined;
  for (const [index, record] of records.entries()) {
    if (matches(record)) {
      selected?.push(record);
    } else if (selected === undefined) {
      // Delaying the copy makes the reference-preserving no-op a natural result,
      // not a second pass or an after-the-fact special case.
      selected = records.slice(0, index);
    }
  }
  return selected ?? records;
}

function compilePredicate<R, Name extends string>(
  predicate: Predicate<Name>,
  registry: FieldRegistry<R, Name>,
  normalizedNeedles: readonly string[],
  needleIndex: number,
): { readonly matches: CompiledPredicate<R>; readonly nextNeedleIndex: number } {
  const field = registry.get(predicate.field)!;
  let base: CompiledPredicate<R>;

  switch (predicate.operator) {
    case "empty":
      base = (record) => resolveTexts(field.get(record), field).length === 0;
      break;
    case "one-of": {
      const needles = new Set(
        normalizedNeedles.slice(needleIndex, needleIndex + predicate.value.length),
      );
      needleIndex += predicate.value.length;
      base = (record) => resolveTexts(field.get(record), field).some((text) => needles.has(text));
      break;
    }
    case "equals": {
      const needle = normalizedNeedles[needleIndex++]!;
      base = (record) => resolveTexts(field.get(record), field).some((text) => text === needle);
      break;
    }
    case "contains": {
      const needle = normalizedNeedles[needleIndex++]!;
      base = (record) =>
        resolveTexts(field.get(record), field).some((text) => text.includes(needle));
      break;
    }
    case "starts-with": {
      const needle = normalizedNeedles[needleIndex++]!;
      base = (record) =>
        resolveTexts(field.get(record), field).some((text) => text.startsWith(needle));
      break;
    }
    case "ends-with": {
      const needle = normalizedNeedles[needleIndex++]!;
      base = (record) =>
        resolveTexts(field.get(record), field).some((text) => text.endsWith(needle));
      break;
    }
  }

  return {
    matches: predicate.not === true ? (record) => !base(record) : base,
    nextNeedleIndex: needleIndex,
  };
}

function resolveTexts<R>(value: unknown, field: RegisteredField<R>): string[] {
  const texts: string[] = [];
  if (Array.isArray(value)) {
    // One scalar pass keeps array fields useful without turning record
    // resolution into recursive traversal over caller-owned structures.
    for (const element of value) appendScalar(element, field.normalize, texts);
  } else {
    appendScalar(value, field.normalize, texts);
  }
  return texts;
}

function appendScalar(value: unknown, normalize: (text: string) => string, texts: string[]): void {
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean" && type !== "bigint") {
    return;
  }

  const text = normalize(String(value));
  if (text !== "") texts.push(text);
}
