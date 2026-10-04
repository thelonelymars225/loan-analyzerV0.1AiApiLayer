import type { MeResponse, OrgSummary } from "@rater/contracts";
import type { TFunction } from "i18next";
import { createContext, useContext } from "react";

/** The signed-in user and their workspaces, loaded once by <RequireAuth>. */
export interface Session {
  me: MeResponse;
  activeOrg: OrgSummary | null;
  personalOrg: OrgSummary | null;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <RequireAuth>");
  return session;
}

export function toSession(me: MeResponse): Session {
  return {
    me,
    activeOrg: me.orgs.find((org) => org.id === me.activeOrgId) ?? null,
    personalOrg: me.orgs.find((org) => org.kind === "personal") ?? null,
  };
}

/** Owners and admins manage members; only owners change retention (architecture doc). */
export function canManageMembers(org: OrgSummary | null): boolean {
  return org?.role === "owner" || org?.role === "admin";
}

export function canChangeRetention(org: OrgSummary | null): boolean {
  return org?.role === "owner";
}

/** Personal workspaces get a translated name; company names are shown as typed. */
export function workspaceName(org: OrgSummary, t: TFunction): string {
  return org.kind === "personal" ? t("workspace.personalName") : org.name;
}
