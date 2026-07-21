import type { Issue } from "./types.js";

/** Thrown by `createFilter` when the field registry cannot form a valid filter. */
export class AnyallConfigError extends Error {
  override readonly name = "AnyallConfigError";
}

/** Thrown by `compile` and `filter` when an asserted expression is invalid. */
export class AnyallExpressionError extends Error {
  override readonly name = "AnyallExpressionError";

  constructor(
    message: string,
    readonly issues: readonly Issue[],
  ) {
    super(message);
  }
}
