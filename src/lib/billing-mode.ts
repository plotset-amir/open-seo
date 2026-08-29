import { isHostedAuthMode, isHostedClientAuthMode } from "@/lib/auth-mode";

type BillingModeEnv = {
  AUTH_MODE?: string;
  BILLING_DISABLED?: string;
};

/**
 * Whether Autumn metering runs — a separate question from which auth mode is
 * active, though hosted mode has always answered both.
 *
 * Hosted bundles two things a self-hoster may want apart: Better Auth logins,
 * and an Autumn credit ledger in front of every DataForSEO call. A private
 * instance spending its own DATAFORSEO_API_KEY wants the logins and has no use
 * for the ledger — and with no AUTUMN_SECRET_KEY it doesn't just skip billing,
 * it fails every SEO call at the credit check.
 *
 * Opt out explicitly rather than by inferring from a missing AUTUMN_SECRET_KEY:
 * inference means a deploy that drops the secret silently serves unmetered, and
 * that failure should be loud. Only the exact string "true" disables it.
 */
export function isBillingDisabledValue(value: string | null | undefined) {
  return value?.trim() === "true";
}

export function isBillingEnabled(env: BillingModeEnv) {
  return (
    isHostedAuthMode(env.AUTH_MODE) &&
    !isBillingDisabledValue(env.BILLING_DISABLED)
  );
}

export function isBillingEnabledClientMode() {
  return (
    isHostedClientAuthMode() &&
    !isBillingDisabledValue(import.meta.env.BILLING_DISABLED)
  );
}
