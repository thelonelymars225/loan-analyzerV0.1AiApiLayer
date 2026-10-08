import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import Fastify from "fastify";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Logger } from "pino";
import { API_BASE } from "@rater/contracts";
import type { Db } from "@rater/db";
import type { ObjectStorage } from "@rater/storage";
import { createAuth, type Auth } from "./auth";
import { trustedOrigins, type Config } from "./config";
import type { AppDeps } from "./deps";
import { createLogger } from "./logger";
import { authRoutes } from "./plugins/auth-routes";
import { registerDocs } from "./plugins/docs";
import { registerErrorHandling } from "./plugins/errors";
import { sessionHook, type RequestContext } from "./plugins/session";
import type { RatingQueue } from "./queue";
import { docsRoutes } from "./routes/docs";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { ratingRoutes } from "./routes/ratings";
import { ruleRoutes } from "./routes/rules";
import { wageCheckRoutes } from "./routes/wage-checks";

export interface BuildAppOptions {
  config: Config;
  db: Db;
  storage: ObjectStorage;
  queue: RatingQueue;
  /** Defaults to Better Auth on `db`. */
  auth?: Auth;
  /** Defaults to a pino logger at config.LOG_LEVEL. */
  logger?: Logger;
  /** Defaults to the system clock. */
  now?: () => Date;
  /** Defaults to 1 second. */
  eventsPollMs?: number;
}

/**
 * The whole HTTP API, without listening: main.ts starts it, tests call `app.inject()`.
 *
 *   /api/auth/*   Better Auth: sign-up, sign-in, sign-out, session (nothing else is reachable)
 *   /api/v1/*     the REST API (session cookie; problem+json errors)
 *   /api/docs     Swagger UI; the spec is /api/v1/openapi.json
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const deps: AppDeps = {
    config,
    db,
    storage: options.storage,
    queue: options.queue,
    auth: options.auth ?? createAuth({ config, db }),
    now: options.now ?? (() => new Date()),
    eventsPollMs: options.eventsPollMs ?? 1000,
  };

  const logger: FastifyBaseLogger = options.logger ?? createLogger(config.LOG_LEVEL);
  // In production the API sits behind exactly one proxy (nginx). Trusting only that first hop
  // means the client address is the one nginx saw, not anything a client wrote into the
  // X-Forwarded-For header. Locally no proxy is trusted.
  const trustOneProxyHop = (_address: string, hop: number) => hop < 1;
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.NODE_ENV === "production" ? trustOneProxyHop : false,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Filled in by the session hook; null until then (Fastify wants decorators declared up front).
  app.decorateRequest("ctx", null as unknown as RequestContext);
  registerErrorHandling(app);

  await app.register(fastifyCors, {
    origin: trustedOrigins(config),
    credentials: true,
    methods: ["GET", "POST", "DELETE"],
  });
  await app.register(fastifyMultipart);
  await registerDocs(app);
  await app.register(authRoutes(deps.auth));

  await app.register(
    async (v1) => {
      v1.addHook("onRequest", sessionHook(deps));
      await v1.register(healthRoutes, deps);
      await v1.register(ruleRoutes);
      await v1.register(docsRoutes);
      await v1.register(meRoutes, deps);
      await v1.register(ratingRoutes, deps);
      await v1.register(wageCheckRoutes, deps);
    },
    { prefix: API_BASE },
  );

  return app;
}
