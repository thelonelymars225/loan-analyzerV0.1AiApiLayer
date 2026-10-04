import type { View, ViewFinding } from "@rater/contracts";
import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SEVERITY_TONE, VERDICT_TONE, findingAnchor } from "../../lib/report";
import { Badge, ToneDot } from "../ui/badge";
import { ImpactTable } from "./ImpactTable";

interface FindingCardProps {
  finding: ViewFinding;
  view: View;
}

/** One problem finding. The API already picked the view's message and action. */
export function FindingCard({ finding, view }: FindingCardProps) {
  const { t } = useTranslation();
  const anchor = findingAnchor(finding);
  const titleId = `${anchor}-title`;

  return (
    <article
      id={anchor}
      aria-labelledby={titleId}
      className="scroll-mt-24 rounded-xl border border-border bg-card p-5 shadow-xs"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {finding.clause
              ? t("report.clause", { clause: finding.clause })
              : t("report.noClause")}
          </p>
          <h3 id={titleId} dir="auto" className="mt-0.5 font-semibold">
            {finding.title}
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={VERDICT_TONE[finding.verdict]}>
            {t(`verdict.${finding.verdict}`)}
          </Badge>
          <Badge outline>
            <ToneDot tone={SEVERITY_TONE[finding.severity]} />
            {t(`severity.${finding.severity}`)}
          </Badge>
          {finding.confidence === "low" && (
            <Badge outline>{t("report.lowConfidence")}</Badge>
          )}
        </div>
      </header>

      {finding.needsReview && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">{t("report.needsReview")}.</strong>{" "}
            {t("report.needsReviewHint")}
          </span>
        </p>
      )}

      <p dir="auto" className="mt-3 leading-relaxed">
        {finding.message}
      </p>

      {finding.impactSar && (
        <ImpactTable kind={finding.impactKind} sar={finding.impactSar} />
      )}

      {finding.action && (
        <div className="mt-4 rounded-lg border-s-4 border-primary bg-primary-soft px-4 py-3">
          <p className="text-xs font-semibold text-primary">
            {view === "employee" ? t("report.askFor") : t("report.suggestedWording")}
          </p>
          <p dir="auto" className="mt-1 text-sm leading-relaxed">
            {finding.action}
          </p>
        </div>
      )}

      <footer className="mt-4 flex flex-col gap-2 text-sm">
        {finding.articles.length > 0 && (
          <p>
            <span className="font-medium">{t("report.articles")}: </span>
            <bdi className="text-muted-foreground">{finding.articles.join(" · ")}</bdi>
          </p>
        )}
        {finding.explanation && (
          <details>
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {t("report.why")}
            </summary>
            <p dir="auto" className="mt-2 leading-relaxed text-muted-foreground">
              {finding.explanation}
            </p>
          </details>
        )}
      </footer>
    </article>
  );
}
