import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { api, ApiError, isUnauthorized, setShownOrg } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import { SessionContext, toSession, workspaceName } from "../../lib/session";
import { ErrorState, LoadingState } from "../states/states";
import { useToast } from "../ui/toast-context";
import { AppShell } from "./AppShell";

/** Loads /me for every signed-in page; signed-out visitors go to the sign-in page. */
export function RequireAuth() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const session = useMemo(() => (me.data ? toSession(me.data) : null), [me.data]);
  const shownOrgId = session?.activeOrg?.id ?? null;
  useShownOrgHeader(shownOrgId);
  useWorkspaceChangedElsewhere(shownOrgId);

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
        {/* Pages are loaded on demand (see App.tsx); the shell stays while one loads. */}
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </AppShell>
    </SessionContext.Provider>
  );
}

/** Every change this tab sends names the workspace it shows (see setShownOrg in api.ts). */
function useShownOrgHeader(shownOrgId: string | null) {
  useEffect(() => {
    setShownOrg(shownOrgId);
    return () => setShownOrg(null);
  }, [shownOrgId]);
}

/**
 * The active workspace is part of the session cookie, which every tab shares. When another tab
 * switches it, the API refuses this tab's changes with 409. After any 409 we reload /me: if the
 * active workspace is no longer the one shown, this tab moves to it and says why nothing was
 * saved. (Other 409s, like "already invited", leave the workspace alone and are shown as usual.)
 */
function useWorkspaceChangedElsewhere(shownOrgId: string | null) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    async function checkWorkspace() {
      const me = await queryClient.fetchQuery({
        queryKey: queryKeys.me,
        queryFn: api.me,
        staleTime: 0,
      });
      if (me.activeOrgId === shownOrgId) return;
      const active = me.orgs.find((org) => org.id === me.activeOrgId);
      // Everything cached belongs to the workspace this tab was showing.
      await queryClient.invalidateQueries();
      toast({
        kind: "info",
        message: t("workspace.changedElsewhere", {
          name: active ? workspaceName(active, t) : "",
        }),
      });
      void navigate("/");
    }

    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const { error } = event.action;
      if (error instanceof ApiError && error.status === 409) {
        checkWorkspace().catch(() => {
          // /me could not be loaded; the page already shows the change's own error.
        });
      }
    });
  }, [shownOrgId, queryClient, toast, navigate, t]);
}
