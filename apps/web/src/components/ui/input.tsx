import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { fieldClasses } from "./variants";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-primary",
        className,
      )}
      {...props}
    />
  );
}
