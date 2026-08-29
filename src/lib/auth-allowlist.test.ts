import { describe, expect, it } from "vitest";
import { isAllowedHostedEmail } from "@/lib/auth-allowlist";

describe("hosted access allowlist", () => {
  it("allows a listed address regardless of casing or padding", () => {
    expect(
      isAllowedHostedEmail(
        { ALLOWED_EMAILS: " Owner@Example.com , teammate@example.com" },
        "owner@example.com",
      ),
    ).toBe(true);
  });

  it("rejects an address that is not listed", () => {
    expect(
      isAllowedHostedEmail(
        { ALLOWED_EMAILS: "owner@example.com" },
        "stranger@example.com",
      ),
    ).toBe(false);
  });

  it("fails closed when the allowlist is unset", () => {
    // The whole point of the gate: a var that never reached the runtime must
    // lock the instance down, not silently reopen it to the internet.
    expect(isAllowedHostedEmail({}, "owner@example.com")).toBe(false);
  });
});
