import { describe, expect, test } from "vite-plus/test";
import { createFilter, type FilterRow } from "../src/index.js";

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

const places = createFilter<{ city: string }>()({
  city: {
    get: (place) => place.city,
    normalize: (text) => text.trim().toLowerCase().normalize("NFD").replaceAll(/\p{M}/gu, ""),
  },
});

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

const records: Customer[] = [
  { account: { name: "Acme North" }, status: "open", name: "Alice", plan: "basic" },
  { account: { name: "Other" }, status: "closed", name: "Test Labs", plan: "pro" },
  { account: { name: "Other" }, status: "closed", name: "Test Garage", plan: "free" },
];

describe("README examples", () => {
  test("applies a custom normalizer to both record text and the compiled needle", () => {
    const inAarhus = places.compile({
      v: 1,
      any: [{ all: [{ field: "city", operator: "equals", value: "Arhus" }] }],
    });

    expect(inAarhus({ city: "Århus" })).toBe(true);
  });

  test("groups the four-row bug as any-of-all instead of left to right", () => {
    const built = customers.fromRows(rows);
    if (!built.ok) {
      expect.unreachable("the documented rows should form a valid expression");
    }

    expect(built.expression).toEqual({
      v: 1,
      any: [
        {
          all: [
            { field: "account", operator: "contains", value: "acme" },
            {
              field: "status",
              operator: "one-of",
              value: ["closed", "spam"],
              not: true,
            },
          ],
        },
        {
          all: [
            { field: "name", operator: "starts-with", value: "test" },
            { field: "plan", operator: "equals", value: "pro" },
          ],
        },
      ],
    });
    expect(customers.filter(records, built.expression)).toEqual([records[0], records[1]]);
  });

  test("restores saved expressions and distinguishes a missing key from saved null", () => {
    const built = customers.fromRows(rows);
    if (!built.ok) {
      expect.unreachable("the documented rows should form a valid expression");
    }

    const saved = JSON.stringify(built.expression);
    expect(customers.parse(saved)).toEqual(built);

    const customersWithoutPlan = createFilter<Customer>()({
      account: (customer) => customer.account?.name,
      status: (customer) => customer.status,
      name: (customer) => customer.name,
    });
    expect(customersWithoutPlan.parse(saved)).toMatchObject({
      ok: false,
      issues: [
        {
          code: "unknown-field",
          path: ["any", 1, "all", 1, "field"],
        },
      ],
    });

    const missingStorageKey: string | null = null;
    const savedNoFilter = JSON.stringify(null);
    expect(missingStorageKey).toBeNull();
    expect(savedNoFilter).toBe("null");
    expect(customers.parse(savedNoFilter)).toEqual({ ok: true, expression: null });
  });

  test("preserves the input reference exactly when filtering excludes nothing", () => {
    const noFilter = customers.filter(records, null);
    const allMatch = customers.filter(records, {
      v: 1,
      any: [{ all: [{ field: "name", operator: "contains", value: "e" }] }],
    });

    expect(noFilter).toBe(records);
    expect(allMatch).toBe(records);

    const nobodyIsEmpty = customers.filter(records, {
      v: 1,
      any: [{ all: [{ field: "name", operator: "empty" }] }],
    });
    expect(nobodyIsEmpty).toEqual([]);
    expect(nobodyIsEmpty).not.toBe(records);
  });
});
