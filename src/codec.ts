import type { FieldRegistry } from "./fields.js";
import type { ExpressionResult, Issue } from "./types.js";
import { validateExpression } from "./validation.js";

export function parseExpression<R, Name extends string>(
  input: unknown,
  registry: FieldRegistry<R, Name>,
): ExpressionResult<Name> {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      const issue: Issue = {
        code: "invalid-json",
        path: [],
        message: "input is not valid JSON",
      };
      return { ok: false, issues: [issue] };
    }
  }
  return validateExpression(value, registry);
}
