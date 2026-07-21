/**
 * A declared record capability: an accessor function, or an object when the
 * field also needs domain-specific text normalization.
 */
export type FieldDef<R> =
  | ((record: R) => unknown)
  | {
      /** Reads the field value from a record. Must be pure and total. */
      readonly get: (record: R) => unknown;
      /**
       * Applied to record texts and needles at evaluation time. Must be pure
       * and total; defaults to trimming and lowercasing.
       */
      readonly normalize?: (text: string) => string;
    };

/**
 * One field test from the package's closed vocabulary. Operator/value
 * mismatches are unrepresentable; `not: true` negates any base result.
 */
export type Predicate<Name extends string = string> =
  | {
      readonly field: Name;
      readonly operator: "equals" | "contains" | "starts-with" | "ends-with";
      readonly value: string;
      readonly not?: true;
    }
  | {
      readonly field: Name;
      readonly operator: "one-of";
      readonly value: readonly string[];
      readonly not?: true;
    }
  | {
      readonly field: Name;
      readonly operator: "empty";
      readonly not?: true;
    };

/** The six operators understood by every anyall expression. */
export type Operator = Predicate["operator"];

/**
 * A versioned disjunctive-normal-form expression: any group may pass, while
 * every predicate in a passing group's `all` list must pass.
 *
 * Non-empty groups and expressions are enforced at runtime because ordinary
 * array builders should not need tuple assertions.
 */
export interface Expression<Name extends string = string> {
  readonly v: 1;
  readonly any: ReadonlyArray<{
    readonly all: readonly Predicate<Name>[];
  }>;
}

/** Deliberately loose UI state; conversion is the validation boundary. */
export interface FilterRow {
  /** Starts a new group only when literally `"or"`. */
  readonly join?: "and" | "or";
  /** `true` negates the predicate; `false` and absence do not. */
  readonly not?: boolean;
  readonly field?: string;
  readonly operator?: string;
  readonly value?: unknown;
}

/** A structured boundary failure with a stable machine-readable location. */
export interface Issue {
  readonly code:
    | "invalid-json"
    | "invalid-shape"
    | "unsupported-version"
    | "empty-expression"
    | "empty-group"
    | "unknown-field"
    | "unknown-operator"
    | "invalid-value"
    | "empty-needle"
    | "incomplete-row";
  /** Into an expression, or the source row index for `incomplete-row`. */
  readonly path: ReadonlyArray<string | number>;
  /** Human-readable context; consumers should branch on `code` and `path`. */
  readonly message: string;
}

/** Rows and stored data share one result shape so callers need one error path. */
export type ExpressionResult<Name extends string> =
  | { readonly ok: true; readonly expression: Expression<Name> | null }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** A filter surface bound to one declared record capability registry. */
export interface Filter<R, Name extends string> {
  /**
   * Segments flat UI rows at each `join: "or"`, then validates within those
   * groups. Incomplete rows reject by default; `"discard"` removes them only
   * after grouping. Zero surviving groups produce the no-filter value `null`.
   */
  fromRows(
    rows: readonly FilterRow[],
    options?: { readonly incomplete?: "reject" | "discard" },
  ): ExpressionResult<Name>;

  /**
   * Compiles an expression into a reusable record predicate. `null` compiles
   * to a constant-true predicate. Invalid asserted input throws
   * `AnyallExpressionError` with the issues `parse` would return.
   */
  compile(expression: Expression<Name> | null): (record: R) => boolean;

  /**
   * Filters without reordering records. Returns the input array by reference
   * exactly when no record is excluded; invalid input throws as `compile` does.
   * Validates and compiles on each call; reuse `compile` for repeated evaluation.
   */
  filter(records: readonly R[], expression: Expression<Name> | null): readonly R[];

  /**
   * Restores JSON text or an already-parsed value. A string is always treated
   * as JSON text. Success returns fresh canonical data; ordinary invalid input
   * returns structured issues, and `null` is the valid no-filter value.
   */
  parse(input: unknown): ExpressionResult<Name>;
}
