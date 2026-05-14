import { describe, expect, it } from "bun:test";
import { normalizeIdentity } from "./identity";

describe("normalizeIdentity", () => {
  it("normalizes Russian phone numbers", () => {
    expect(normalizeIdentity({ provider: "phone", providerUserId: "8 (900) 123-45-67" })).toEqual({
      provider: "phone",
      providerUserId: "+79001234567"
    });
  });

  it("trims telegram identities", () => {
    expect(normalizeIdentity({ provider: "telegram", providerUserId: " 12345 " })).toEqual({
      provider: "telegram",
      providerUserId: "12345"
    });
  });

  it("rejects empty max identities", () => {
    expect(() => normalizeIdentity({ provider: "max", providerUserId: "" })).toThrow(
      "invalid_identity"
    );
  });

  it("normalizes accepted phone formats and rejects invalid phone values", () => {
    expect(normalizeIdentity({ provider: "phone", providerUserId: "79001234567" })).toEqual({
      provider: "phone",
      providerUserId: "+79001234567"
    });
    expect(normalizeIdentity({ provider: "phone", providerUserId: "9001234567" })).toEqual({
      provider: "phone",
      providerUserId: "+79001234567"
    });
    expect(() => normalizeIdentity({ provider: "phone", providerUserId: "123" })).toThrow(
      "invalid_identity"
    );
  });
});
