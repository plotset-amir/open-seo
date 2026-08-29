import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isDisposableEmailDomain } from "@/server/auth/disposable-email";
import * as d1Schema from "@/db/d1/schema";
import { d1Db } from "@/db/d1/client";
import { pgDb } from "@/db/pg/client";
import * as pgSchema from "@/db/pg/schema";
import { getDatabaseProvider } from "@/db/provider";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { createApiKeyPlugin } from "@/lib/auth-api-key";
import { isAllowedHostedEmail } from "@/lib/auth-allowlist";
import { createBaseAuthConfig } from "@/lib/auth-config";
import {
  getHostedTurnstileSecretKey,
  hasHostedTurnstileConfig,
} from "@/lib/auth-turnstile";
import { hasHostedEmailConfig } from "@/shared/selfhost-checks";
import { getOrCreateDefaultHostedOrganization } from "@/server/auth/default-hosted-organization";
import {
  sendHostedPasswordResetEmail,
  sendHostedVerificationEmail,
  upsertHostedSignupContact,
} from "@/server/email/loops";

const hostedBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    );
  }, "BETTER_AUTH_URL must use https or localhost");

function createAuth() {
  // Hosted needs the real configured URL (cookies, callbacks, /api/auth routes
  // all use it). Self-hosted only builds this instance to mint/refresh Search
  // Console tokens, which never read baseURL — so a placeholder is fine there.
  const baseUrl = isHostedAuthMode(env.AUTH_MODE)
    ? getHostedBaseUrl()
    : "http://localhost";
  const bypassEmail = Reflect.get(env, "BYPASS_EMAIL_VERIFICATION") === "true";
  const baseAuthConfig = createBaseAuthConfig();

  // Turnstile captcha on signup — hosted only. Enforcement is driven by the
  // server-side secret alone so a client build/runtime site-key mismatch cannot
  // silently omit the Better Auth captcha plugin. Hosted deployments that expose
  // the client widget without the matching server secret fail configuration
  // checks instead of presenting a bypassable captcha.
  const turnstileSecretKey = getHostedTurnstileSecretKey(env);

  const database =
    getDatabaseProvider() === "postgres"
      ? drizzleAdapter(pgDb, {
          provider: "pg",
          schema: pgSchema,
        })
      : drizzleAdapter(d1Db, {
          provider: "sqlite",
          schema: d1Schema,
        });

  const auth = betterAuth({
    baseURL: baseUrl,
    secret: getHostedSecret(),
    ...baseAuthConfig,
    emailAndPassword: {
      ...baseAuthConfig.emailAndPassword,
      requireEmailVerification: !bypassEmail,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendHostedPasswordResetEmail({
          email: user.email,
          resetUrl: url,
        });
      },
    },
    emailVerification: bypassEmail
      ? undefined
      : {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) => {
            await sendHostedVerificationEmail({
              email: user.email,
              confirmationUrl: url,
            });
          },
        },
    socialProviders: getSocialProviders(),
    trustedOrigins: getTrustedOrigins(baseUrl),
    database,
    plugins: [
      ...baseAuthConfig.plugins,
      ...(isHostedAuthMode(env.AUTH_MODE) ? [createApiKeyPlugin()] : []),
      ...(turnstileSecretKey
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: turnstileSecretKey,
              endpoints: ["/sign-up/email"],
            }),
          ]
        : []),
      tanstackStartCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          // Hosted only. Two gates, both before the user row is created:
          //
          // 1. ALLOWED_EMAILS — the self-host allowlist. Hosted is the
          //    public-SaaS mode (emailAndPassword.disableSignUp is false and
          //    Google social login is on), so a self-hosted deployment running
          //    it accepts anyone who finds the URL, and DATAFORSEO_API_KEY is a
          //    single instance-wide key — every stranger spends the operator's
          //    balance. This hook is the one chokepoint both signup paths
          //    (email/password and Google) pass through, so one check covers
          //    both. It is only the first of three: the session hook below and
          //    resolveHostedContext re-check, because an account created while
          //    the instance was open must lose access, not just be unable to
          //    register again.
          //
          // 2. Disposable domains — keeps cheap mass-signups off the free plan.
          //    Self-hosted has no shared credit pool to protect, so it (like
          //    the allowlist) is left untouched outside hosted mode.
          before: async (user) => {
            if (isHostedAuthMode(env.AUTH_MODE)) {
              assertAllowedHostedEmail(user.email);

              if (isDisposableEmailDomain(user.email)) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Please sign up with a non-disposable email address.",
                });
              }
            }

            return { data: user };
          },
          after: async (user) => {
            await syncHostedSignupContact(user);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // The user hook only guards account creation. Every stranger who
            // registered before the allowlist existed still holds an account,
            // and sign-in is where they come back — so re-check here, where a
            // rejection surfaces as a clean error on the login form.
            if (isHostedAuthMode(env.AUTH_MODE)) {
              assertAllowedHostedEmail(await getUserEmail(session.userId));
            }

            // Inject Better Auth's createOrganization here so the helper can
            // stay reusable without importing auth.ts and creating a cycle.
            const organizationId = await getOrCreateDefaultHostedOrganization(
              session.userId,
              (body) => auth.api.createOrganization({ body }),
            );

            return {
              data: {
                ...session,
                activeOrganizationId: organizationId,
              },
            };
          },
        },
      },
    },
  });

  return auth;
}

