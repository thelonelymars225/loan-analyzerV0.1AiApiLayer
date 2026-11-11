import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "../components/states/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { queryKeys } from "../lib/queries";
import { useSession } from "../lib/session";
import { NotFoundPage } from "./NotFoundPage";

/** The admin grants or revokes each user's API access. Revoking also deletes their keys. */
export function AdminPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: api.listUsers,
    enabled: me.isAdmin,
  });
  const access = useMutation({
    mutationFn: (input: { userId: string; allowed: boolean }) =>
      api.setApiAccess(input.userId, input.allowed),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
      // The admin may have changed their own access, which shows in the menu.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });

  if (!me.isAdmin) return <NotFoundPage />;

  return (
    <div className="space-y-6">
      <title>{`${t("admin.title")} · ${t("app.name")}`}</title>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
        <p className="text-muted-foreground">{t("admin.intro")}</p>
      </header>
      {access.isError && (
        <p role="alert" className="text-sm text-critical-ink">
          {errorMessage(t, access.error)}
        </p>
      )}
      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {users.data.users.map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <div className="flex-1">
                <p className="font-medium">{user.name}</p>
                <p dir="ltr" className="text-start text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <Badge tone={user.apiAccess ? "good" : "neutral"}>
                {t(user.apiAccess ? "admin.hasAccess" : "admin.noAccess")}
              </Badge>
              <Button
                variant={user.apiAccess ? "danger" : "secondary"}
                size="sm"
                loading={access.isPending && access.variables.userId === user.id}
                onClick={() => {
                  const allowed = !user.apiAccess;
                  if (
                    allowed ||
                    window.confirm(t("admin.confirmRevoke", { email: user.email }))
                  ) {
                    access.mutate({ userId: user.id, allowed });
                  }
                }}
              >
                {t(user.apiAccess ? "admin.revoke" : "admin.grant")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
