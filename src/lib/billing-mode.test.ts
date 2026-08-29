import { describe, expect, it } from "vitest";
import { isBillingEnabled } from "@/lib/billing-mode";

describe("billing mode", () => {
  it("meters hosted deployments by default", () => {
    expect(isBillingEnabled({ AUTH_MODE: "hosted" })).toBe(true);
  });

  it("lets a hosted instance opt out of metering", () => {
    expect(
      isBillingEnabled({ AUTH_MODE: "hosted", BILLING_DISABLED: "true" }),
    ).toBe(false);
  });

  it("keeps metering on for any value that is not exactly true", () => {
    // A typo or a leftover "false" must not silently stop billing the SaaS.
    expect(
      isBillingEnabled({ AUTH_MODE: "hosted", BILLING_DISABLED: "false" }),
    ).toBe(true);
    expect(
      isBillingEnabled({ AUTH_MODE: "hosted", BILLING_DISABLED: "1" }),
    ).toBe(true);
  });

  it("never meters outside hosted mode", () => {
    expect(isBillingEnabled({ AUTH_MODE: "local_noauth" })).toBe(false);
  });
});
