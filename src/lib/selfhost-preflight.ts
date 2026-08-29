import { AUTH_MODES } from "@/lib/auth-mode";
import { hasHostedTurnstileConfig } from "@/lib/auth-turnstile";
import { isBillingDisabledValue } from "@/lib/billing-mode";
import {
  hasHostedEmailConfig,
  HOSTED_EMAIL_ENV_VARS,
  looksLikeDataForSeoKey,
  MIN_BETTER_AUTH_SECRET_LENGTH,
  validateTeamDomain,
} from "@/shared/selfhost-checks";

// Startup preflight for self-host containers: validate the environment BEFORE
// the multi-minute build/boot so misconfiguration fails in seconds with the
// exact fix, instead of surfacing minutes later as a generic in-app error.
// "fail" aborts startup; "warn" degrades a feature; "info" is orientation.

type PreflightLevel = "ok" | "info" | "warn" | "fail";

type PreflightItem = {
  // Stable identifier shared with /api/health's check map.
  key: "auth" | "dataforseo" | "gsc" | "ai" | "runtime";
  name: string;
  level: PreflightLevel;
  message: string;
};

type PreflightResult = {
  items: PreflightItem[];
  failed: boolean;
};

type EnvRecord = Record<string, string | undefined>;

function get(env: EnvRecord, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function checkAuthMode(env: EnvRecord, items: PreflightItem[]): void {
  const rawMode = get(env, "AUTH_MODE");

  if (rawMode && !(AUTH_MODES as readonly string[]).includes(rawMode)) {
    items.push({
      key: "auth",
      name: "AUTH_MODE",
      level: "fail",
      message: `"${rawMode}" is not a valid AUTH_MODE. Valid values: ${AUTH_MODES.join(", ")}.`,
    });
    return;
  }

  const mode = rawMode ?? "cloudflare_access";

  if (mode === "local_noauth") {
    // local_noauth has no login at all: every request resolves to the same
    // admin user, so anyone who can reach the URL owns the projects and spends
    // the instance-wide DATAFORSEO_API_KEY balance. The container only binds
    // 127.0.0.1, so reaching it from elsewhere means a reverse proxy or tunnel
    // — which needs ALLOWED_HOST, making that var the one honest signal that
    // this instance is no longer localhost-only. A private proxy is a fair
    // setup, so it stays possible; it just has to be stated.
    if (
      get(env, "ALLOWED_HOST") &&
      get(env, "ALLOW_PUBLIC_NOAUTH") !== "true"
    ) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "fail",
        message:
          "local_noauth has no login — with ALLOWED_HOST set, this instance is served over a hostname, so anyone who finds it becomes the admin user and spends your DataForSEO balance. Set AUTH_MODE=hosted (with ALLOWED_EMAILS) or AUTH_MODE=cloudflare_access, or set ALLOW_PUBLIC_NOAUTH=true if that hostname is only reachable from a private network.",
      });
      return;
    }

    items.push({
      key: "auth",
      name: "AUTH_MODE",
      level: "ok",
      message:
        "local_noauth — no auth, single admin user. Do not expose publicly without your own auth in front.",
    });
    return;
  }

  if (mode === "hosted") {
    const missing = [
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ].filter((name) => !get(env, name));

    if (missing.length) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "fail",
        message: `hosted mode requires ${missing.join(", ")}.`,
      });
      return;
    }

    // The next two mirror hasHostedAuthConfig(): fail them here, at boot, with
    // the fix — otherwise the app starts fine and every /api/auth request
    // answers 500 "Missing Better Auth hosted configuration".
    if (!hasHostedEmailConfig(env)) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "fail",
        message: `hosted mode sends verification and password-reset email through Loops: set ${HOSTED_EMAIL_ENV_VARS.join(", ")} — or BYPASS_EMAIL_VERIFICATION=true to skip email verification entirely on an invite-only instance.`,
      });
      return;
    }

    if (!hasHostedTurnstileConfig(env)) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "fail",
        message:
          "TURNSTILE_SITE_KEY is set without TURNSTILE_SECRET_KEY — the signup captcha would render but never be verified. Set the secret, or unset the site key to drop the captcha.",
      });
      return;
    }

    // Hosted also turns on Autumn metering: every DataForSEO call checks the
    // org's credit balance first, and that read throws without a key — so the
    // whole product fails at the credit check, not just billing. Make the
    // operator choose, rather than inferring "no key" as "don't meter": on the
    // SaaS a dropped secret must be loud, not a free unmetered instance.
    if (
      !get(env, "AUTUMN_SECRET_KEY") &&
      !isBillingDisabledValue(get(env, "BILLING_DISABLED"))
    ) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "fail",
        message:
          "hosted mode meters every DataForSEO call against Autumn credits: set AUTUMN_SECRET_KEY, or BILLING_DISABLED=true to run hosted logins with no credit ledger (a private instance spending its own DataForSEO balance).",
      });
      return;
    }

    // Fail-closed by design (auth-allowlist.ts), but silently: signup
    // just rejects everyone. Say so at boot instead of at the first attempt.
    if (!get(env, "ALLOWED_EMAILS")) {
      items.push({
        key: "auth",
        name: "AUTH_MODE",
        level: "warn",
        message:
          "hosted, but ALLOWED_EMAILS is unset — nobody can create an account. List the addresses allowed to sign up. Existing accounts still work.",
      });
      return;
    }

    items.push({
      key: "auth",
      name: "AUTH_MODE",
      level: "ok",
      message: "hosted",
    });
    return;
  }

  // cloudflare_access (explicit or defaulted)
  const teamDomain = get(env, "TEAM_DOMAIN");
  const policyAud = get(env, "POLICY_AUD");
  const modeLabel = rawMode
    ? "cloudflare_access"
    : "cloudflare_access (default — AUTH_MODE is unset)";

  if (!teamDomain || !policyAud) {
    const missing = [
      teamDomain ? null : "TEAM_DOMAIN",
      policyAud ? null : "POLICY_AUD",
    ]
      .filter(Boolean)
      .join(" and ");
    items.push({
      key: "auth",
      name: "AUTH_MODE",
      level: "fail",
      message: `${modeLabel} requires ${missing}. See docs/SELF_HOSTING_CLOUDFLARE.md — or set AUTH_MODE=local_noauth for a private, no-auth deployment.`,
    });
    return;
  }

  const teamDomainResult = validateTeamDomain(teamDomain);
  if (!teamDomainResult.ok) {
    items.push({
      key: "auth",
      name: "TEAM_DOMAIN",
      level: "fail",
      message: teamDomainResult.message,
    });
    return;
  }

  items.push({
    key: "auth",
    name: "AUTH_MODE",
    level: "ok",
    message: modeLabel,
  });
}

