import { parseExpression } from "./codec.js";
import { compileExpression, filterRecords } from "./evaluate.js";
import { createFieldRegistry } from "./fields.js";
import type { FieldRegistry } from "./fields.js";
import { expressionFromRows } from "./rows.js";
import type { FieldDef, Filter } from "./types.js";

/**
 * Bind an explicit record type first so the field map can still infer its
 * literal names; TypeScript cannot partially infer one generic call.
 */
export function createFilter<R>(): <F extends Record<string, FieldDef<R>>>(
  fields: F,
) => Filter<R, keyof F & string> {
  return <F extends Record<string, FieldDef<R>>>(fields: F): Filter<R, keyof F & string> => {
    const registry = createFieldRegistry<R, keyof F & string>(fields);
    return createBoundFilter(registry);
  };
}

function createBoundFilter<R, Name extends string>(
  registry: FieldRegistry<R, Name>,
): Filter<R, Name> {
  return {
    fromRows: (rows, options) => expressionFromRows(rows, registry, options?.incomplete),
    compile: (expression) => compileExpression(expression, registry),
    filter: (records, expression) =>
      filterRecords(records, compileExpression(expression, registry)),
    parse: (input) => parseExpression(input, registry),
  };
}
