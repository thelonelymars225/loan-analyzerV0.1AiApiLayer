import type { ScoreCategory, View, ViewScore } from "@rater/contracts";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { BAND_TONE, type Tone } from "../../lib/report";
import { bandForScore } from "../../lib/ratings";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Progress } from "../ui/progress";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ARC: Record<Tone, string> = {
  neutral: "stroke-muted-foreground",
  info: "stroke-primary",
  good: "stroke-good",
  warning: "stroke-warning",
  serious: "stroke-serious",
  critical: "stroke-critical",
};

// The unfilled track is a lighter step of the same hue, so the band reads across the dial.
const TRACK: Record<Tone, string> = {
  neutral: "stroke-muted",
  info: "stroke-primary-soft",
  good: "stroke-good-soft",
  warning: "stroke-warning-soft",
  serious: "stroke-serious-soft",
  critical: "stroke-critical-soft",
};

const CATEGORIES: ScoreCategory[] = ["legal", "market", "clarity"];

export function ScoreSummary({ score, view }: { score: ViewScore; view: View }) {
  const { t } = useTranslation();
  const tone = BAND_TONE[score.band];
  const band = t(`band.${score.band}`);

  return (
    <Card className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10 sm:p-6">
      <div className="flex items-center gap-5 sm:flex-col sm:gap-3">
        <div
          role="img"
          aria-label={t("report.scoreLabel", { score: score.overall, band })}
          className="relative size-32 shrink-0 sm:size-36"
        >
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              className={TRACK[tone]}
            />
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - score.overall / 100)}
              className={cn(ARC[tone], "transition-[stroke-dashoffset] duration-700")}
            />
          </svg>
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            aria-hidden="true"
          >
            <span className="text-4xl leading-none font-semibold">{score.overall}</span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("report.outOf")}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-center">
          <Badge tone={tone} className="text-sm">
            {band}
          </Badge>
          <p className="text-sm font-medium sm:text-center">
            {t(`report.question.${view}`)}
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
          {t("report.subScores")}
        </h2>
        <ul className="space-y-4">
          {CATEGORIES.map((category) => (
            <SubScoreBar
              key={category}
              category={category}
              value={score[category]}
              lowConfidence={category === "market" && score.marketConfidence === "low"}
            />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function SubScoreBar({
  category,
  value,
  lowConfidence,
}: {
  category: ScoreCategory;
  value: number;
  lowConfidence: boolean;
}) {
  const { t } = useTranslation();
  const label = t(`report.category.${category}`);
  const hintId = `subscore-${category}-hint`;
  return (
    <li>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {label}
          {lowConfidence && <Badge tone="neutral">{t("report.lowConfidence")}</Badge>}
        </span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <Progress
        value={value}
        label={label}
        valueText={t("report.outOfValue", { value })}
        tone={BAND_TONE[bandForScore(value)]}
        describedBy={lowConfidence ? hintId : undefined}
      />
      {lowConfidence && (
        <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
          {t("report.lowConfidenceHint")}
        </p>
      )}
    </li>
  );
}
