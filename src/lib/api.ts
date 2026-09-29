import { NextResponse } from "next/server";
import { checkRateLimit, clientIp, rateLimits } from "@/lib/rate-limit";
import { workspaceFromRequest } from "@/lib/workspace";

// Shared guards for route handlers. Each returns either the value the route
// needs or a ready-made error response.

export function requireWorkspace(request: Request): { workspaceId: string } | { response: NextResponse } {
  const workspaceId = workspaceFromRequest(request);
  if (!workspaceId) {
    return {
      response: NextResponse.json(
        { error: "Your browser session is out of date. Reload the page and try again." },
        { status: 400 }
      )
    };
  }

  return { workspaceId };
}

export async function enforceRateLimit(request: Request, kind: keyof typeof rateLimits) {
  const rule = rateLimits[kind];
  const result = await checkRateLimit({ ...rule, id: clientIp(request) });
  if (result.allowed) {
    return null;
  }

  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return NextResponse.json(
    {
      error: `You're going a little fast — please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0"
      }
    }
  );
}
