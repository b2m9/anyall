import { AnyallConfigError } from "./errors.js";
import type { FieldDef } from "./types.js";

export interface RegisteredField<R> {
  readonly get: (record: R) => unknown;
  readonly normalize: (text: string) => string;
}

export type FieldRegistry<R, Name extends string> = ReadonlyMap<Name, RegisteredField<R>>;

/** Validate and snapshot field callables before expressions can depend on them. */
export function createFieldRegistry<R, Name extends string>(
  fields: Readonly<Record<Name, FieldDef<R>>>,
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
  if (typeof candidate.get !== "function") {
    throw invalidField(name, "get must be a function");
  }
  if (candidate.normalize !== undefined && typeof candidate.normalize !== "function") {
    throw invalidField(name, "normalize must be a function when provided");
  }

  const get = candidate.get as (record: R) => unknown;
  if (candidate.normalize === undefined) {
    return { get, normalize: defaultNormalize };
  }
  return { get, normalize: candidate.normalize as (text: string) => string };
}

function defaultNormalize(text: string): string {
  return text.trim().toLowerCase();
}

function invalidField(name: string, reason: string): AnyallConfigError {
  return new AnyallConfigError(`field ${JSON.stringify(name)} ${reason}`);
}
