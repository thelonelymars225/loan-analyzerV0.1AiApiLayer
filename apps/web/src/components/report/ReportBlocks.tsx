import type { View, ViewDeadline, ViewFinding } from "@rater/contracts";
import { BookOpen, CalendarClock, CircleCheck, Info, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../lib/format";
import { findingAnchor } from "../../lib/report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

/** Employee view's first block: dates the employee must act by. */
export function DeadlinesBlock({ deadlines }: { deadlines: ViewDeadline[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Card aria-labelledby="deadlines-title">
      <CardHeader>
        <CardTitle id="deadlines-title" className="flex items-center gap-2">
          <CalendarClock aria-hidden="true" className="size-5 text-primary" />
          {t("report.deadlines")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("report.deadlinesEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {deadlines.map((deadline) => (
              <li
                key={`${deadline.ruleId}-${deadline.date}`}
                className="flex flex-col gap-1 rounded-lg bg-primary-soft px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <time
                  dateTime={deadline.date}
                  className="shrink-0 font-semibold tabular-nums"
                >
                  {formatDate(deadline.date, i18n.language)}
                </time>
                <div className="text-sm">
                  <p className="font-medium">
                    {t(`report.deadlineKind.${deadline.kind}`)}
                  </p>
                  <p dir="auto" className="text-muted-foreground">
                    {deadline.message}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** HR view's first block: clauses a court would likely not enforce, linked to their cards. */
export function LikelyVoidBlock({ findings }: { findings: ViewFinding[] }) {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby="likely-void-title" className="border-critical/30">
      <CardHeader>
        <CardTitle id="likely-void-title" className="flex items-center gap-2">
          <ShieldAlert aria-hidden="true" className="size-5 text-critical-ink" />
          {t("report.likelyVoid")}
        </CardTitle>
        <CardDescription>{t("report.likelyVoidIntro")}</CardDescription>
      </CardHeader>
      <CardContent>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("report.likelyVoidEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {findings.map((finding) => (
              <li
                key={findingAnchor(finding)}
                className="flex items-baseline gap-3 py-2 text-sm"
              >
                <span className="w-16 shrink-0 font-medium text-muted-foreground tabular-nums">
                  {finding.clause ?? "—"}
                </span>
                <a
                  href={`#${findingAnchor(finding)}`}
                  dir="auto"
                  className="font-medium text-primary hover:underline"
                >
                  {finding.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** "What's good": cards for the employee, a compact list for HR. */
export function GoodBlock({ findings, view }: { findings: ViewFinding[]; view: View }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="good-title">
      <h2 id="good-title" className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <CircleCheck aria-hidden="true" className="size-5 text-good-ink" />
        {t("report.good")}
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("report.goodEmpty")}</p>
      ) : view === "employee" ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {findings.map((finding) => (
            <li
              key={findingAnchor(finding)}
              className="rounded-xl border border-border bg-card p-4"
            >
              <p dir="auto" className="font-medium">
                {finding.title}
              </p>
              <p dir="auto" className="mt-1 text-sm text-muted-foreground">
                {finding.message}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {findings.map((finding) => (
            <li key={findingAnchor(finding)} className="px-4 py-2.5 text-sm">
              <bdi className="font-medium">{finding.title}</bdi>
              {finding.clause && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("report.clause", { clause: finding.clause })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Know your rights": info rules that apply whatever the contract says. */
export function RightsBlock({ findings }: { findings: ViewFinding[] }) {
  const { t } = useTranslation();
  if (findings.length === 0) return null;
  return (
    <section aria-labelledby="rights-title">
      <h2
        id="rights-title"
        className="mb-1 flex items-center gap-2 text-lg font-semibold"
      >
        <BookOpen aria-hidden="true" className="size-5 text-info-ink" />
        {t("report.rights")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("report.rightsIntro")}</p>
      <ul className="space-y-3">
        {findings.map((finding) => (
          <li
            key={findingAnchor(finding)}
            className="flex gap-3 rounded-xl bg-info-soft/60 p-4 text-sm"
          >
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-ink" />
            <div>
              <p dir="auto" className="font-medium">
                {finding.title}
              </p>
              <p dir="auto" className="mt-1 text-muted-foreground">
                {finding.message}
              </p>
              {finding.articles.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <bdi>{finding.articles.join(" · ")}</bdi>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
