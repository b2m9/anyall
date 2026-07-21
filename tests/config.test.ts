import { describe, expect, test } from "vite-plus/test";
import { AnyallConfigError, createFilter } from "../src/index.js";

interface Customer {
  name: string;
}

const configure = createFilter<Customer>();

describe("field configuration", () => {
  test("accepts accessor and accessor-with-normalizer definitions", () => {
    const filter = configure({
      name: (customer) => customer.name,
      exactName: {
        get: (customer) => customer.name,
        normalize: (text) => text,
      },
    });

    expect(filter).toEqual({
      fromRows: expect.any(Function),
      compile: expect.any(Function),
      filter: expect.any(Function),
      parse: expect.any(Function),
    });
  });

  test("rejects a registry with no addressable fields", () => {
    expect(() => configure({})).toThrow(AnyallConfigError);
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a scalar", "name"],
  ])("rejects %s as the registry", (_case, fields) => {
    expect(() => configure(fields as never)).toThrow(AnyallConfigError);
  });

  test.each([
    ["null", null],
    ["a scalar", "name"],
    ["an array", []],
    ["an object without get", {}],
    ["a non-function get", { get: "name" }],
    ["a non-function normalizer", { get: (customer: Customer) => customer.name, normalize: true }],
    [
      "a misspelled normalizer",
      { get: (customer: Customer) => customer.name, normalise: (text: string) => text },
    ],
    ["extra metadata", { get: (customer: Customer) => customer.name, description: "Name" }],
  ])("rejects %s as a field definition", (_case, definition) => {
    expect(() => configure({ name: definition } as never)).toThrow(AnyallConfigError);
  });

  test("identifies configuration failures without matching message text", () => {
    try {
      configure({ name: { get: () => "", normalize: 1 } } as never);
      expect.unreachable("expected malformed configuration to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AnyallConfigError);
      expect(error).toMatchObject({ name: "AnyallConfigError" });
    }
  });

  test("snapshots accessor properties before validation and registration", () => {
    let getReads = 0;
    let normalizeReads = 0;
    const definition = {
      get get() {
        getReads += 1;
        return getReads === 1 ? (customer: Customer) => customer.name : undefined;
      },
      get normalize() {
        normalizeReads += 1;
        return normalizeReads === 1 ? (text: string) => text.trim().toLowerCase() : undefined;
      },
    };

    const matches = configure({ name: definition } as never).compile({
      v: 1,
      any: [{ all: [{ field: "name", operator: "equals", value: "ada" }] }],
    });

    expect(matches({ name: " Ada " })).toBe(true);
    expect(getReads).toBe(1);
    expect(normalizeReads).toBe(1);
  });

  test("rejects non-string normalizer results when they are observed", () => {
    const invalidNeedle = configure({
      name: {
        get: (customer) => customer.name,
        normalize: (() => undefined) as never,
      },
    });
    const expression = {
      v: 1 as const,
      any: [{ all: [{ field: "name" as const, operator: "equals" as const, value: "needle" }] }],
    };

    expect(() => invalidNeedle.compile(expression)).toThrow(AnyallConfigError);

    const invalidRecord = configure({
      name: {
        get: (customer) => customer.name,
        normalize: ((text: string) => (text === "needle" ? text : undefined)) as never,
      },
    }).compile(expression);

    expect(() => invalidRecord({ name: "record" })).toThrow(AnyallConfigError);
  });
});
