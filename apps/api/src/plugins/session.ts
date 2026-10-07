import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../auth";
import { unauthorized } from "../errors";

/** Who is calling. Every query for customer data is scoped by user.id. */
export interface RequestContext {
  user: { id: string; email: string; name: string };
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the session hook on every route that is not `config: { public: true }`. */
    ctx: RequestContext;
  }
  interface FastifyContextConfig {
    /** The route works without a session (health check, rules table, OpenAPI). */
    public?: boolean;
  }
}

/** onRequest hook: resolves the Better Auth session, or answers 401. */
export function sessionHook(deps: { auth: Auth }): onRequestAsyncHookHandler {
  return async (request: FastifyRequest) => {
    if (request.routeOptions.config.public) return;
    const session = await deps.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) throw unauthorized();
    const { user } = session;
    request.ctx = { user: { id: user.id, email: user.email, name: user.name } };
  };
}