function checkDataForSeo(env: EnvRecord, items: PreflightItem[]): void {
  const key = get(env, "DATAFORSEO_API_KEY");

  if (!key) {
    items.push({
      key: "dataforseo",
      name: "DATAFORSEO_API_KEY",
      level: "warn",
      message:
        "Not set — all SEO data features will be unavailable until it is. It is the base64 of your DataForSEO login:password (NOT the dashboard API key). See docs/DATAFORSEO_API_KEY.md.",
    });
    return;
  }

  if (!looksLikeDataForSeoKey(key)) {
    items.push({
      key: "dataforseo",
      name: "DATAFORSEO_API_KEY",
      level: "warn",
      message:
        "Set, but does not decode as base64 of login:password. If DataForSEO rejects it, encode your account email and API password: printf 'email:password' | base64.",
    });
    return;
  }

  items.push({
    key: "dataforseo",
    name: "DATAFORSEO_API_KEY",
    level: "ok",
    message: "Set",
  });
}

function checkOptionalFeatures(env: EnvRecord, items: PreflightItem[]): void {
  const clientId = get(env, "GOOGLE_CLIENT_ID");
  const clientSecret = get(env, "GOOGLE_CLIENT_SECRET");
  const betterAuthSecret = get(env, "BETTER_AUTH_SECRET");

  if (clientId || clientSecret) {
    if (!clientId || !clientSecret) {
      items.push({
        key: "gsc",
        name: "Search Console",
        level: "warn",
        message:
          "Only one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set — both are required.",
      });
    } else if (
      !betterAuthSecret ||
      betterAuthSecret.length < MIN_BETTER_AUTH_SECRET_LENGTH
    ) {
      items.push({
        key: "gsc",
        name: "Search Console",
        level: "warn",
        message: `Google credentials are set, but Search Console stays DISABLED until BETTER_AUTH_SECRET is at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters (it encrypts stored OAuth tokens).`,
      });
    } else {
      items.push({
        key: "gsc",
        name: "Search Console",
        level: "ok",
        message: "Configured",
      });
    }
  } else {
    items.push({
      key: "gsc",
      name: "Search Console",
      level: "info",
      message:
        "Not configured (optional). See docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md.",
    });
  }

  items.push(
    get(env, "OPENROUTER_API_KEY")
      ? {
          key: "ai",
          name: "AI features",
          level: "ok",
          message: "OPENROUTER_API_KEY set",
        }
      : {
          key: "ai",
          name: "AI features",
          level: "info",
          message:
            "OPENROUTER_API_KEY not set (optional) — SAM, the in-app SEO agent, is disabled.",
        },
  );
}

// Shared per-feature checks: the Docker preflight prints these at boot and
// /api/health (setup-status.ts) serves the same results at runtime, so the
// two can never drift.
export function runSelfhostChecks(env: EnvRecord): PreflightItem[] {
  const items: PreflightItem[] = [];
  checkAuthMode(env, items);
  checkDataForSeo(env, items);
  checkOptionalFeatures(env, items);
  return items;
}

export function runSelfhostPreflight(env: EnvRecord): PreflightResult {
  const items = runSelfhostChecks(env);

  items.push(
    get(env, "ALLOWED_HOST")
      ? {
          key: "runtime",
          name: "ALLOWED_HOST",
          level: "ok",
          message: `Requests allowed for host ${get(env, "ALLOWED_HOST")}`,
        }
      : {
          key: "runtime",
          name: "ALLOWED_HOST",
          level: "info",
          message:
            'Not set — only localhost access will work. Behind a reverse proxy or tunnel, set ALLOWED_HOST=yourdomain.com or requests are blocked with Vite\'s "Blocked request" page.',
        },
  );

  items.push({
    key: "runtime",
    name: "Scheduled checks",
    level: "info",
    message:
      "Rank-tracking schedules do not run in Docker mode — trigger checks from the Rank Tracking page.",
  });

  return { items, failed: items.some((item) => item.level === "fail") };
}

const LEVEL_BADGES: Record<PreflightLevel, string> = {
  ok: "[ ok ]",
  info: "[info]",
  warn: "[warn]",
  fail: "[FAIL]",
};

export function formatPreflightReport(result: PreflightResult): string {
  const lines = result.items.map(
    (item) => `${LEVEL_BADGES[item.level]} ${item.name}: ${item.message}`,
  );

  lines.push(
    result.failed
      ? "\nPreflight failed — fix the [FAIL] items above and restart. Nothing was started."
      : "\nPreflight passed. The app now builds inside the container (~1-2 minutes on first start before it serves).",
  );

  return lines.join("\n");
}
