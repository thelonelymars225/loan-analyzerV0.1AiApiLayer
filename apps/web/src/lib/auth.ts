import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth lives at /api/auth on the API. In development Vite proxies /api to the API,
 * so the client always talks to the page's own origin and the session cookie is first-party.
 */
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  basePath: "/api/auth",
  plugins: [organizationClient()],
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

/** Makes an org the session's active org. The API reads the org from the session. */
export async function setActiveOrg(organizationId: string): Promise<void> {
  const reply = await authClient.organization.setActive({ organizationId });
  if (reply.error) throw new Error(reply.error.message ?? "Could not switch workspace");
}
