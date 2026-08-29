import { describe, expect, it } from "vitest";
import { runSelfhostPreflight } from "./selfhost-preflight";

function hostedEnv() {
  return {
    AUTH_MODE: "hosted",
    BETTER_AUTH_URL: "https://seo.example.com",
    BETTER_AUTH_SECRET: "x".repeat(40),
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    BYPASS_EMAIL_VERIFICATION: "true",
    BILLING_DISABLED: "true",
  };
}

function itemFor(
  result: ReturnType<typeof runSelfhostPreflight>,
  name: string,
) {
  return result.items.find((item) => item.name === name);
}

describe("runSelfhostPreflight", () => {
  it("passes the stock Docker setup (local_noauth + DataForSEO key)", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      DATAFORSEO_API_KEY: btoa("user@example.com:secret"),
    });

    expect(result.failed).toBe(false);
    expect(itemFor(result, "AUTH_MODE")?.level).toBe("ok");
    expect(itemFor(result, "DATAFORSEO_API_KEY")?.level).toBe("ok");
  });

  it("fails an invalid AUTH_MODE with the valid list", () => {
    const result = runSelfhostPreflight({ AUTH_MODE: "local-noauth" });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "cloudflare_access, local_noauth, hosted",
    );
  });

  it("fails cloudflare_access mode without TEAM_DOMAIN and POLICY_AUD", () => {
    const result = runSelfhostPreflight({});

    expect(result.failed).toBe(true);
    const item = itemFor(result, "AUTH_MODE");
    expect(item?.message).toContain("TEAM_DOMAIN and POLICY_AUD");
    expect(item?.message).toContain("AUTH_MODE is unset");
  });

  it("fails a bare-hostname TEAM_DOMAIN with the https:// fix", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "cloudflare_access",
      TEAM_DOMAIN: "your-team.cloudflareaccess.com",
      POLICY_AUD: "aud-tag",
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "TEAM_DOMAIN")?.message).toContain("https://");
  });

  it("warns on a DataForSEO key that is not base64 login:password", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      DATAFORSEO_API_KEY: "raw-dashboard-key",
    });

    expect(result.failed).toBe(false);
    expect(itemFor(result, "DATAFORSEO_API_KEY")?.level).toBe("warn");
    expect(itemFor(result, "DATAFORSEO_API_KEY")?.message).toContain("base64");
  });

  it("warns that GSC stays disabled on a short BETTER_AUTH_SECRET", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "too-short",
    });

    expect(itemFor(result, "Search Console")?.level).toBe("warn");
    expect(itemFor(result, "Search Console")?.message).toContain("32");
  });

  it("fails hosted mode listing every missing variable", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "hosted",
      BETTER_AUTH_SECRET: "x".repeat(40),
    });

    expect(result.failed).toBe(true);
    const item = itemFor(result, "AUTH_MODE");
    expect(item?.message).toContain("BETTER_AUTH_URL");
    expect(item?.message).toContain("GOOGLE_CLIENT_ID");
    expect(item?.message).not.toContain("BETTER_AUTH_SECRET,");
  });

  it("fails hosted mode with no way to verify an address", () => {
    // Otherwise boot succeeds and every /api/auth request answers 500.
    const result = runSelfhostPreflight({
      ...hostedEnv(),
      BYPASS_EMAIL_VERIFICATION: undefined,
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain("LOOPS_API_KEY");
  });

  it("warns that hosted mode without ALLOWED_EMAILS lets nobody sign up", () => {
    const result = runSelfhostPreflight(hostedEnv());

    expect(result.failed).toBe(false);
    expect(itemFor(result, "AUTH_MODE")?.level).toBe("warn");
    expect(itemFor(result, "AUTH_MODE")?.message).toContain("ALLOWED_EMAILS");
  });

  it("passes hosted mode that is fully configured", () => {
    const result = runSelfhostPreflight({
      ...hostedEnv(),
      ALLOWED_EMAILS: "owner@example.com",
    });

    expect(result.failed).toBe(false);
    expect(itemFor(result, "AUTH_MODE")?.level).toBe("ok");
  });

  it("fails hosted mode that can neither meter nor say it won't", () => {
    // Without a key every DataForSEO call throws at the credit check, so this
    // is the whole product failing, not just billing.
    const result = runSelfhostPreflight({
      ...hostedEnv(),
      ALLOWED_EMAILS: "owner@example.com",
      BILLING_DISABLED: undefined,
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "AUTUMN_SECRET_KEY",
    );
  });

  it("fails a login-less instance that is served over a hostname", () => {
    // The bug this guard exists for: local_noauth behind a public hostname
    // means every visitor is the admin user, spending the DataForSEO balance.
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      ALLOWED_HOST: "seo.example.com",
    });

    expect(result.failed).toBe(true);
    expect(itemFor(result, "AUTH_MODE")?.message).toContain(
      "ALLOW_PUBLIC_NOAUTH=true",
    );
  });

  it("allows a login-less hostname the operator states is private", () => {
    const result = runSelfhostPreflight({
      AUTH_MODE: "local_noauth",
      ALLOWED_HOST: "seo.internal",
      ALLOW_PUBLIC_NOAUTH: "true",
    });

    expect(result.failed).toBe(false);
    expect(itemFor(result, "AUTH_MODE")?.level).toBe("ok");
  });

  it("mentions ALLOWED_HOST when unset", () => {
    const result = runSelfhostPreflight({ AUTH_MODE: "local_noauth" });

    expect(itemFor(result, "ALLOWED_HOST")?.level).toBe("info");
    expect(itemFor(result, "ALLOWED_HOST")?.message).toContain("reverse proxy");
  });
});
