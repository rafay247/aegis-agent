import { env, hasBraintrustConfig } from "@/lib/env";

export const observabilityConfig = {
  provider: "braintrust",
  enabled: hasBraintrustConfig()
};

// braintrust's `initLogger` is not memoized: every call constructs a fresh
// Logger, reassigns the SDK's current logger and resets its debug log level.
// A single brief run issues ~10 traced spans, so initializing per span is both
// wasteful and a source of surprising global state churn. Initialize once per
// process and reuse it.
let loggerInit: Promise<void> | null = null;

async function ensureLogger() {
  if (!loggerInit) {
    loggerInit = import("braintrust").then(({ initLogger }) => {
      initLogger({ projectName: env.braintrustProject, apiKey: env.braintrustApiKey });
    });
    // A failed init must not be cached as "done" — let the next span retry, and
    // don't leave an unhandled rejection behind.
    loggerInit.catch(() => {
      loggerInit = null;
    });
  }

  await loggerInit;
}

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

  let invoked = false;
  const wrapped = () => {
    invoked = true;
    return fn();
  };

  try {
    const { traced } = await import("braintrust");
    await ensureLogger();
    return await traced(
      async (span) => {
        const result = await wrapped();
        // `traced()` records timing and metadata but never the wrapped
        // function's return value, so a trace shows that a tool ran without
        // showing what it observed — precisely the gap called out in
        // docs/eval-findings.md. Log it explicitly, but never let a logging
        // failure take down the agent call that already succeeded.
        try {
          span.log({ output: result });
        } catch {
          // Tracing is best-effort.
        }
        return result;
      },
      { name, event: metadata ? { metadata } : undefined }
    );
  } catch (error) {
    if (invoked) {
      throw error;
    }
    return fn();
  }
}
