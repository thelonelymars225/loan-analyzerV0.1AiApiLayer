import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { buttonVariants, type ButtonVariantProps } from "./variants";
import { Spinner } from "./spinner";

interface ButtonProps extends ComponentProps<"button">, ButtonVariantProps {
  /** Shows a spinner and disables the button while an action runs. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
