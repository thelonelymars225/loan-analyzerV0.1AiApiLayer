import type { RatingReport, Versions, View } from "@rater/contracts";
import { Scale, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../lib/format";
import { likelyVoidFindings } from "../../lib/report";
import { EmptyState } from "../states/states";
import { Tabs } from "../ui/tabs";
import { FindingCard } from "./FindingCard";
import { DeadlinesBlock, GoodBlock, LikelyVoidBlock, RightsBlock } from "./ReportBlocks";
import { ScoreSummary } from "./ScoreSummary";

const VIEWS: readonly View[] = ["employee", "hr"];
const CONTENT_ID = "report-content";

interface ReportViewProps {
  report: RatingReport;
  onViewChange: (view: View) => void;
}

/**
 * A finished rating in one view. Both views get the same findings from the API, already
 * ordered and worded for the view; this component only changes what leads and how it is
 * labelled: deadlines first for the employee, likely-void clauses first for HR.
 */
export function ReportView({ report, onViewChange }: ReportViewProps) {
  const { t } = useTranslation();
  const view = report.view;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">
          {t(`report.viewIntro.${view}`)}
        </p>
        <Tabs
          label={t("report.viewLabel")}
          items={VIEWS.map((value) => ({ value, label: t(`report.views.${value}`) }))}
          value={view}
          onValueChange={onViewChange}
          controls={CONTENT_ID}
          className="self-start sm:self-auto"
        />
      </div>

      <div id={CONTENT_ID} className="space-y-8">
        {report.status === "needs_review" && (
          <NeedsReviewNote reasons={report.reviewReasons} />
        )}

        {report.score && <ScoreSummary score={report.score} view={view} />}

        {view === "employee" ? (
          <DeadlinesBlock deadlines={report.deadlines} />
        ) : (
          <LikelyVoidBlock findings={likelyVoidFindings(report.findings)} />
        )}

        <section aria-labelledby="findings-title">
          <h2
            id="findings-title"
            className="mb-3 flex items-center gap-2 text-lg font-semibold"
          >
            {t("report.findings")}
            <span className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
              {report.findings.length}
            </span>
          </h2>
          {report.findings.length === 0 ? (
            <EmptyState icon={Scale} title={t("report.findingsEmpty")} />
          ) : (
            <ol className="space-y-4">
              {report.findings.map((finding) => (
                <li key={`${finding.ruleId}-${finding.clause ?? ""}`}>
                  <FindingCard
                    finding={finding}
                    view={view}
                    ratingId={report.id}
                    document={report.document}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        {view === "hr" && report.deadlines.length > 0 && (
          <DeadlinesBlock deadlines={report.deadlines} />
        )}

        <GoodBlock findings={report.good} view={view} />
        <RightsBlock findings={report.info} />
        <ReportFooter report={report} />
      </div>
    </div>
  );
}

/** Why a person should check this rating, in the API's words (unread values, unclear clauses). */
function NeedsReviewNote({ reasons }: { reasons: string[] }) {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-warning-ink"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-2">
        <p>{t("report.needsReviewBanner")}</p>
        {reasons.length > 0 && (
          <ul aria-label={t("report.reviewReasons")} className="list-disc space-y-1 ps-5">
            {reasons.map((reason, index) => (
              // The list never reorders, and two reasons may read the same.
              <li key={index} dir="auto">
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ReportFooter({ report }: { report: RatingReport }) {
  const { t, i18n } = useTranslation();
  return (
    <footer className="space-y-2 border-t border-border pt-6 text-xs text-muted-foreground">
      <p className="text-sm font-medium text-foreground">{t("report.disclaimer")}</p>
      {report.versions && <VersionsLine versions={report.versions} />}
      {report.finishedAt && (
        <p>
          {t("report.finished", {
            date: formatDateTime(report.finishedAt, i18n.language),
          })}
        </p>
      )}
    </footer>
  );
}

const VERSION_PARTS: (keyof Versions)[] = ["law", "ruleset", "prompt", "model"];

/** "Law 2025-11 · Rules 0.1.0 · …". Values sit in <bdi> so "2025-11" stays intact in Arabic. */
function VersionsLine({ versions }: { versions: Versions }) {
  const { t } = useTranslation();
  return (
    <p>
      <span className="sr-only">{t("report.versionsLabel")}: </span>
      {VERSION_PARTS.map((part, index) => (
        <span key={part}>
          {index > 0 && " · "}
          {t(`report.version.${part}`)} <bdi>{versions[part]}</bdi>
        </span>
      ))}
    </p>
  );
}
