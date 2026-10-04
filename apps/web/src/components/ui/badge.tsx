import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/report";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-soft text-info-ink",
  good: "bg-good-soft text-good-ink",
  warning: "bg-warning-soft text-warning-ink",
  serious: "bg-serious-soft text-serious-ink",
  critical: "bg-critical-soft text-critical-ink",
};

interface BadgeProps extends ComponentProps<"span"> {
  tone?: Tone;
  outline?: boolean;
}

export function Badge({
  tone = "neutral",
  outline = false,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        outline
          ? "border border-border bg-transparent text-foreground"
          : TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}

const DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info-ink",
  good: "bg-good",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
};

/** A small coloured dot that sits before a label; never used without text. */
export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 rounded-full", DOT_CLASSES[tone], className)}
    />
  );
}
