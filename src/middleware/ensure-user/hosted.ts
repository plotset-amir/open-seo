import { env } from "cloudflare:workers";
import { isAllowedHostedEmail } from "@/lib/auth-allowlist";
import { getAuth, hasHostedAuthConfig } from "@/lib/auth";
import { getActiveOrganizationId } from "@/lib/auth-session";
import { getOrCreateDefaultHostedOrganization } from "@/server/auth/default-hosted-organization";
import { AppError } from "@/server/lib/errors";
import type { EnsuredUserContext } from "./types";

async function requireHostedSession(headers: Headers) {
  if (!hasHostedAuthConfig()) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Missing Better Auth hosted configuration",
    );
  }

  const session = await getAuth().api.getSession({ headers });

  if (!session?.user?.id || !session.user.email) {
    throw new AppError("UNAUTHENTICATED");
  }

  // Last of the three allowlist checks (see auth.ts): sessions issued before
  // an address was removed — or before the list existed at all — stay valid in
  // the DB and in the 5-minute session cookie cache, so the request path has to
  // enforce it too or a stranger keeps working until their cookie expires.
  if (!isAllowedHostedEmail(env, session.user.email)) {
    throw new AppError("FORBIDDEN", "This OpenSEO instance is invite-only.");
  }

  return session;
}

export async function resolveHostedContext(
  headers: Headers,
): Promise<EnsuredUserContext> {
  const session = await requireHostedSession(headers);
  const activeOrganizationId = getActiveOrganizationId(session);

  if (activeOrganizationId) {
    return {
      userId: session.user.id,
      userEmail: session.user.email,
      emailVerified: session.user.emailVerified ?? false,
      organizationId: activeOrganizationId,
    };
  }

  const authApi = getAuth().api;
  const organizationId = await getOrCreateDefaultHostedOrganization(
    session.user.id,
    (body) => authApi.createOrganization({ body }),
  );

  await authApi.setActiveOrganization({
    headers,
    body: { organizationId },
  });

  return {
    userId: session.user.id,
    userEmail: session.user.email,
    emailVerified: session.user.emailVerified ?? false,
    organizationId,
  };
}