let authInstance: ReturnType<typeof createAuth> | null = null;

// Hosted only — callers check the mode. Throws the same FORBIDDEN for an
// unlisted address and for an unset list (auth-allowlist.ts fails closed).
export function assertAllowedHostedEmail(email: string | null | undefined) {
  if (!email || !isAllowedHostedEmail(env, email)) {
    throw new APIError("FORBIDDEN", {
      message: "This OpenSEO instance is invite-only.",
    });
  }
}

async function getUserEmail(userId: string) {
  const row = await db.query.user.findFirst({
    columns: { email: true },
    where: eq(userTable.id, userId),
  });

  return row?.email;
}

async function syncHostedSignupContact(user: {
  id: string;
  email: string;
  name?: string | null;
}) {
  try {
    await upsertHostedSignupContact({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error) {
    console.error("Failed to sync Loops profile after user creation:", {
      userId: user.id,
      email: user.email,
      error,
    });
  }
}

function getTrustedOrigins(baseUrl: string) {
  const trustedOrigins = [baseUrl];

  if (process.env.NODE_ENV !== "production") {
    trustedOrigins.push(
      "http://open-seo.localhost:1355",
      "http://*.open-seo.localhost:1355",
      "https://open-seo.localhost:1355",
      "https://*.open-seo.localhost:1355",
    );
  }

  return trustedOrigins;
}

export function getHostedBaseUrl() {
  const baseUrl = env.BETTER_AUTH_URL?.trim();

  if (!baseUrl) {
    throw new Error("BETTER_AUTH_URL is required in hosted mode");
  }

  return hostedBaseUrlSchema.parse(baseUrl);
}

// Required in hosted mode, and in self-hosted mode when Search Console is
// enabled (it keys the OAuth-token encryption and is needed to build the auth
// instance that mints/refreshes Search Console tokens).
function getHostedSecret() {
  const secret = env.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }

  return secret;
}

function getSocialProviders() {
  // Google social login is hosted-only. Self-hosted builds the auth instance
  // solely for Search Console token ops, which use the genericOAuth provider
  // (createBaseAuthConfig) with its own creds — so it must NOT require the
  // social-login config here, otherwise getAuth() construction would be coupled
  // to GSC creds rather than just BETTER_AUTH_SECRET.
  if (!isHostedAuthMode(env.AUTH_MODE)) {
    return {};
  }

  return {
    google: getGoogleSocialProviderConfig(),
  };
}

function getGoogleSocialProviderConfig() {
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();

  if (!googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is required in hosted mode");
  }

  if (!googleClientSecret) {
    throw new Error("GOOGLE_CLIENT_SECRET is required in hosted mode");
  }

  return {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    mapProfileToUser: (profile: { name?: string }) => ({
      name: profile.name,
    }),
  };
}

export function hasHostedAuthConfig() {
  try {
    getHostedBaseUrl();
    getHostedSecret();
    getGoogleSocialProviderConfig();
    // Same rule the Docker preflight applies at boot, so a self-hoster never
    // passes startup and then meets a 500 on the first sign-in.
    return hasHostedTurnstileConfig(env) && hasHostedEmailConfig(env);
  } catch {
    return false;
  }
}

export function getAuth() {
  if (authInstance) {
    return authInstance;
  }

  authInstance = createAuth();

  return authInstance;
}
