import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { ToastContext, type ToastInput, type ToastKind } from "./toast-context";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const DISMISS_AFTER_MS = 6000;

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;

const KIND_CLASSES: Record<ToastKind, string> = {
  success: "[&>svg]:text-good-ink",
  error: "border-critical/40 [&>svg]:text-critical-ink",
  info: "[&>svg]:text-info-ink",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => [
      ...current.slice(-2),
      { id, kind: input.kind ?? "info", message: input.message },
    ]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* One live region, always mounted, so screen readers announce each toast once. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[toast.kind];

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm shadow-lg",
        KIND_CLASSES[toast.kind],
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t("common.dismiss")}
        className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
