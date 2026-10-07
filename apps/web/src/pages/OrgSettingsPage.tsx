import type { MemberResponse, OrgRole, OrgSummary } from "@rater/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Trash2, Users } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Invites } from "../components/org/Invites";
import { EmptyState, ErrorState, LoadingState } from "../components/states/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input, Label } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { useToast } from "../components/ui/toast-context";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { queryKeys } from "../lib/queries";
import { canChangeRetention, canManageMembers, useSession } from "../lib/session";

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

export function OrgSettingsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useSession();

  if (!activeOrg) {
    return (
      <EmptyState
        icon={Building2}
        title={t("workspace.none")}
        description={t("workspace.noneHint")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <title>{`${t("org.title")} · ${t("app.name")}`}</title>
      <h1 className="text-2xl font-semibold">{t("org.title")}</h1>
      {/* Keyed by org so the form starts from the new org's value after a switch. */}
      <RetentionCard key={activeOrg.id} org={activeOrg} />
      {activeOrg.kind === "company" && <MembersCard org={activeOrg} />}
    </div>
  );
}

function RetentionCard({ org }: { org: OrgSummary }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputId = useId();
  const hintId = useId();
  const [days, setDays] = useState(String(org.retentionDays));
  const [invalid, setInvalid] = useState(false);
  const editable = canChangeRetention(org);

  const save = useMutation({
    mutationFn: (retentionDays: number) => api.updateOrg(org.id, { retentionDays }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast({ kind: "success", message: t("org.retentionSaved") });
    },
    onError: (error) => toast({ kind: "error", message: errorMessage(t, error) }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = Number(days);
    const valid =
      Number.isInteger(value) &&
      value >= MIN_RETENTION_DAYS &&
      value <= MAX_RETENTION_DAYS;
    setInvalid(!valid);
    if (valid) save.mutate(value);
  }

  return (
    <Card aria-labelledby="retention-title">
      <CardHeader>
        <CardTitle id="retention-title">{t("org.retention")}</CardTitle>
        <CardDescription>{t("org.retentionIntro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>{t("org.retentionLabel")}</Label>
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={MIN_RETENTION_DAYS}
              max={MAX_RETENTION_DAYS}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              disabled={!editable}
              aria-invalid={invalid || undefined}
              aria-describedby={hintId}
              className="w-32"
            />
          </div>
          {editable && (
            <Button type="submit" variant="secondary" loading={save.isPending}>
              {t("common.save")}
            </Button>
          )}
          <p
            id={hintId}
            className={
              invalid
                ? "w-full text-sm text-critical-ink"
                : "w-full text-xs text-muted-foreground"
            }
          >
            {invalid
              ? t("org.retentionInvalid")
              : editable
                ? t("org.retentionHint")
                : t("org.retentionOwnerOnly")}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function MembersCard({ org }: { org: OrgSummary }) {
  const { t } = useTranslation();
  const manage = canManageMembers(org);

  return (
    <Card aria-labelledby="members-title">
      <CardHeader>
        <CardTitle id="members-title">{t("org.members")}</CardTitle>
        {!manage && <CardDescription>{t("org.membersReadOnly")}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6">
        <MembersList org={org} manage={manage} />
        {manage && <Invites orgId={org.id} />}
      </CardContent>
    </Card>
  );
}

function MembersList({ org, manage }: { org: OrgSummary; manage: boolean }) {
  const { t } = useTranslation();
  const members = useQuery({
    queryKey: queryKeys.members(org.id),
    queryFn: () => api.listMembers(org.id),
  });

  if (members.isPending) return <LoadingState className="py-6" />;
  if (members.isError) {
    return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  }
  if (members.data.items.length === 0) {
    return <EmptyState icon={Users} title={t("org.membersEmpty")} />;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {members.data.items.map((member) => (
        <MemberRow key={member.userId} org={org} member={member} manage={manage} />
      ))}
    </ul>
  );
}

/** Roles a manager may hand out: only an owner can make someone else an owner. */
function assignableRoles(myRole: OrgRole): OrgRole[] {
  return myRole === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];
}

function MemberRow({
  org,
  member,
  manage,
}: {
  org: OrgSummary;
  member: MemberResponse;
  manage: boolean;
}) {
  const { t } = useTranslation();
  const { me } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roleId = useId();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isMe = member.userId === me.user.id;
  // Nobody edits themselves here, and admins cannot touch owners.
  const editable = manage && !isMe && (org.role === "owner" || member.role !== "owner");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.members(org.id) });

  const changeRole = useMutation({
    mutationFn: (role: OrgRole) => api.updateMember(org.id, member.userId, role),
    onSuccess: () => {
      void refresh();
      toast({ kind: "success", message: t("org.roleChanged") });
    },
    onError: (error) => toast({ kind: "error", message: errorMessage(t, error) }),
  });

  const remove = useMutation({
    mutationFn: () => api.removeMember(org.id, member.userId),
    onSuccess: () => {
      setConfirmingRemove(false);
      void refresh();
      toast({ kind: "success", message: t("org.removed") });
    },
    onError: (error) => toast({ kind: "error", message: errorMessage(t, error) }),
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {member.name}{" "}
          {isMe && <span className="text-muted-foreground">{t("org.you")}</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground" dir="ltr">
          {member.email}
        </p>
      </div>
      {editable ? (
        <>
          <label htmlFor={roleId} className="sr-only">
            {t("org.roleFor", { name: member.name })}
          </label>
          <Select
            id={roleId}
            value={member.role}
            onChange={(event) => changeRole.mutate(event.target.value as OrgRole)}
            disabled={changeRole.isPending}
            className="h-9 w-32"
          >
            {assignableRoles(org.role).map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmingRemove(true)}
            aria-label={t("org.removeNamed", { name: member.name })}
          >
            <Trash2 aria-hidden="true" />
          </Button>
          <Dialog
            open={confirmingRemove}
            onClose={() => setConfirmingRemove(false)}
            title={t("org.removeTitle", { name: member.name })}
            description={t("org.removeBody")}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={remove.isPending}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => remove.mutate()}
                  loading={remove.isPending}
                >
                  {t("org.remove")}
                </Button>
              </>
            }
          />
        </>
      ) : (
        <Badge>{t(`roles.${member.role}`)}</Badge>
      )}
    </li>
  );
}
