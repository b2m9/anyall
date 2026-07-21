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
};

const fieldDefinition: FieldDef<Customer> = customerFields.name;
void fieldDefinition;

const fieldWithUnknownKey: FieldDef<Customer> = {
  get: (customer) => customer.name,
  // @ts-expect-error field-definition metadata belongs outside the filter registry
  description: "Name",
};
void fieldWithUnknownKey;

const customers = createFilter<Customer>()(customerFields);
const typedFilter: Filter<Customer, keyof typeof customerFields> = customers;
void typedFilter;

const numberedFields = createFilter<Customer>()({ 0: (customer) => customer.name });
const numberedFilter: Filter<Customer, "0"> = numberedFields;
void numberedFilter;
numberedFields.compile({
  v: 1,
  any: [{ all: [{ field: "0", operator: "equals", value: "Ada" }] }],
});
numberedFields.compile({
  v: 1,
  any: [
    {
      all: [
        {
          // @ts-expect-error numeric field keys become their runtime string form
          field: "1",
          operator: "equals",
          value: "Ada",
        },
      ],
    },
  ],
});

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
