type AllowlistEnv = {
  ALLOWED_EMAILS?: string;
};

/**
 * Who may use a hosted-mode deployment.
 *
 * Hosted is the public-SaaS mode — email/password signup is open and Google
 * social login is on — so a self-hosted deployment running it accepts anyone
 * who finds the URL, and DATAFORSEO_API_KEY is one instance-wide key, so every
 * stranger spends the operator's balance. Fail closed: an unset var (or one
 * that never reached the runtime) allows nobody rather than everybody.
 *
 * Checked on account creation, on session creation, and on every authenticated
 * request — an address removed from the list, or an account that predates the
 * list, must lose access, not merely be unable to register again.
 */
export function isAllowedHostedEmail(env: AllowlistEnv, email: string) {
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email.trim().toLowerCase());
}
