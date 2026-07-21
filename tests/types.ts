import {
  createFilter,
  type Expression,
  type ExpressionResult,
  type FieldDef,
  type Filter,
  type FilterRow,
  type Issue,
  type Operator,
  type Predicate,
} from "../src/index.js";

interface Customer {
  name: string;
  status?: string;
}

const customerFields = {
  name: (customer: Customer) => customer.name,
  status: {
    get: (customer: Customer) => customer.status,
    normalize: (text: string) => text.trim(),
  },
  structuralMetadataIsAllowed: {
    get: (customer: Customer) => customer.name,
    description: "TypeScript object types are structural",
  },
};

const fieldDefinition: FieldDef<Customer> = customerFields.name;
void fieldDefinition;

const customers = createFilter<Customer>()(customerFields);
const typedFilter: Filter<Customer, keyof typeof customerFields> = customers;
void typedFilter;

const expression: Expression<"name" | "status"> = {
  v: 1,
  any: [
    {
      all: [
        { field: "name", operator: "contains", value: "acme" },
        { field: "status", operator: "empty", not: true },
      ],
    },
  ],
};
void expression;

const oneOf: Predicate<"status"> = {
  field: "status",
  operator: "one-of",
  value: ["open", "pending"],
};
void oneOf;

const operator: Operator = "starts-with";
void operator;

const looseRow: FilterRow = {
  field: "not-necessarily-registered-yet",
  operator: "still-being-edited",
  value: { draft: true },
};
void looseRow;

const result: ExpressionResult<"name"> = { ok: true, expression: null };
void result;

const issue: Issue = {
  code: "unknown-field",
  path: ["any", 0, "all", 0, "field"],
  message: "human-readable only",
};
void issue;

const emptyWithValue: Predicate = {
  field: "status",
  operator: "empty",
  // @ts-expect-error empty predicates carry no value
  value: "",
};
void emptyWithValue;

const oneOfWithScalar: Predicate = {
  field: "status",
  operator: "one-of",
  // @ts-expect-error one-of predicates require an array of strings
  value: "open",
};
void oneOfWithScalar;

const valueOperatorWithoutValue: Predicate = {
  field: "status",
  operator: "equals",
  // @ts-expect-error value operators require a string value
  value: undefined,
};
void valueOperatorWithoutValue;

const falseNegation: Predicate = {
  field: "status",
  operator: "empty",
  // @ts-expect-error negation is represented only by the literal true
  not: false,
};
void falseNegation;

customers.compile({
  v: 1,
  any: [{ all: [{ field: "name", operator: "equals", value: "Ada" }] }],
});

customers.compile({
  v: 1,
  any: [
    {
      all: [
        {
          // @ts-expect-error configured field names remain narrow
          field: "missing",
          operator: "equals",
          value: "Ada",
        },
      ],
    },
  ],
});
