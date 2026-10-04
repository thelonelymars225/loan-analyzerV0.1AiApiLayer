import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/report";

const FILL: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  good: "bg-good",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
};

interface ProgressProps {
  value: number;
  max?: number;
  tone?: Tone;
  /** Accessible name, e.g. "Legal compliance". */
  label: string;
  /** Spoken value, e.g. "72 out of 100". Defaults to the number. */
  valueText?: string;
  /** id of an element with more context, e.g. a "low confidence" note. */
  describedBy?: string;
  className?: string;
}

export function Progress({
  value,
  max = 100,
  tone = "info",
  label,
  valueText,
  describedBy,
  className,
}: ProgressProps) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-describedby={describedBy}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", FILL[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
