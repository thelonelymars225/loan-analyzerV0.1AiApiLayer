import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { signOut } from "../../lib/auth";
import { cn } from "../../lib/cn";
import { useSession } from "../../lib/session";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast-context";
import { LanguageToggle } from "./LanguageToggle";

const NAV_ITEMS = [
  { to: "/", key: "nav.ratings", end: true },
  { to: "/account", key: "nav.account", end: false },
] as const;

/** API and admin pages, set apart at the end of the menu and shown only to those allowed. */
const PLATFORM_ITEMS = [
  { to: "/keys", key: "nav.apiKeys", show: "apiAccess", icon: KeyRound },
  { to: "/admin", key: "nav.admin", show: "isAdmin", icon: ShieldCheck },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-1.5 border-b-2 px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors",
    isActive
      ? "border-primary text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
  );

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { me } = useSession();
  const platformItems = PLATFORM_ITEMS.filter((item) => me[item.show]);
  const inAdmin = useLocation().pathname.startsWith("/admin");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.clear();
      void navigate("/sign-in");
    } catch {
      toast({ kind: "error", message: t("errors.network") });
      setSigningOut(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow"
      >
        {t("app.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
        {inAdmin && (
          <div className="flex items-center justify-center gap-2 bg-foreground px-4 py-2 text-sm font-medium text-background">
            <ShieldCheck aria-hidden="true" className="size-4" />
            {t("admin.banner")}
          </div>
        )}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <BrandMark />
            <span>{t("app.name")}</span>
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <LanguageToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onSignOut()}
              loading={signingOut}
            >
              {!signingOut && <LogOut aria-hidden="true" className="rtl:rotate-180" />}
              {t("nav.signOut")}
            </Button>
          </div>
          <nav
            aria-label={t("nav.main")}
            className="-mb-3 flex w-full gap-1 overflow-x-auto"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {t(item.key)}
              </NavLink>
            ))}
            {platformItems.length > 0 && (
              <div className="ms-auto flex gap-1 border-s border-border ps-2">
                {platformItems.map(({ to, key, icon: Icon }) => (
                  <NavLink key={to} to={to} className={navLinkClass}>
                    <Icon aria-hidden="true" className="size-4" />
                    {t(key)}
                  </NavLink>
                ))}
              </div>
            )}
          </nav>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6"
      >
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {t("report.disclaimer")}
      </footer>
    </div>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
      >
        <path d="M7 17l6 6 12-14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
