import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { setActiveOrg } from "../../lib/auth";
import { useSession, workspaceName } from "../../lib/session";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast-context";
import { CreateOrgDialog } from "./CreateOrgDialog";

/** Picks the active workspace: the personal one, or a company the user belongs to. */
export function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const { me, activeOrg } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectId = useId();
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);

  const personal = me.orgs.filter((org) => org.kind === "personal");
  const companies = me.orgs.filter((org) => org.kind === "company");

  async function switchTo(orgId: string) {
    const org = me.orgs.find((candidate) => candidate.id === orgId);
    if (!org || org.id === activeOrg?.id) return;
    setSwitching(true);
    try {
      await setActiveOrg(org.id);
      // Every cached query belongs to the old workspace.
      await queryClient.invalidateQueries();
      toast({
        kind: "success",
        message: t("workspace.switched", { name: workspaceName(org, t) }),
      });
      void navigate("/");
    } catch {
      toast({ kind: "error", message: t("workspace.switchFailed") });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="sr-only">
        {t("workspace.label")}
      </label>
      <Select
        id={selectId}
        value={activeOrg?.id ?? ""}
        onChange={(event) => void switchTo(event.target.value)}
        disabled={switching}
        className="h-9 max-w-[14rem] min-w-[10rem]"
      >
        {!activeOrg && <option value="">{t("workspace.none")}</option>}
        {personal.length > 0 && (
          <optgroup label={t("workspace.groupPersonal")}>
            {personal.map((org) => (
              <option key={org.id} value={org.id}>
                {workspaceName(org, t)}
              </option>
            ))}
          </optgroup>
        )}
        {companies.length > 0 && (
          <optgroup label={t("workspace.groupCompanies")}>
            {companies.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCreating(true)}
        aria-label={t("workspace.create")}
        title={t("workspace.create")}
      >
        <Plus aria-hidden="true" />
      </Button>
      <CreateOrgDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
