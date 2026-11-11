import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "../components/states/states";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { queryKeys } from "../lib/queries";
import { useSession } from "../lib/session";

/** Create, list and revoke your own API keys. Needs API access, granted by an admin. */
export function ApiKeysPage() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState("");
  const keys = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: api.listApiKeys,
    enabled: me.apiAccess,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
  const create = useMutation({ mutationFn: api.createApiKey, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteApiKey, onSuccess: refresh });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    create.mutate(name.trim(), { onSuccess: () => setName("") });
  }

  return (
    <div className="space-y-6">
      <title>{`${t("apiKeys.title")} · ${t("app.name")}`}</title>
      <h1 className="text-2xl font-semibold">{t("apiKeys.title")}</h1>
      {!me.apiAccess ? (
        <p className="text-muted-foreground">{t("apiKeys.noAccess")}</p>
      ) : (
        <Card aria-labelledby="new-key-title">
          <CardHeader>
            <CardTitle id="new-key-title">{t("apiKeys.create")}</CardTitle>
            <CardDescription>{t("apiKeys.createHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
              <div className="grid flex-1 gap-1">
                <Label htmlFor={nameId}>{t("apiKeys.name")}</Label>
                <Input
                  id={nameId}
                  value={name}
                  maxLength={64}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" loading={create.isPending}>
                {t("apiKeys.create")}
              </Button>
            </form>
            {create.data && (
              <div role="status" className="space-y-1 rounded-md bg-muted p-3 text-sm">
                <p>{t("apiKeys.shownOnce")}</p>
                <code dir="ltr" className="block font-mono break-all select-all">
                  {create.data.key}
                </code>
              </div>
            )}
            {(create.isError || remove.isError) && (
              <p role="alert" className="text-sm text-critical-ink">
                {errorMessage(t, create.error ?? remove.error)}
              </p>
            )}
            {keys.isPending ? (
              <LoadingState />
            ) : keys.isError ? (
              <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
            ) : keys.data.apiKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("apiKeys.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {keys.data.apiKeys.map((key) => (
                  <li key={key.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="flex-1">
                      <p className="font-medium">{key.name}</p>
                      <p className="text-muted-foreground">
                        <span
                          dir="ltr"
                          className="font-mono"
                        >{`${key.start ?? ""}…`}</span>
                        {" · "}
                        {formatDateTime(key.createdAt, i18n.language)}
                      </p>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={remove.isPending && remove.variables === key.id}
                      onClick={() => {
                        if (window.confirm(t("apiKeys.confirmRevoke")))
                          remove.mutate(key.id);
                      }}
                    >
                      {t("apiKeys.revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
