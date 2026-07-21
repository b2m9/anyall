# @b2m9/anyall — agent guide

`@b2m9/anyall` evaluates a deliberately closed, serializable filter language:
OR across `any` groups and AND across the predicates in each group's `all`.
Read the public contract in `README.md` and the API JSDoc in `src/` before
changing behavior. This file records the constraints behind that contract.

## Toolchain

ESM-only, Node ≥22, zero runtime dependencies. Use Vite+ (`vp`) through the
pnpm-managed workspace: `vp check` (format/lint/types), `vp test run`, and
`vp pack` (build). Run `vp run check` before handing off; it also validates the
published package and types.
Import test APIs from `vite-plus/test` so the suite uses Vite+'s bundled,
version-locked runner.

## Working method

- Work in one observable slice at a time: write the smallest failing test,
  confirm it fails for the intended reason, then implement only enough to pass.
- Keep tests table-driven where the contract is a semantics matrix. Use
  property tests for laws such as round trips, purity, and reference identity.
- Treat `code` and `path` in issues as stable API. Message wording is not.

## Constraints to preserve

- **The language stays closed.** Six operators plus the orthogonal `not` flag;
  custom behavior belongs in declared field normalizers, never in expressions.
- **DNF stays fixed-depth.** Do not add recursive groups or left-to-right
  reduction; the two-level shape is the protection against grouping ambiguity.
- **Fields are declared capabilities.** Expressions select registry names; the
  package does not parse paths or inspect record structure itself.
- **No-filter is explicit.** `null` matches everything. Empty expressions and
  empty groups are invalid rather than acquiring vacuous truth values.
- **Validation has one source of truth.** `parse`, `compile`, and row conversion
  must not drift into subtly different definitions of a valid predicate.
- **Segment before discarding rows.** An invalid row may be removed in
  interactive mode, but it must never alter the groups around it.
- **Stored data stays data.** Parsing rebuilds fresh canonical plain objects;
  evaluation-time normalization never rewrites saved needles.
- **Preserve reference no-ops.** `filter` returns its input array when every
  record survives, and returns a fresh array only when something is excluded.
- **Remain pure and synchronous.** Inputs are never mutated. Accessor and
  normalizer failures propagate so programmer bugs are not disguised as empty
  fields.

## Comments

Comments explain why an ordering, guard, or no-op is load-bearing. Do not
paraphrase self-evident code. Prefer terse, complete sentences in present tense.
