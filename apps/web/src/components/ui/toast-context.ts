import { createContext, useContext } from "react";

export type ToastKind = "success" | "error" | "info";

export interface ToastInput {
  kind?: ToastKind;
  message: string;
}

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Returns `toast({ kind, message })`. Messages must already be translated. */
export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
