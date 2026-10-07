import { useQuery } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router";
import { api, isUnauthorized } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import { SessionContext } from "../../lib/session";
import { ErrorState, LoadingState } from "../states/states";
import { AppShell } from "./AppShell";

/** Loads /me for every signed-in page; signed-out visitors go to the sign-in page. */
export function RequireAuth() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const session = useMemo(() => (me.data ? { me: me.data } : null), [me.data]);

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
