import { InviteBody, type InviteResponse } from "@rater/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import { queryKeys } from "../../lib/queries";
import { ErrorState, LoadingState } from "../states/states";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input, Label } from "../ui/input";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast-context";

/**
 * No email is sent in v1. Creating an invitation gives the owner or admin a link to the web
 * app (acceptPath) to share however they like; only the invited address can accept it.
 */
export function Invites({ orgId }: { orgId: string }) {
  return (
    <div className="space-y-6">
      <InviteForm orgId={orgId} />
      <PendingInvites orgId={orgId} />
    </div>
  );
}

/** The full link the invitee opens, e.g. https://rater.example/invite/inv_123. */
function inviteLink(acceptPath: string): string {
  return new URL(acceptPath, window.location.origin).href;
}

function InviteForm({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ids = { email: useId(), role: useId(), error: useId(), intro: useId() };
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteBody["role"]>("member");
  const [invalid, setInvalid] = useState(false);

  const invite = useMutation({
    mutationFn: (body: InviteBody) => api.invite(orgId, body),
    onSuccess: (created) => {
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites(orgId) });
      toast({ kind: "success", message: t("org.invited", { email: created.email }) });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = InviteBody.safeParse({ email: email.trim(), role });
    setInvalid(!parsed.success);
    if (parsed.success) invite.mutate(parsed.data);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-describedby={ids.intro}
      className="space-y-3 rounded-lg bg-muted/50 p-4"
    >
      <h3 className="font-medium">{t("org.invite")}</h3>
      <p id={ids.intro} className="text-sm text-muted-foreground">
        {t("org.inviteIntro")}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor={ids.email}>{t("org.inviteEmail")}</Label>
          <Input
            id={ids.email}
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? ids.error : undefined}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5 sm:w-36">
          <Label htmlFor={ids.role}>{t("org.inviteRole")}</Label>
          <Select
            id={ids.role}
            value={role}
            onChange={(event) => setRole(event.target.value as InviteBody["role"])}
          >
            <option value="member">{t("roles.member")}</option>
            <option value="admin">{t("roles.admin")}</option>
          </Select>
        </div>
        <Button type="submit" loading={invite.isPending}>
          {t("org.inviteSubmit")}
        </Button>
      </div>
      {invalid && (
        <p id={ids.error} className="text-sm text-critical-ink">
          {t("org.inviteInvalidEmail")}
        </p>
      )}
      {invite.isError && (
        <p role="alert" className="text-sm text-critical-ink">
          {errorMessage(t, invite.error)}
        </p>
      )}
    </form>
  );
}

/** The link as selectable text (a click selects all of it) plus a Copy button. */
function InviteLink({ invite }: { invite: InviteResponse }) {
  const { t } = useTranslation();
  const toast = useToast();
  const link = inviteLink(invite.acceptPath);

  async function copy() {
    // The Clipboard API is missing on plain HTTP from another machine, so this can fail.
    try {
      await navigator.clipboard.writeText(link);
      toast({ kind: "success", message: t("org.linkCopied") });
    } catch {
      toast({ kind: "error", message: t("org.copyFailed") });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code
        dir="ltr"
        className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1.5 text-xs select-all"
      >
        {link}
      </code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void copy()}
        aria-label={t("org.copyLinkFor", { email: invite.email })}
      >
        <Copy aria-hidden="true" />
        {t("org.copyLink")}
      </Button>
    </div>
  );
}

function PendingInvites({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const invites = useQuery({
    queryKey: queryKeys.invites(orgId),
    queryFn: () => api.listInvites(orgId),
  });

  return (
    <section aria-labelledby="pending-invites-title" className="space-y-3">
      <h3 id="pending-invites-title" className="font-medium">
        {t("org.pendingInvites")}
      </h3>
      {invites.isPending ? (
        <LoadingState className="py-4" />
      ) : invites.isError ? (
        <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />
      ) : invites.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("org.pendingEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {invites.data.items.map((invite) => (
            <PendingInviteRow key={invite.id} orgId={orgId} invite={invite} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingInviteRow({ orgId, invite }: { orgId: string; invite: InviteResponse }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: () => api.cancelInvite(orgId, invite.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invites(orgId) });
      toast({ kind: "success", message: t("org.inviteCancelled") });
    },
    onError: (error) => toast({ kind: "error", message: errorMessage(t, error) }),
  });

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-medium" dir="ltr">
          {invite.email}
        </span>
        <Badge>{t(`roles.${invite.role}`)}</Badge>
        <span className="text-xs text-muted-foreground">
          {t("org.inviteExpires", { date: formatDate(invite.expiresAt, i18n.language) })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto"
          onClick={() => cancel.mutate()}
          loading={cancel.isPending}
          aria-label={t("org.cancelInviteFor", { email: invite.email })}
        >
          {!cancel.isPending && <X aria-hidden="true" />}
          {t("org.cancelInvite")}
        </Button>
      </div>
      <InviteLink invite={invite} />
    </li>
  );
}
