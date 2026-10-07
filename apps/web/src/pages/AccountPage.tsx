import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Checkbox, Label } from "../components/ui/input";
import { useToast } from "../components/ui/toast-context";
import { LANGUAGE_NAMES, LANGUAGES } from "../i18n";
import { deleteMyData } from "../lib/account";
import { errorMessage } from "../lib/errors";
import { useSession } from "../lib/session";

export function AccountPage() {
  const { t } = useTranslation();
  const { me } = useSession();

  return (
    <div className="space-y-6">
      <title>{`${t("account.title")} · ${t("app.name")}`}</title>
      <h1 className="text-2xl font-semibold">{t("account.title")}</h1>

      <Card aria-labelledby="profile-title">
        <CardHeader>
          <CardTitle id="profile-title">{t("account.profile")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("account.name")}</dt>
              <dd className="mt-1 font-medium">{me.user.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("account.email")}</dt>
              <dd className="mt-1 font-medium" dir="ltr">
                {me.user.email}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <LanguageCard />
      <DeleteMyDataCard />
    </div>
  );
}

function LanguageCard() {
  const { t, i18n } = useTranslation();
  return (
    <Card aria-labelledby="language-title">
      <CardHeader>
        <CardTitle id="language-title">{t("account.language")}</CardTitle>
        <CardDescription>{t("account.languageHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="group"
          aria-labelledby="language-title"
          className="flex flex-wrap gap-2"
        >
          {LANGUAGES.map((language) => {
            const selected = i18n.language === language;
            return (
              <Button
                key={language}
                variant={selected ? "primary" : "secondary"}
                aria-pressed={selected}
                onClick={() => void i18n.changeLanguage(language)}
              >
                <span lang={language}>{LANGUAGE_NAMES[language]}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteMyDataCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirmId = useId();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const deletion = useMutation({
    mutationFn: () => deleteMyData(),
    onSuccess: () => {
      queryClient.clear();
      toast({ kind: "success", message: t("account.deleted") });
      void navigate("/sign-in", { replace: true });
    },
  });

  function close() {
    if (deletion.isPending) return;
    setOpen(false);
    setUnderstood(false);
    deletion.reset();
  }

  return (
    <Card aria-labelledby="delete-data-title" className="border-critical/30">
      <CardHeader>
        <CardTitle id="delete-data-title">{t("account.deleteTitle")}</CardTitle>
        <CardDescription>{t("account.deleteBody")}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="danger" onClick={() => setOpen(true)}>
          {t("account.deleteButton")}
        </Button>
      </CardFooter>

      <Dialog
        open={open}
        onClose={close}
        title={t("account.confirmTitle")}
        description={t("account.confirmBody")}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={deletion.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => deletion.mutate()}
              disabled={!understood}
              loading={deletion.isPending}
            >
              {deletion.isPending ? t("account.deleting") : t("account.deleteButton")}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <Checkbox
            id={confirmId}
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          <Label htmlFor={confirmId} className="font-normal">
            {t("account.confirmCheck")}
          </Label>
        </div>
        {deletion.isError && (
          <p role="alert" className="mt-4 text-sm text-critical-ink">
            {errorMessage(t, deletion.error)}
          </p>
        )}
      </Dialog>
    </Card>
  );
}
