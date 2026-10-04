import { CreateOrgBody } from "@rater/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input, Label } from "../ui/input";
import { useToast } from "../ui/toast-context";

/** Creates a company workspace and switches to it. */
export function CreateOrgDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);

  const create = useMutation({
    mutationFn: async (body: CreateOrgBody) => {
      const org = await api.createOrg(body);
      await api.setActiveOrg(org.id);
    },
    onSuccess: async (_, body) => {
      await queryClient.invalidateQueries();
      toast({ kind: "success", message: t("workspace.created", { name: body.name }) });
      close();
      void navigate("/");
    },
  });

  function close() {
    setName("");
    setInvalid(false);
    create.reset();
    onClose();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateOrgBody.safeParse({ name });
    setInvalid(!parsed.success);
    if (parsed.success) create.mutate(parsed.data);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("workspace.createTitle")}
      description={t("workspace.createDescription")}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor={nameId}>{t("workspace.nameLabel")}</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("workspace.namePlaceholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            autoComplete="organization"
            maxLength={120}
          />
          {invalid && (
            <p id={errorId} className="text-sm text-critical-ink">
              {t("workspace.nameError")}
            </p>
          )}
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-critical-ink">
            {errorMessage(t, create.error)}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={close} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t("workspace.createSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
