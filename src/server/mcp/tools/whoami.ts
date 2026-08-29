import { autumn } from "@/server/billing/autumn";
import {
  AUTUMN_SEO_DATA_BALANCE_FEATURE_ID,
  AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
} from "@/shared/billing";
import { mcpResponse } from "@/server/mcp/formatters";
import { type ToolContext } from "@/server/mcp/context";
import {
  isBillingEnabledServer,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { z } from "zod";

async function checkBalance(featureId: string, customerId: string) {
  try {
    const result = await autumn.check({ customerId, featureId });
    return result.balance?.remaining ?? null;
  } catch {
    return null;
  }
}

export const whoamiTool = {
  name: "whoami",
  config: {
    title: "Who am I",
    description:
      "Confirms the connected OpenSEO account, server mode, token scopes, and current credit balance when the user asks to check their account or connection. Uses no credits — does not call DataForSEO.",
    inputSchema: {} as Record<string, never>,
    outputSchema: {
      userEmail: z.string(),
      scopes: z.array(z.string()),
      mode: z.enum(["hosted", "self-hosted"]),
      creditsRemaining: z.number().nullable(),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: async (_args: Record<string, never>, context: ToolContext) => {
    const auth = context.auth;
    // "mode" is what the deployment is; credits are what it meters. A hosted
    // instance can run with billing off, and then there is no balance to read.
    const [isHosted, isMetered] = await Promise.all([
      isHostedServerAuthMode(),
      isBillingEnabledServer(),
    ]);
    let creditsRemaining: number | null = null;
    if (isMetered) {
      const [base, topup] = await Promise.all([
        checkBalance(AUTUMN_SEO_DATA_BALANCE_FEATURE_ID, auth.organizationId),
        checkBalance(
          AUTUMN_SEO_DATA_TOPUP_BALANCE_FEATURE_ID,
          auth.organizationId,
        ),
      ]);
      creditsRemaining = (base ?? 0) + (topup ?? 0);
    }
    const lines = [
      `Account: ${auth.userEmail}`,
      `Mode: ${isHosted ? "hosted" : "self-hosted"}`,
      `Scopes: ${auth.scopes.length > 0 ? auth.scopes.join(", ") : "none"}`,
    ];
    if (isMetered) {
      lines.push(
        `Credits remaining: ${creditsRemaining != null ? creditsRemaining.toLocaleString() : "unknown"}`,
      );
    }
    return mcpResponse({
      text: lines.join("\n"),
      meta: {
        creditsRemaining: creditsRemaining ?? undefined,
      },
      structuredContent: {
        userEmail: auth.userEmail,
        scopes: auth.scopes,
        mode: isHosted ? "hosted" : "self-hosted",
        creditsRemaining,
      },
    });
  },
};
