import type { FieldRegistry } from "./fields.js";
import type { Expression, ExpressionResult, Issue, Operator, Predicate } from "./types.js";

const operators = new Set<Operator>([
  "equals",
  "contains",
  "starts-with",
  "ends-with",
  "one-of",
  "empty",
]);
const scalarOperators = new Set<Operator>(["equals", "contains", "starts-with", "ends-with"]);

type Path = ReadonlyArray<string | number>;

interface ValidationContext<R, Name extends string> {
  readonly registry: FieldRegistry<R, Name>;
  readonly issues: Issue[];
}

export function validatePredicateInput<R, Name extends string>(
  input: unknown,
  registry: FieldRegistry<R, Name>,
):
  | { readonly ok: true; readonly predicate: Predicate<Name> }
  | { readonly ok: false; readonly issues: readonly Issue[] } {
  const context: ValidationContext<R, Name> = {
    registry,
    issues: [],
  };
  const predicate = validatePredicate(input, [], context);
  if (context.issues.length > 0 || predicate === undefined) {
    return { ok: false, issues: context.issues };
  }
  return { ok: true, predicate };
}

export function validateExpression<R, Name extends string>(
  input: unknown,
  registry: FieldRegistry<R, Name>,
): ExpressionResult<Name> {
  if (input === null) {
    return { ok: true, expression: null };
  }

  const context: ValidationContext<R, Name> = { registry, issues: [] };
  // Known fields are judged in grammar order before extras, keeping actionable
  // diagnostics stable without sorting caller-owned keys.
  const expression = validateRoot(input, context);
  if (context.issues.length > 0 || expression === undefined) {
    return { ok: false, issues: context.issues };
  }
  return { ok: true, expression };
}

function validateRoot<R, Name extends string>(
  input: unknown,
  context: ValidationContext<R, Name>,
): Expression<Name> | undefined {
  if (!isObject(input)) {
    addIssue(context, "invalid-shape", [], "expression must be an object or null");
    return undefined;
  }

  const version = Object.hasOwn(input, "v") ? input.v : undefined;
  if (version === undefined) {
    addIssue(context, "invalid-shape", ["v"], "version is required");
  } else if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    addIssue(context, "invalid-shape", ["v"], "version must be a positive safe integer");
  } else if (version !== 1) {
    addIssue(context, "unsupported-version", ["v"], "only expression version 1 is supported");
    // A foreign version names a foreign grammar, so deeper judgments would be
    // guesses rather than actionable validation.
    return undefined;
  }

  const anyInput = Object.hasOwn(input, "any") ? input.any : undefined;
  let any: Array<{ readonly all: readonly Predicate<Name>[] } | undefined> | undefined;
  if (anyInput === undefined) {
    addIssue(context, "invalid-shape", ["any"], "any is required");
  } else if (!Array.isArray(anyInput)) {
    addIssue(context, "invalid-shape", ["any"], "any must be an array");
  } else if (anyInput.length === 0) {
    addIssue(context, "empty-expression", ["any"], "an expression must contain a group");
    any = [];
  } else {
    // Array.from both visits holes and refuses an input subclass's species.
    any = Array.from(anyInput, (group, index) => validateGroup(group, ["any", index], context));
  }

  rejectUnknownKeys(input, new Set(["v", "any"]), [], context);

  if (version !== 1 || any === undefined || any.some((group) => group === undefined)) {
    return undefined;
  }
  return { v: 1, any: any as Array<{ readonly all: readonly Predicate<Name>[] }> };
}

function validateGroup<R, Name extends string>(
  input: unknown,
  path: Path,
  context: ValidationContext<R, Name>,
): { readonly all: readonly Predicate<Name>[] } | undefined {
  if (!isObject(input)) {
    addIssue(context, "invalid-shape", path, "group must be an object");
    return undefined;
  }

  let all: Array<Predicate<Name> | undefined> | undefined;
  if (!Object.hasOwn(input, "all")) {
    addIssue(context, "invalid-shape", [...path, "all"], "all is required");
  } else if (!Array.isArray(input.all)) {
    addIssue(context, "invalid-shape", [...path, "all"], "all must be an array");
  } else if (input.all.length === 0) {
    addIssue(context, "empty-group", [...path, "all"], "a group must contain a predicate");
    all = [];
  } else {
    all = Array.from(input.all, (predicate, index) =>
      validatePredicate(predicate, [...path, "all", index], context),
    );
  }

  rejectUnknownKeys(input, new Set(["all"]), path, context);
  if (all === undefined || all.some((predicate) => predicate === undefined)) {
    return undefined;
  }
  return { all: all as Predicate<Name>[] };
}

