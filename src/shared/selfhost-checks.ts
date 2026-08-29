// Pure validators for self-host configuration values. Shared by the runtime
// (auth middleware, /api/health, telemetry) and the Docker preflight script,
// so every surface applies the exact same rules and wording.

export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

type TeamDomainResult =
  | { ok: true; origin: string }
  | { ok: false; message: string };

export function validateTeamDomain(value: string): TeamDomainResult {
  const normalized = value.trim().replace(/\/+$/, "");

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "https:") {
      throw new Error("TEAM_DOMAIN must use https");
    }

    return { ok: true, origin: parsed.origin };
  } catch {
    return {
      ok: false,
      message:
        "TEAM_DOMAIN must be a full https URL like https://your-team.cloudflareaccess.com" +
        (normalized && !normalized.includes("://")
          ? ` — add the https:// prefix to "${normalized}"`
          : ""),
    };
  }
}

// DATAFORSEO_API_KEY is NOT the key shown in the DataForSEO dashboard — it is
// base64("login:password"). Decoding it and finding a colon is a cheap sanity
// check that catches the most common paste mistake without a paid API call.
export function looksLikeDataForSeoKey(value: string): boolean {
  try {
    return atob(value.trim()).includes(":");
  } catch {
    return false;
  }
}

// OPENSEO_TELEMETRY_DISABLED / DO_NOT_TRACK semantics: any value except an
// explicit "off" string disables telemetry (fail toward privacy), but
// "0"/"false"/"no"/"off" mean what the operator wrote — telemetry stays on.
export function isTelemetryOptOutValue(
  value: string | undefined | null,
): boolean {
  if (!value) return false;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

// Hosted mode sends verification and password-reset mail through Loops, so all
// three ids are required — unless the operator opts out of verification with
// BYPASS_EMAIL_VERIFICATION=true (fine on an invite-only instance where
// ALLOWED_EMAILS already decides who may register). Without one of the two,
// hasHostedAuthConfig() refuses to serve /api/auth at all, so the preflight and
// the runtime must apply the same rule or a self-hoster passes boot and then
// gets a 500 on the first sign-in.
export const HOSTED_EMAIL_ENV_VARS = [
  "LOOPS_API_KEY",
  "LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID",
  "LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID",
] as const;

type HostedEmailEnv = {
  BYPASS_EMAIL_VERIFICATION?: string;
  LOOPS_API_KEY?: string;
  LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID?: string;
  LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID?: string;
};

export function hasHostedEmailConfig(env: HostedEmailEnv): boolean {
  if (env.BYPASS_EMAIL_VERIFICATION?.trim() === "true") {
    return true;
  }

  return HOSTED_EMAIL_ENV_VARS.every((name) => env[name]?.trim());
}
