/** A declared record capability, optionally with domain-specific text normalization. */
export type FieldDef<R> =
  | ((record: R) => unknown)
  | {
      readonly get: (record: R) => unknown;
      /** Must be pure; comparison applies it to both record texts and needles. */
      readonly normalize?: (text: string) => string;
    };

/** A value-bearing or empty predicate from the package's closed vocabulary. */
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
  readonly join?: "and" | "or";
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
  fromRows(
    rows: readonly FilterRow[],
    options?: { readonly incomplete?: "reject" | "discard" },
  ): ExpressionResult<Name>;

  compile(expression: Expression<Name> | null): (record: R) => boolean;

  filter(records: readonly R[], expression: Expression<Name> | null): readonly R[];

  parse(input: unknown): ExpressionResult<Name>;
}
