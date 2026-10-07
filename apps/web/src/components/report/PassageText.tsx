import type { Passage } from "@rater/contracts";
import { useTranslation } from "react-i18next";

/**
 * The clause as it was rated, Arabic first because it prevails (clause 14.7). Shown wherever
 * the page image cannot be: once the PDF is deleted, or when the image fails to load.
 */
export function PassageText({ passage, note }: { passage: Passage; note?: string }) {
  const { t } = useTranslation();
  const hasText = passage.textAr || passage.textEn;
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
      {hasText ? (
        <dl className="space-y-2">
          {passage.textAr && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t("report.passage.arabic")}
              </dt>
              <dd dir="rtl" lang="ar" className="mt-0.5 leading-relaxed">
                {passage.textAr}
              </dd>
            </div>
          )}
          {passage.textEn && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t("report.passage.english")}
              </dt>
              <dd dir="ltr" lang="en" className="mt-0.5 leading-relaxed">
                {passage.textEn}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-muted-foreground">{t("report.passage.noText")}</p>
      )}
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
