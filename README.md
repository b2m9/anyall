# @b2m9/anyall

Four filter rows can hide a boolean bug:

```text
A  account contains "acme"
AND B  status is not one of ["closed", "spam"]
OR  C  name starts with "test"
AND D  plan equals "pro"
```

A left-to-right reducer computes `(((A AND B) OR C) AND D)`. It wrongly rejects
an open Acme customer on the basic plan. The rows mean `(A AND B) OR (C AND D)`:

| Record                    | Left to right | `anyall` |
| ------------------------- | ------------- | -------- |
| Acme North, open, basic   | no            | **yes**  |
| Test Labs, closed, pro    | yes           | **yes**  |
| Test Garage, closed, free | no            | no       |

`anyall` evaluates serializable text filters in that fixed shape: any group may
match, and all predicates in a matching group must match. It is headless,
ESM-only, has zero runtime dependencies, and does not inspect record structure
beyond the accessors you declare.

## Install

```sh
npm install @b2m9/anyall
```

Node.js 22 or newer is required.

## Usage

Declare the fields an expression is allowed to address:

```ts
import { createFilter, type FilterRow } from "@b2m9/anyall";

interface Customer {
  account?: { name: string };
  status?: string;
  name: string;
  plan: "free" | "basic" | "pro";
}

const customers = createFilter<Customer>()({
  account: (customer) => customer.account?.name,
  status: (customer) => customer.status,
  name: (customer) => customer.name,
  plan: (customer) => customer.plan,
});
```

The double call is deliberate. TypeScript cannot partially infer type
arguments: the first call fixes `Customer`, while the second infers the literal
field names from the registry.

Accessors make record projection visible and type-checked. A field can also
define the text equivalence its domain needs; normalization always applies to
both record text and the compiled needle:

```ts
const places = createFilter<{ city: string }>()({
  city: {
    get: (place) => place.city,
    normalize: (text) => text.trim().toLowerCase().normalize("NFD").replaceAll(/\p{M}/gu, ""),
  },
});

const inAarhus = places.compile({
  v: 1,
  any: [{ all: [{ field: "city", operator: "equals", value: "Arhus" }] }],
});

inAarhus({ city: "Århus" }); // true
```

Now fold the flat rows from a filter UI into an expression:

```ts
const rows = [
  { field: "account", operator: "contains", value: "acme" },
  {
    join: "and",
    field: "status",
    operator: "one-of",
    value: ["closed", "spam"],
    not: true,
  },
  { join: "or", field: "name", operator: "starts-with", value: "test" },
  { join: "and", field: "plan", operator: "equals", value: "pro" },
] satisfies readonly FilterRow[];

const built = customers.fromRows(rows);
if (!built.ok) throw new Error("The filter UI produced incomplete rows");

const records: Customer[] = [
  { account: { name: "Acme North" }, status: "open", name: "Alice", plan: "basic" },
  { account: { name: "Other" }, status: "closed", name: "Test Labs", plan: "pro" },
  { account: { name: "Other" }, status: "closed", name: "Test Garage", plan: "free" },
];

const matches = customers.filter(records, built.expression);
// [records[0], records[1]]
```

The expression is versioned plain data:

```text
{
  v: 1,
  any: [
    { all: [A, B] },
    { all: [C, D] },
  ],
}
```

Evaluation is exactly `any.some(group => group.all.every(predicate))`.
There is no recursive tree and no ambiguous reduction order.

## Saved views

Expressions need no serializer. Store them with `JSON.stringify`, then bring
them back through `parse` so renamed fields or newer wire versions become
structured issues instead of runtime surprises:

```ts
localStorage.setItem("view:customers", JSON.stringify(built.expression));

const raw = localStorage.getItem("view:customers");
if (raw === null) {
  renderDefaultView(); // This key has never been saved.
} else {
  const restored = customers.parse(raw);
  if (!restored.ok) {
    // For example, a removed `plan` field is reported at
    // ["any", 1, "all", 1, "field"] with code "unknown-field".
    showStaleView(restored.issues);
  } else {
    render(customers.filter(records, restored.expression));
  }
}
```

A missing storage key and a stored no-filter state are different. Store the
latter as `JSON.stringify(null)`, which yields the JSON text `"null"`;
`customers.parse("null")` succeeds with `expression: null`.

`parse` accepts JSON text or an already-parsed inert value. On success it
returns fresh canonical plain objects while preserving needle text. Invalid
JSON and ordinary invalid data become issues, provided the declared normalizers
honor their pure-and-total contract; reflective exotica are outside that
guarantee.

## API

