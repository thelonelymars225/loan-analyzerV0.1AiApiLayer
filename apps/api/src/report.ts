import { asc, eq } from "drizzle-orm";
import { ContractFields, Finding } from "@rater/contracts";
import type { RatingReport, Versions, View } from "@rater/contracts";
import { renderReport } from "@rater/core";
import { contractFields, findings } from "@rater/db";
import type { Db, ratings } from "@rater/db";
import { loadRules } from "@rater/law";

export type RatingRow = typeof ratings.$inferSelect;
export type Locale = "en" | "ar";

/**
 * Renders a rating as a report in one view. Works for every status: while the rating is
 * running there are no findings yet and `score` is null; a failed rating carries `error`.
 */
export async function loadReport(
  db: Db,
  rating: RatingRow,
  view: View,
  locale: Locale,
): Promise<RatingReport> {
  const [findingRows, fieldRows] = await Promise.all([
    db
      .select()
      .from(findings)
      .where(eq(findings.ratingId, rating.id))
      .orderBy(asc(findings.position), asc(findings.id)),
    db.select().from(contractFields).where(eq(contractFields.ratingId, rating.id)),
  ]);

  return renderReport({
    id: rating.id,
    status: rating.status,
    view,
    createdAt: rating.createdAt.toISOString(),
    finishedAt: rating.finishedAt?.toISOString() ?? null,
    error: ratingError(rating),
    findings: findingRows.map(toFinding),
    deadlines: rating.deadlines ?? [],
    fields: toContractFields(fieldRows),
    versions: ratingVersions(rating),
    rules: loadRules().rules,
    locale,
    // Why a needs_review rating needs a human look; stored by the worker.
    reviewReasons: rating.reviewReasons ?? [],
  });
}

/** The reader's language from Accept-Language: Arabic when it is the first choice. */
export function preferredLocale(acceptLanguage: string | undefined): Locale {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("ar") ? "ar" : "en";
}

function ratingError(rating: RatingRow): RatingReport["error"] {
  if (rating.status !== "failed") return null;
  return {
    code: rating.errorCode ?? "internal",
    message: rating.error ?? "The rating could not be completed.",
  };
}

function ratingVersions(rating: RatingRow): Versions | null {
  const { lawVersion, rulesetVersion, promptVersion, model } = rating;
  if (!lawVersion || !rulesetVersion || !promptVersion || !model) return null;
  return { law: lawVersion, ruleset: rulesetVersion, prompt: promptVersion, model };
}

function toFinding(row: typeof findings.$inferSelect): Finding {
  return Finding.parse({
    ruleId: row.ruleId,
    clause: row.clauseRef,
    verdict: row.verdict,
    severity: row.severity,
    confidence: row.confidence,
    categories: row.categories,
    articles: row.articles,
    impact: row.impact,
    explanation: row.explanation,
    employeeMsg: row.employeeMsg,
    hrMsg: row.hrMsg,
    askFor: row.askFor ?? undefined,
    suggestedWording: row.suggestedWording ?? undefined,
    source: row.source,
    needsReview: row.needsReview,
  });
}

/** Fields the worker did not store read as "not found". */
const EMPTY_FIELDS: ContractFields = {
  contractType: "unknown",
  contractTypeRaw: null,
  executionDate: null,
  commencementDate: null,
  endDate: null,
  termMonths: null,
  autoRenew: null,
  renewalNoticeDays: null,
  probationDays: null,
  probationExcludedDays: [],
  workDaysPerWeek: null,
  dailyHours: null,
  weeklyHours: null,
  restDaysPerWeek: null,
  annualLeaveDays: null,
  wage: null,
  overtimePremiumPct: null,
  nationality: null,
  occupation: null,
  workLocation: null,
};

/** contract_fields holds one row per field; null until extraction has run. */
function toContractFields(
  rows: (typeof contractFields.$inferSelect)[],
): ContractFields | null {
  if (rows.length === 0) return null;
  const stored = Object.fromEntries(rows.map((row) => [row.field, row.value]));
  return ContractFields.parse({ ...EMPTY_FIELDS, ...stored });
}
