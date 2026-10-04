import { createAuthClient } from "better-auth/react";

/**
 * Better Auth lives at /api/auth on the API. In development Vite proxies /api to the API,
 * so the client always talks to the page's own origin and the session cookie is first-party.
 *
 * Only sign-up, sign-in and sign-out go through Better Auth. Its organization endpoints are
 * closed on the API (they apply Better Auth's role rules, not ours); workspaces are switched
 * and joined through /api/v1 (see api.ts).
 */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  basePath: "/api/auth",
});

export interface AuthResult {
  ok: boolean;
  /** Better Auth error code, e.g. INVALID_EMAIL_OR_PASSWORD. */
  errorCode?: string;
}

interface BetterAuthReply {
  error: { code?: string | undefined; status: number } | null;
}

function toResult(reply: BetterAuthReply): AuthResult {
  if (!reply.error) return { ok: true };
  return { ok: false, errorCode: reply.error.code ?? `HTTP_${reply.error.status}` };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  return toResult(await authClient.signIn.email({ email, password }));
}

export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  return toResult(await authClient.signUp.email({ name, email, password }));
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
