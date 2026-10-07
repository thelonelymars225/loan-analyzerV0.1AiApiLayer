import type { RatingStatus } from "@rater/contracts";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { PIPELINE_STEPS, progressPercent } from "../../lib/ratings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";

interface RatingProgressProps {
  status: RatingStatus;
}

/** Shown while the pipeline runs. The status line is a live region for screen readers. */
export function RatingProgress({ status }: RatingProgressProps) {
  const { t } = useTranslation();
  const currentIndex = PIPELINE_STEPS.indexOf(status as (typeof PIPELINE_STEPS)[number]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner className="size-5 text-primary" />
          {t("report.inProgressTitle")}
        </CardTitle>
        <CardDescription>{t("report.inProgressBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Progress value={progressPercent(status)} label={t("report.progressLabel")} />
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {t("ratings.statusLive", { status: t(`status.${status}`) })}
        </p>
        <ol className="space-y-2">
          {PIPELINE_STEPS.map((step, index) => {
            const done = index < currentIndex;
            const current = index === currentIndex;
            return (
              <li
                key={step}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-3 text-sm",
                  done || current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-xs",
                    done && "border-primary bg-primary text-primary-foreground",
                    current && "border-primary text-primary",
                    !done && !current && "border-border",
                  )}
                >
                  {done ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
                </span>
                {t(`report.steps.${step}`)}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
