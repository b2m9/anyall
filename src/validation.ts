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
  readonly captureNeedle: ((needle: string) => void) | undefined;
}

export function validatePredicateInput<R, Name extends string>(
  input: unknown,
  registry: FieldRegistry<R, Name>,
): Predicate<Name> | undefined {
  const context: ValidationContext<R, Name> = {
    registry,
    issues: [],
    captureNeedle: undefined,
  };
  const predicate = validatePredicate(input, [], context);
  return context.issues.length === 0 ? predicate : undefined;
}

export function validateExpression<R, Name extends string>(
  input: unknown,
  registry: FieldRegistry<R, Name>,
  captureNeedle?: (needle: string) => void,
): ExpressionResult<Name> {
  if (input === null) {
    return { ok: true, expression: null };
  }

  const context: ValidationContext<R, Name> = { registry, issues: [], captureNeedle };
  const expression = validateRoot(input, context);
  if (context.issues.length > 0 || expression === undefined) {
    return { ok: false, issues: orderByDocumentPath(input, context.issues) };
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

  if (!Object.hasOwn(input, "v")) {
    addIssue(context, "invalid-shape", ["v"], "version is required");
  } else if (input.v !== 1) {
    addIssue(context, "unsupported-version", ["v"], "only expression version 1 is supported");
  }

  let any: Array<{ readonly all: readonly Predicate<Name>[] } | undefined> | undefined;
  if (!Object.hasOwn(input, "any")) {
    addIssue(context, "invalid-shape", ["any"], "any is required");
  } else if (!Array.isArray(input.any)) {
    addIssue(context, "invalid-shape", ["any"], "any must be an array");
  } else if (input.any.length === 0) {
    addIssue(context, "empty-expression", ["any"], "an expression must contain a group");
    any = [];
  } else {
    // Array.from both visits holes and refuses an input subclass's species.
    any = Array.from(input.any, (group, index) => validateGroup(group, ["any", index], context));
  }

  rejectUnknownKeys(input, new Set(["v", "any"]), [], context);

  if (input.v !== 1 || any === undefined || any.some((group) => group === undefined)) {
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

  if (
    field === undefined ||
    operator === undefined ||
    value === invalidValue ||
    not === invalidNot
  ) {
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

const invalidValue = Symbol("invalid value");

function validateValue<R, Name extends string>(
  input: Record<string, unknown>,
  field: Name | undefined,
  operator: Operator | undefined,
  path: Path,
  context: ValidationContext<R, Name>,
): string | readonly string[] | undefined | typeof invalidValue {
  if (operator === undefined) {
    return undefined;
  }

  const valuePath = [...path, "value"];
  if (operator === "empty") {
    if (Object.hasOwn(input, "value")) {
      addIssue(context, "invalid-value", valuePath, "empty predicates do not accept a value");
      return invalidValue;
    }
    return undefined;
  }

  if (!Object.hasOwn(input, "value")) {
    addIssue(context, "invalid-value", valuePath, `${operator} requires a value`);
    return invalidValue;
  }

  if (scalarOperators.has(operator)) {
    if (typeof input.value !== "string") {
      addIssue(context, "invalid-value", valuePath, `${operator} requires a string value`);
      return invalidValue;
    }
    if (
      field !== undefined &&
      normalizeNeedle(input.value, field, context.registry, context.captureNeedle) === ""
    ) {
      addIssue(context, "empty-needle", valuePath, "needle is empty after normalization");
      return invalidValue;
    }
    return input.value;
  }

  if (!Array.isArray(input.value)) {
    addIssue(context, "invalid-value", valuePath, "one-of requires an array of strings");
    return invalidValue;
  }
  if (input.value.length === 0) {
    addIssue(context, "empty-needle", valuePath, "one-of requires at least one needle");
    return invalidValue;
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
    if (
      field !== undefined &&
      normalizeNeedle(token, field, context.registry, context.captureNeedle) === ""
    ) {
      addIssue(
        context,
        "empty-needle",
        [...valuePath, index],
        "needle is empty after normalization",
      );
      valid = false;
    }
  }
  return valid ? tokens : invalidValue;
}

const invalidNot = Symbol("invalid not");

function validateNot<R, Name extends string>(
  input: Record<string, unknown>,
  path: Path,
  context: ValidationContext<R, Name>,
): true | undefined | typeof invalidNot {
  if (!Object.hasOwn(input, "not") || input.not === undefined) {
    return undefined;
  }
  if (input.not !== true) {
    addIssue(context, "invalid-value", [...path, "not"], "not must be true when present");
    return invalidNot;
  }
  return true;
}

function normalizeNeedle<R, Name extends string>(
  needle: string,
  field: Name,
  registry: FieldRegistry<R, Name>,
  captureNeedle?: (needle: string) => void,
): string {
  const normalized = registry.get(field)!.normalize(needle);
  captureNeedle?.(normalized);
  return normalized;
}

function rejectUnknownKeys<R, Name extends string>(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: Path,
  context: ValidationContext<R, Name>,
): void {
  for (const key of Object.getOwnPropertyNames(input)) {
    if (!allowed.has(key)) {
      addIssue(context, "invalid-shape", [...path, key], `unknown key ${JSON.stringify(key)}`);
    }
  }
}

function orderByDocumentPath(input: unknown, issues: readonly Issue[]): Issue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => {
      const order = compareDocumentPaths(input, left.issue.path, right.issue.path);
      return order === 0 ? left.index - right.index : order;
    })
    .map(({ issue }) => issue);
}

function compareDocumentPaths(input: unknown, left: Path, right: Path): number {
  let parent = input;
  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart !== rightPart) {
      if (Array.isArray(parent) && typeof leftPart === "number" && typeof rightPart === "number") {
        return leftPart - rightPart;
      }
      if (isObject(parent) && typeof leftPart === "string" && typeof rightPart === "string") {
        const keys = Object.getOwnPropertyNames(parent);
        const leftIndex = keys.indexOf(leftPart);
        const rightIndex = keys.indexOf(rightPart);
        if (leftIndex >= 0 && rightIndex >= 0) {
          return leftIndex - rightIndex;
        }
      }
      return 0;
    }

    if ((Array.isArray(parent) || isObject(parent)) && leftPart !== undefined) {
      parent = parent[leftPart as keyof typeof parent];
    }
  }

  return left.length - right.length;
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
