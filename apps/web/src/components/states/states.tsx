import { CircleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 py-12 text-muted-foreground",
        className,
      )}
    >
      <Spinner />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

interface ErrorStateProps {
  error?: unknown;
  /** Already-translated message; overrides the one derived from `error`. */
  message?: string;
  title?: string;
  onRetry?: () => void;
  children?: ReactNode;
  className?: string;
}

export function ErrorState({
  error,
  message,
  title,
  onRetry,
  children,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-critical/30 bg-critical-soft/40 px-6 py-10 text-center",
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="size-6 text-critical-ink" />
      {title && <p className="font-semibold">{title}</p>}
      <p className="max-w-prose text-sm text-muted-foreground">
        {message ?? errorMessage(t, error)}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
      {children}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}