```text
const filter = createFilter<RecordType>()({
  fieldName: (record) => record.value,
  normalizedField: {
    get: (record) => record.otherValue,
    normalize: (text) => text.trim().toLowerCase(),
  },
});

filter.fromRows(rows, { incomplete: "reject" });
filter.compile(expression); // (record) => boolean
filter.filter(records, expression); // readonly RecordType[]
filter.parse(jsonOrValue);
```

`fromRows` and `parse` return one result shape:

```ts
type ExpressionResult<Name extends string> =
  | { ok: true; expression: Expression<Name> | null }
  | { ok: false; issues: readonly Issue[] };
```

`null` is the explicit no-filter value. `compile(null)` returns a predicate
that always passes, and `filter(records, null)` returns `records` itself.

Malformed configuration throws `AnyallConfigError`. Passing an asserted but
invalid expression to `compile` or `filter` throws `AnyallExpressionError` with
an `issues` property. Both classes are exported for `instanceof` checks.
Issue `code` and `path` are stable API; message wording is not.

All public types are exported: `Expression`, `ExpressionResult`, `FieldDef`,
`Filter`, `FilterRow`, `Issue`, `Operator`, and `Predicate`.

## Operators and empty values

Values resolve to a list of matchable texts before an operator runs:

| Accessor result                  | Matchable texts                         |
| -------------------------------- | --------------------------------------- |
| string                           | normalized string, unless it is empty   |
| number, boolean, bigint          | `String(value)`, then normalized        |
| `null`, `undefined`              | none                                    |
| array                            | scalar rules for each top-level element |
| object, `Date`, function, symbol | none                                    |
| nested array element             | none                                    |

The default normalizer trims and lowercases. A field is empty when resolution
yields no matchable text, including `""`, whitespace, `[]`, and `["", null]`.

| Operator      | Base result                                  | Empty field |
| ------------- | -------------------------------------------- | ----------- |
| `equals`      | some text equals the needle                  | false       |
| `contains`    | some text contains the needle                | false       |
| `starts-with` | some text starts with the needle             | false       |
| `ends-with`   | some text ends with the needle               | false       |
| `one-of`      | some text equals a member of the needle list | false       |
| `empty`       | there are no matchable texts                 | true        |

`not: true` negates the base result. Consequently, a negated value operator is
true on an empty field, while `{ operator: "empty", not: true }` means the
field has at least one matchable text. Empty needles are invalid.

Normalization never rewrites stored expressions. `parse` and `fromRows` invoke
it only to reject empty needles, `compile` captures normalized needles, and the
compiled predicate normalizes record texts. Arrays use some-semantics and are
resolved only one level deep.

## Rows and grouping

`fromRows` segments the complete row sequence at each `join: "or"`, then
validates rows within those groups. This order is load-bearing: discarding an
invalid row must not pull later predicates into an earlier group.

Incomplete rows reject the whole conversion by default. For a live filter
drawer, `{ incomplete: "discard" }` removes invalid rows after grouping, drops
groups left empty, and returns `expression: null` if nothing survives. Row
values stay strict: scalar operators require a string, and `one-of` requires a
string array. Record values are the only values coerced to text.

Expressions require at least one group and every group requires at least one
predicate; empty containers are rejected rather than given vacuous meanings.

## Guardrails

- Field names and their meaning are a saved-view contract. When renaming a
  field, keep the old name as an alias; changing an accessor or normalizer can
  silently change what existing views match.
- Accessors and normalizers must be pure and total. Their errors propagate so
  programmer bugs are not disguised as empty fields.
- V1 is text-only. There are no numeric or date comparisons, and numbers are
  matched as strings: `contains "4"` matches `42`.
- Lowercasing is deterministic, not locale-aware collation. Supply a custom
  normalizer when your domain needs another text equivalence.
- Objects never coerce to `"[object Object]"`. Project a label or identifier in
  the accessor.
- Expressions cannot introduce code or access undeclared fields, but that
  bounds capability, not work. Cap bytes, groups, predicates, tokens, and
  needle lengths before parsing untrusted input.
- `filter` preserves order and returns its input array by reference exactly
  when no record is excluded; otherwise it returns a fresh array.

Expressions carry `v: 1`. A grammar change increments the wire version even
when package semver would not otherwise require a major release. A future
reader must either continue accepting every older grammar it supersets or ship
an explicit migration.

The expression language deliberately has no regex, arbitrary nesting,
user-defined operators, or field-path grammar. Regex becomes a ReDoS surface
when expressions are untrusted data. An expression that names executable
behavior stops being portable and trustable. Recursive boolean trees are the
problem JSON Logic already solves, while declared accessors avoid a path
grammar and its prototype-safety policy entirely.

The package also provides no rendering, table integration, URL state, sorting,
pagination, server adapter, query-language compilation, fuzzy search, numeric
comparison, or date comparison.

## License

MIT © 2026 Bob Massarczyk
