import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { ORG_HEADER } from "@rater/contracts";
import type { OrgRole, OrgSummary } from "@rater/contracts";
import type { Db } from "@rater/db";
import type { Auth } from "../auth";
import { unauthorized, workspaceChanged } from "../errors";
import { ensurePersonalOrg, listUserOrgs } from "../orgs";

/** Who is calling and in which workspace. Every query for customer data is scoped by orgId. */
export interface RequestContext {
  user: { id: string; email: string; name: string };
  /** The Better Auth session (to switch its active org). */
  sessionId: string;
  /** The session's active org (never taken from the request body). */
  orgId: string;
  /** The user's role in that org. */
  role: OrgRole;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the session hook on every route that is not `config: { public: true }`. */
    ctx: RequestContext;
  }
  interface FastifyContextConfig {
    /** The route works without a session (health check, rules table, OpenAPI). */
    public?: boolean;
    /**
     * The route does not act on the active workspace (switching it, accepting an
     * invitation, deleting personal data), so the x-org-id header is not checked.
     */
    ignoresOrgHeader?: boolean;
  }
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * onRequest hook: resolves the Better Auth session, or answers 401. Then, for changes, checks
 * the x-org-id header (see requireShownOrg).
 */
export function sessionHook(deps: { auth: Auth; db: Db }): onRequestAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const config = request.routeOptions.config;
    if (config.public) return;
    const ctx = await resolveContext(deps, request);
    if (!ctx) throw unauthorized();
    request.ctx = ctx;
    if (!config.ignoresOrgHeader && !READ_METHODS.has(request.method)) {
      requireShownOrg(request, ctx);
    }
  };
}

/**
 * The active workspace lives in the session cookie, which every tab shares. The web app sends
 * the workspace it is showing in x-org-id; if another tab has switched the session since,
 * the change is refused (409) instead of landing in a workspace the user is not looking at.
 * Without the header (other clients) the session's workspace applies as before.
 */
function requireShownOrg(request: FastifyRequest, ctx: RequestContext): void {
  const shown = request.headers[ORG_HEADER];
  if (shown !== undefined && shown !== ctx.orgId) throw workspaceChanged();
}

async function resolveContext(
  deps: { auth: Auth; db: Db },
  request: FastifyRequest,
): Promise<RequestContext | null> {
  const session = await deps.auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) return null;

  const { user } = session;
  let orgs = await listUserOrgs(deps.db, user.id);
  if (orgs.length === 0) {
    // Only possible if the sign-up hook failed half way; repair instead of locking them out.
    await ensurePersonalOrg(deps.db, user.id);
    orgs = await listUserOrgs(deps.db, user.id);
  }
  const active = pickActiveOrg(orgs, session.session.activeOrganizationId);
  if (!active) return null;
  return {
    user: { id: user.id, email: user.email, name: user.name },
    sessionId: session.session.id,
    orgId: active.id,
    role: active.role,
  };
}

/**
 * The session's active org when the user is (still) a member of it; otherwise their personal
 * workspace, otherwise their first one. So a user removed from a company falls back safely.
 */
export function pickActiveOrg(
  orgs: OrgSummary[],
  sessionOrgId: string | null | undefined,
): OrgSummary | undefined {
  return (
    orgs.find((org) => org.id === sessionOrgId) ??
    orgs.find((org) => org.kind === "personal" && org.role === "owner") ??
    orgs[0]
  );
}
