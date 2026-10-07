import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { AUTH_BASE_PATH, type Auth } from "../auth";

/**
 * The only Better Auth endpoints reachable over HTTP, as paths under /api/auth.
 *
 * Better Auth's organization endpoints apply its own role rules, not ours: any member could
 * list pending invitations (and so take one over, since sign-up does not verify email), an
 * admin could rename the workspace, an owner could invite people into a personal workspace.
 * So every /organization/* path answers 404, and workspaces are managed through /api/v1.
 * Server-side `auth.api.*` calls do not go through this handler and still work.
 */
const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/ok", // Better Auth's own liveness check
]);

/**
 * Serves the allowed Better Auth endpoints (sign-up, sign-in, sign-out, session) at
 * /api/auth/*. Better Auth speaks Web Request/Response, so each request is converted and the
 * answer copied back. Bodies are passed through untouched: this plugin's own content-type
 * parser keeps them as raw bytes instead of parsing JSON.
 */
export function authRoutes(auth: Auth): FastifyPluginAsync {
  return async (app) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    app.route({
      method: ["GET", "POST"],
      url: `${AUTH_BASE_PATH}/*`,
      handler: async (request, reply) => {
        const webRequest = toWebRequest(request);
        if (!isAllowed(webRequest)) {
          // Answered exactly like a route that does not exist.
          reply.callNotFound();
          return reply;
        }
        const response = await auth.handler(webRequest);
        return sendWebResponse(reply, response);
      },
    });
  };
}

/** Checks the normalised path that Better Auth itself will route on. */
export function isAllowed(request: Request): boolean {
  const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
  return ALLOWED_PATHS.has(path);
}

function toWebRequest(request: FastifyRequest): Request {
  const url = new URL(request.url, `${request.protocol}://${request.host}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    method: request.method,
    headers: fromNodeHeaders(request.headers),
    body: hasBody ? (request.body as Buffer | undefined) : undefined,
  });
}

async function sendWebResponse(
  reply: FastifyReply,
  response: Response,
): Promise<FastifyReply> {
  reply.code(response.status);
  response.headers.forEach((value, name) => {
    // Set-Cookie may repeat and is copied below; Fastify computes the length itself.
    if (name !== "set-cookie" && name !== "content-length") reply.header(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header("set-cookie", cookies);
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  return reply.send(body);
}
