import { describe, expect, it } from "vitest";
import { isAllowedSignupEmail } from "@/lib/auth-signup-allowlist";

describe("hosted signup allowlist", () => {
  it("allows a listed address regardless of casing or padding", () => {
    expect(
      isAllowedSignupEmail(
        { ALLOWED_EMAILS: " Owner@Example.com , teammate@example.com" },
        "owner@example.com",
      ),
    ).toBe(true);
  });

  it("rejects an address that is not listed", () => {
    expect(
      isAllowedSignupEmail(
        { ALLOWED_EMAILS: "owner@example.com" },
        "stranger@example.com",
      ),
    ).toBe(false);
  });

  it("fails closed when the allowlist is unset", () => {
    // The whole point of the gate: a var that never reached the runtime must
    // block signup, not silently reopen the instance to the internet.
    expect(isAllowedSignupEmail({}, "owner@example.com")).toBe(false);
  });
});