function validatePredicate<R, Name extends string>(
  input: unknown,
  path: Path,
  context: ValidationContext<R, Name>,
): Predicate<Name> | undefined {
  if (!isObject(input)) {
    addIssue(context, "invalid-shape", path, "predicate must be an object");
    return undefined;
  }

  const field = validateField(input, path, context);
  const operator = validateOperator(input, path, context);
  const value = validateValue(input, field, operator, path, context);
  const not = validateNot(input, path, context);
  rejectUnknownKeys(input, new Set(["field", "operator", "value", "not"]), path, context);

  if (field === undefined || operator === undefined) {
    return undefined;
  }
  if (operator === "empty") {
    return not === true ? { field, operator, not: true } : { field, operator };
  }
  if (operator === "one-of") {
    if (!Array.isArray(value)) {
      return undefined;
    }
    return not === true
      ? { field, operator, value: value as string[], not: true }
      : { field, operator, value: value as string[] };
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return not === true ? { field, operator, value, not: true } : { field, operator, value };
}

function validateField<R, Name extends string>(
  input: Record<string, unknown>,
  path: Path,
  context: ValidationContext<R, Name>,
): Name | undefined {
  if (!Object.hasOwn(input, "field") || typeof input.field !== "string") {
    addIssue(context, "invalid-shape", [...path, "field"], "field must be a string");
    return undefined;
  }
  if (!context.registry.has(input.field as Name)) {
    addIssue(
      context,
      "unknown-field",
      [...path, "field"],
      `unknown field ${JSON.stringify(input.field)}`,
    );
    return undefined;
  }
  return input.field as Name;
}

function validateOperator<R, Name extends string>(
  input: Record<string, unknown>,
  path: Path,
  context: ValidationContext<R, Name>,
): Operator | undefined {
  if (!Object.hasOwn(input, "operator") || typeof input.operator !== "string") {
    addIssue(context, "invalid-shape", [...path, "operator"], "operator must be a string");
    return undefined;
  }
  if (!operators.has(input.operator as Operator)) {
    addIssue(
      context,
      "unknown-operator",
      [...path, "operator"],
      `unknown operator ${JSON.stringify(input.operator)}`,
    );
    return undefined;
  }
  return input.operator as Operator;
}

function validateValue<R, Name extends string>(
  input: Record<string, unknown>,
  field: Name | undefined,
  operator: Operator | undefined,
  path: Path,
  context: ValidationContext<R, Name>,
): string | readonly string[] | undefined {
  if (operator === undefined) {
    return undefined;
  }

  const valuePath = [...path, "value"];
  if (operator === "empty") {
    if (Object.hasOwn(input, "value") && input.value !== undefined) {
      addIssue(context, "invalid-value", valuePath, "empty predicates do not accept a value");
    }
    return undefined;
  }

  if (!Object.hasOwn(input, "value") || input.value === undefined) {
    addIssue(context, "invalid-value", valuePath, `${operator} requires a value`);
    return undefined;
  }

  if (scalarOperators.has(operator)) {
    if (typeof input.value !== "string") {
      addIssue(context, "invalid-value", valuePath, `${operator} requires a string value`);
      return undefined;
    }
    if (field !== undefined && normalizeNeedle(input.value, field, context.registry) === "") {
      addIssue(context, "empty-needle", valuePath, "needle is empty after normalization");
      return undefined;
    }
    return input.value;
  }

  if (!Array.isArray(input.value)) {
    addIssue(context, "invalid-value", valuePath, "one-of requires an array of strings");
    return undefined;
  }
  if (input.value.length === 0) {
    addIssue(context, "empty-needle", valuePath, "one-of requires at least one needle");
    return undefined;
  }

  let valid = true;
  const tokens: string[] = [];
  for (const [index, token] of input.value.entries()) {
    if (typeof token !== "string") {
      addIssue(context, "invalid-value", [...valuePath, index], "one-of tokens must be strings");
      valid = false;
      continue;
    }
    tokens.push(token);
    if (field !== undefined && normalizeNeedle(token, field, context.registry) === "") {
      addIssue(
        context,
        "empty-needle",
        [...valuePath, index],
        "needle is empty after normalization",
      );
      valid = false;
    }
  }
  return valid ? tokens : undefined;
}

function validateNot<R, Name extends string>(
  input: Record<string, unknown>,
  path: Path,
  context: ValidationContext<R, Name>,
): true | undefined {
  if (!Object.hasOwn(input, "not") || input.not === undefined) {
    return undefined;
  }
  if (input.not !== true) {
    addIssue(context, "invalid-value", [...path, "not"], "not must be true when present");
    return undefined;
  }
  return true;
}

function normalizeNeedle<R, Name extends string>(
  needle: string,
  field: Name,
  registry: FieldRegistry<R, Name>,
): string {
  return registry.get(field)!.normalize(needle);
}

function rejectUnknownKeys<R, Name extends string>(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: Path,
  context: ValidationContext<R, Name>,
): void {
  // Known grammar fields are judged before extras regardless of source order.
  for (const key of Object.getOwnPropertyNames(input)) {
    if (!allowed.has(key)) {
      addIssue(context, "invalid-shape", [...path, key], `unknown key ${JSON.stringify(key)}`);
    }
  }
}

function addIssue<R, Name extends string>(
  context: ValidationContext<R, Name>,
  code: Issue["code"],
  path: Path,
  message: string,
): void {
  context.issues.push({ code, path, message });
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
