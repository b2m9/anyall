import { AnyallConfigError } from "./errors.js";

export interface RegisteredField<R> {
  readonly get: (record: R) => unknown;
  readonly normalize: (text: string) => string;
}

export type FieldRegistry<R, Name extends string> = ReadonlyMap<Name, RegisteredField<R>>;

/** Validate and snapshot field callables before expressions can depend on them. */
export function createFieldRegistry<R, Name extends string>(
  fields: unknown,
): FieldRegistry<R, Name> {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw new AnyallConfigError("fields must be an object of named accessors");
  }

  const entries = Object.entries(fields) as [Name, unknown][];
  if (entries.length === 0) {
    throw new AnyallConfigError("at least one field is required");
  }

  const registry = new Map<Name, RegisteredField<R>>();
  for (const [name, definition] of entries) {
    registry.set(name, registerField(name, definition));
  }
  return registry;
}

function registerField<R>(name: string, definition: unknown): RegisteredField<R> {
  if (typeof definition === "function") {
    return { get: definition as (record: R) => unknown, normalize: defaultNormalize };
  }

  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    throw invalidField(name, "must be an accessor function or an object with get");
  }

  const candidate = definition as { get?: unknown; normalize?: unknown };
  // Ignored configuration turns misspellings into silently different filters.
  for (const key of Object.getOwnPropertyNames(candidate)) {
    if (key !== "get" && key !== "normalize") {
      throw invalidField(name, `has unknown key ${JSON.stringify(key)}`);
    }
  }
  // Accessor properties may be stateful, so validation and registration must
  // observe the same callable.
  const get = candidate.get;
  const normalize = candidate.normalize;
  if (typeof get !== "function") {
    throw invalidField(name, "get must be a function");
  }
  if (normalize !== undefined && typeof normalize !== "function") {
    throw invalidField(name, "normalize must be a function when provided");
  }

  const registeredGet = get as (record: R) => unknown;
  if (normalize === undefined) {
    return { get: registeredGet, normalize: defaultNormalize };
  }

  const registeredNormalize = normalize as (text: string) => unknown;
  return {
    get: registeredGet,
    normalize: (text) => {
      const normalized = registeredNormalize(text);
      // A shared non-string result can make unrelated values compare equal or
      // fail later inside a string operator.
      if (typeof normalized !== "string") {
        throw invalidField(name, "normalize must return a string");
      }
      return normalized;
    },
  };
}

function defaultNormalize(text: string): string {
  return text.trim().toLowerCase();
}

function invalidField(name: string, reason: string): AnyallConfigError {
  return new AnyallConfigError(`field ${JSON.stringify(name)} ${reason}`);
}
