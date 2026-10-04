import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { BrandMark } from "../components/layout/AppShell";
import { LanguageToggle } from "../components/layout/LanguageToggle";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { signIn, signUp } from "../lib/auth";
import { authErrorMessage } from "../lib/errors";

type Mode = "sign-in" | "sign-up";

const MIN_PASSWORD_LENGTH = 8;

export function AuthPage({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const ids = {
    name: useId(),
    email: useId(),
    password: useId(),
    passwordHint: useId(),
    error: useId(),
  };
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === "sign-up";
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // Arrived from an invitation link: it only works with the invited email address.
  const fromInvite = from.startsWith("/invite/");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.errors.password_too_short"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = isSignUp
        ? await signUp(name.trim(), email.trim(), password)
        : await signIn(email.trim(), password);
      if (!result.ok) {
        setError(authErrorMessage(t, result.errorCode));
        return;
      }
      await queryClient.invalidateQueries();
      void navigate(from, { replace: true });
    } catch {
      setError(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <title>{`${t(isSignUp ? "auth.signUpTitle" : "auth.signInTitle")} · ${t("app.name")}`}</title>
      <div className="flex justify-end p-4">
        <LanguageToggle />
      </div>
      <main className="flex flex-1 flex-col items-center px-4 pt-8 pb-16 sm:pt-16">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-10" />
          <p className="text-xl font-semibold">{t("app.name")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("app.tagline")}</p>
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t(isSignUp ? "auth.signUpTitle" : "auth.signInTitle")}</CardTitle>
            <CardDescription>
              {t(isSignUp ? "auth.signUpSubtitle" : "auth.signInSubtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fromInvite && (
              <p className="mb-4 rounded-lg bg-info-soft/60 px-3 py-2 text-sm">
                {t("auth.inviteHint")}
              </p>
            )}
            <form
              onSubmit={onSubmit}
              className="space-y-4"
              aria-describedby={error ? ids.error : undefined}
            >
              {isSignUp && (
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.name}>{t("auth.name")}</Label>
                  <Input
                    id={ids.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={ids.email}>{t("auth.email")}</Label>
                <Input
                  id={ids.email}
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={ids.password}>{t("auth.password")}</Label>
                <Input
                  id={ids.password}
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  aria-describedby={isSignUp ? ids.passwordHint : undefined}
                  minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
                  required
                />
                {isSignUp && (
                  <p id={ids.passwordHint} className="text-xs text-muted-foreground">
                    {t("auth.passwordHint")}
                  </p>
                )}
              </div>
              {error && (
                <p
                  id={ids.error}
                  role="alert"
                  className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink"
                >
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" loading={submitting}>
                {t(isSignUp ? "auth.submitSignUp" : "auth.submitSignIn")}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t(isSignUp ? "auth.haveAccount" : "auth.noAccount")}{" "}
              <Link
                to={isSignUp ? "/sign-in" : "/sign-up"}
                state={location.state}
                className="font-medium text-primary hover:underline"
              >
                {t(isSignUp ? "auth.toSignIn" : "auth.toSignUp")}
              </Link>
            </p>
          </CardContent>
        </Card>
        <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
          {t("report.disclaimer")}
        </p>
      </main>
    </div>
  );
}
