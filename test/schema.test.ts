import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { SchemaDispatchError, validate } from "../src/schema";
import { canonicalPayload } from "./fixtures";

describe("validate (dispatch + zod boundary cases)", () => {
  it("accepts the canonical schema-1 payload", () => {
    expect(() => validate(canonicalPayload)).not.toThrow();
  });

  it("requires schema and instance_id", () => {
    expect(() => validate({})).toThrow(SchemaDispatchError);
    expect(() => validate({ schema: 1 })).toThrow(ZodError);
  });

  it("rejects schema: 0 with SchemaDispatchError (no zod parse)", () => {
    expect(() => validate({ schema: 0, instance_id: "abc" })).toThrow(SchemaDispatchError);
  });

  it("rejects schema: 2 with SchemaDispatchError today (dispatch path is exercised)", () => {
    expect(() => validate({ schema: 2, instance_id: "abc" })).toThrow(SchemaDispatchError);
  });

  it("rejects missing schema as SchemaDispatchError", () => {
    expect(() => validate({ instance_id: "abc" })).toThrow(SchemaDispatchError);
  });

  it("rejects non-numeric schema as SchemaDispatchError", () => {
    expect(() => validate({ schema: "1", instance_id: "abc" })).toThrow(SchemaDispatchError);
    expect(() => validate({ schema: null, instance_id: "abc" })).toThrow(SchemaDispatchError);
    expect(() => validate({ schema: NaN, instance_id: "abc" })).toThrow(SchemaDispatchError);
  });

  it("rejects non-object body as SchemaDispatchError", () => {
    expect(() => validate(null)).toThrow(SchemaDispatchError);
    expect(() => validate("hello")).toThrow(SchemaDispatchError);
    expect(() => validate(42)).toThrow(SchemaDispatchError);
  });

  it("preserves unknown top-level keys via passthrough", () => {
    const result = validate({
      schema: 1,
      instance_id: "abc",
      future_thing: "hello",
    }) as Record<string, unknown>;
    expect(result["future_thing"]).toBe("hello");
  });

  it("treats every non-required field as optional", () => {
    expect(() => validate({ schema: 1, instance_id: "abc" })).not.toThrow();
    expect(() =>
      validate({
        schema: 1,
        instance_id: "abc",
        panel: { version: "2.0.0" },
      }),
    ).not.toThrow();
  });

  it("rejects empty instance_id", () => {
    expect(() => validate({ schema: 1, instance_id: "" })).toThrow(ZodError);
  });

  it("accepts the nested scale.games / scale.perms objects and rejects wrong-typed leaves", () => {
    expect(() =>
      validate({
        schema: 1,
        instance_id: "abc",
        scale: { games: { tf: true }, perms: { immunity: false } },
      }),
    ).not.toThrow();
    expect(() =>
      validate({ schema: 1, instance_id: "abc", scale: { games: { tf: "yes" } } }),
    ).toThrow(ZodError);
    expect(() => validate({ schema: 1, instance_id: "abc", scale: { bans_30d: "311" } })).toThrow(
      ZodError,
    );
  });

  it("rejects wrong-typed required scalar fields", () => {
    expect(() => validate({ schema: 1, instance_id: 42 })).toThrow(ZodError);
  });
});
