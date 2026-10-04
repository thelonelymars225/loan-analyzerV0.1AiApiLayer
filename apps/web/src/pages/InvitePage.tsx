import type { InvitePreview } from "@rater/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorState, LoadingState } from "../components/states/states";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useToast } from "../components/ui/toast-context";
import { buttonVariants } from "../components/ui/variants";
import { ApiError, api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { queryKeys } from "../lib/queries";
import { useSession } from "../lib/session";

/**
 * The link from an invitation (/invite/:id). <RequireAuth> sends signed-out visitors to sign in
 * or sign up first and brings them back here. The API answers 404 unless the invitation is
 * addressed to the signed-in email and still open.
 */
export function InvitePage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const invite = useQuery({
    queryKey: queryKeys.invite(id),
    queryFn: () => api.getInvite(id),
  });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <title>{`${t("invite.title")} · ${t("app.name")}`}</title>
      <h1 className="text-2xl font-semibold">{t("invite.title")}</h1>
      {invite.isPending ? (
        <LoadingState />
      ) : invite.isError ? (
        isNotFound(invite.error) ? (
          <NotForThisAccount />
        ) : (
          <ErrorState error={invite.error} onRetry={() => void invite.refetch()} />
        )
      ) : (
        <InviteCard invite={invite.data} />
      )}
    </div>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

function InviteCard({ invite }: { invite: InvitePreview }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const accept = useMutation({
    mutationFn: () => api.acceptInvite(invite.id),
    onSuccess: async (me) => {
      // The answer is the new /me: the joined workspace is now the active one.
      queryClient.setQueryData(queryKeys.me, me);
      // Everything else cached belonged to the previous workspace; pages refetch what they show.
      await queryClient.invalidateQueries({ refetchType: "none" });
      toast({ kind: "success", message: t("invite.joined", { name: invite.orgName }) });
      void navigate("/", { replace: true });
    },
  });

  if (accept.isError && isNotFound(accept.error)) return <NotForThisAccount />;

  return (
    <Card aria-labelledby="invite-org">
      <CardHeader>
        <CardTitle id="invite-org" className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-5 text-primary" />
          {t("invite.join", { name: invite.orgName })}
        </CardTitle>
        <CardDescription>
          {t("invite.details", {
            role: t(`roles.${invite.role}`),
            email: invite.email,
            date: formatDate(invite.expiresAt, i18n.language),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("invite.privacy", { name: invite.orgName })}</p>
        {accept.isError && (
          <p role="alert" className="text-critical-ink">
            {errorMessage(t, accept.error)}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Link to="/" className={buttonVariants({ variant: "secondary" })}>
          {t("invite.notNow")}
        </Link>
        <Button onClick={() => accept.mutate()} loading={accept.isPending}>
          {t("invite.accept")}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The API does not say which: wrong account, expired, cancelled or already used. */
function NotForThisAccount() {
  const { t } = useTranslation();
  const { me } = useSession();
  return (
    <ErrorState
      title={t("invite.notForYouTitle")}
      message={t("invite.notForYou", { email: me.user.email })}
    >
      <Link
        to="/"
        className={buttonVariants({
          variant: "secondary",
          size: "sm",
          className: "mt-2",
        })}
      >
        {t("common.goHome")}
      </Link>
    </ErrorState>
  );
}
