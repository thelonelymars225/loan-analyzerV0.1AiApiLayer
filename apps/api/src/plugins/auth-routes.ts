import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { AUTH_BASE_PATH, type Auth } from "../auth";

/**
 * Serves Better Auth (sign-up, sign-in, sessions, organizations) at /api/auth/*.
 * Better Auth speaks Web Request/Response, so each request is converted and the answer
 * copied back. Bodies are passed through untouched: this plugin's own content-type parser
 * keeps them as raw bytes instead of parsing JSON.
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
      schema: { hide: true },
      handler: async (request, reply) => {
        const response = await auth.handler(toWebRequest(request));
        return sendWebResponse(reply, response);
      },
    });
  };
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
