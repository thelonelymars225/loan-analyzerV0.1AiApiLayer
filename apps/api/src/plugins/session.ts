import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { API_KEY_HEADER, type Auth } from "../auth";
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

/**
 * onRequest hook: resolves the Better Auth session (a cookie, or an API key in x-api-key,
 * which the api-key plugin answers as a session of the key's user), or answers 401.
 */
export function sessionHook(deps: { auth: Auth }): onRequestAsyncHookHandler {
  return async (request: FastifyRequest) => {
    if (request.routeOptions.config.public) return;
    const session = await getSession(deps.auth, request);
    if (!session) throw unauthorized();
    const { user } = session;
    request.ctx = { user: { id: user.id, email: user.email, name: user.name } };
  };
}

async function getSession(auth: Auth, request: FastifyRequest) {
  try {
    return await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  } catch (error) {
    // The plugin refuses an unknown, disabled or expired key with 401 or 403; a client
    // gets the same 401 as with no credentials, with a hint at what to check.
    const refused = isAPIError(error) && [401, 403].includes(error.statusCode);
    if (refused && request.headers[API_KEY_HEADER]) {
      throw unauthorized("The API key is not valid. Check it, or create a new one.");
    }
    throw error;
  }
}
