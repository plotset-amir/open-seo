type SignupAllowlistEnv = {
  ALLOWED_EMAILS?: string;
};

/**
 * Who may create an account on a hosted-mode deployment.
 *
 * Hosted is the public-SaaS mode — email/password signup is open and Google
 * social login is on — so a self-hosted deployment running it accepts anyone
 * who finds the URL, and DATAFORSEO_API_KEY is one instance-wide key, so every
 * stranger spends the operator's balance. Fail closed: an unset var (or one
 * that never reached the runtime) allows nobody rather than everybody.
 */
export function isAllowedSignupEmail(env: SignupAllowlistEnv, email: string) {
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(email.trim().toLowerCase());
}
