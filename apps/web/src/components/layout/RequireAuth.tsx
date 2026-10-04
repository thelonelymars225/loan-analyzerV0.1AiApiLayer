import type { MeResponse } from "@rater/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router";
import { api, isUnauthorized } from "../../lib/api";
import { setActiveOrg } from "../../lib/auth";
import { queryKeys } from "../../lib/queries";
import { SessionContext, toSession } from "../../lib/session";
import { ErrorState, LoadingState } from "../states/states";
import { AppShell } from "./AppShell";

/** Loads /me for every signed-in page; signed-out visitors go to the sign-in page. */
export function RequireAuth() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  useEnsureActiveOrg(me.data);
  const session = useMemo(() => (me.data ? toSession(me.data) : null), [me.data]);

  if (me.isError && isUnauthorized(me.error)) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <ErrorState
          error={me.error}
          title={t("errors.loadSession")}
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  }
  if (!session) return <LoadingState className="min-h-dvh" />;

  return (
    <SessionContext.Provider value={session}>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionContext.Provider>
  );
}

/**
 * A fresh session has no active org yet. The API scopes everything by the active org, so pick
 * the personal workspace (or the first one) right away.
 */
function useEnsureActiveOrg(me: MeResponse | undefined) {
  const queryClient = useQueryClient();
  const target =
    me && me.activeOrgId === null
      ? (me.orgs.find((org) => org.kind === "personal") ?? me.orgs[0])
      : undefined;
  const targetId = target?.id;

  useEffect(() => {
    if (!targetId) return;
    setActiveOrg(targetId)
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.me }))
      .catch(() => {
        // Leave it: the pages show "no workspace" and the switcher still works.
      });
  }, [targetId, queryClient]);
}
