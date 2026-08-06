import { env, hasBraintrustConfig } from "@/lib/env";

export const observabilityConfig = {
  provider: "braintrust",
  enabled: hasBraintrustConfig()
};

// Wraps a unit of agent work (a model call or tool call) in a Braintrust trace
// span. When Braintrust isn't configured, or the SDK call fails for any
// reason, this degrades to just running fn() — tracing must never break the
// agent, matching every other optional integration in this codebase.
export async function tracedSpan<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  if (!hasBraintrustConfig()) {
    return fn();
  }

  try {
    const { initLogger, traced } = await import("braintrust");
    initLogger({ projectName: env.braintrustProject, apiKey: env.braintrustApiKey });
    return await traced((span) => fn(), { name, event: metadata ? { metadata } : undefined });
  } catch {
    return fn();
  }
}
