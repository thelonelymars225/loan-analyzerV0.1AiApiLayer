import type { Passage, ReportDocument } from "@rater/contracts";
import type { TFunction } from "i18next";
import { FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiUrls } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/format";
import { cropAspectRatio, highlightInset, isSectionNumber } from "../../lib/passages";
import type { Tone } from "../../lib/report";

interface PassagePreviewProps {
  ratingId: string;
  /** The finding's passages: its own clause first, then any related clause. */
  passages: Passage[];
  document: ReportDocument;
  /** Colour of the highlight: the finding's severity, or "good" on a positive finding. */
  tone: Tone;
}

/** Highlight colours: a translucent fill so the words stay readable, and a ring for contrast. */
const HIGHLIGHT_CLASSES: Record<Tone, string> = {
  neutral: "bg-primary/15 ring-primary",
  info: "bg-primary/15 ring-primary",
  good: "bg-good/15 ring-good",
  warning: "bg-warning/25 ring-warning",
  serious: "bg-serious/20 ring-serious",
  critical: "bg-critical/15 ring-critical",
};

/**
 * The place in the contract a finding is about: a crop of the page with the clause marked, so
 * the reader can check the verdict against the contract without leaving the report. When the
 * PDF is gone (retention) or the image fails, the clause text as it was rated is shown instead.
 */
export function PassagePreview({
  ratingId,
  passages,
  document,
  tone,
}: PassagePreviewProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(0);
  const passage = passages[selected] ?? passages[0];
  if (!passage) return null;

  return (
    <figure className="mt-4">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <FileText aria-hidden="true" className="size-3.5" />
          {t("report.passage.label")}
        </span>
        {passages.length > 1 ? (
          <PassagePicker passages={passages} selected={selected} onSelect={setSelected} />
        ) : (
          <span>{passageLabel(passage, t)}</span>
        )}
        <span className="ms-auto tabular-nums">
          {t("report.passage.page", { page: passage.page })}
        </span>
      </figcaption>

      {document.available ? (
        <PassageImage
          key={`${passage.clause}-${passage.page}`}
          ratingId={ratingId}
          passage={passage}
          tone={tone}
        />
      ) : (
        <PassageText passage={passage} note={deletedNote(document, t, i18n.language)} />
      )}

      {passage.approximate && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("report.passage.approximate", { clause: passageLabel(passage, t) })}
        </p>
      )}
    </figure>
  );
}

/** Switches between a finding's passages (a conflict shows its clause and the one it contradicts). */
function PassagePicker({
  passages,
  selected,
  onSelect,
}: {
  passages: Passage[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <span role="group" aria-label={t("report.passage.pick")} className="flex gap-1">
      {passages.map((passage, index) => (
        <button
          key={`${passage.clause}-${passage.page}`}
          type="button"
          aria-pressed={index === selected}
          onClick={() => onSelect(index)}
          className={cn(
            "rounded-full border px-2 py-0.5 font-medium transition-colors",
            index === selected
              ? "border-primary bg-primary-soft text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {passageLabel(passage, t)}
        </button>
      ))}
    </span>
  );
}

/** The crop from the API with the clause's box drawn over it; falls back to text if it fails. */
function PassageImage({
  ratingId,
  passage,
  tone,
}: {
  ratingId: string;
  passage: Passage;
  tone: Tone;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");

  if (state === "failed") {
    return <PassageText passage={passage} note={t("report.passage.unavailable")} />;
  }
  return (
    // The page is always white, like paper, whatever the app's theme.
    <div
      className="relative overflow-hidden rounded-lg border border-border bg-white"
      style={{ aspectRatio: cropAspectRatio(passage) }}
    >
      {state === "loading" && (
        <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-muted" />
      )}
      <img
        src={apiUrls.passageImage(ratingId, passage.clause, passage.page)}
        alt={t("report.passage.alt", { clause: passage.clause, page: passage.page })}
        loading="lazy"
        decoding="async"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className="block h-full w-full"
      />
      {state === "loaded" && (
        <span
          aria-hidden="true"
          data-testid="passage-highlight"
          className={cn("absolute rounded-sm ring-2 ring-inset", HIGHLIGHT_CLASSES[tone])}
          style={highlightInset(passage)}
        />
      )}
    </div>
  );
}

/** The clause as it was rated, Arabic first because it prevails (clause 14.7). */
function PassageText({ passage, note }: { passage: Passage; note: string }) {
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
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** "Clause 15.4" or "Section 1". */
function passageLabel(passage: Passage, t: TFunction): string {
  return isSectionNumber(passage.clause)
    ? t("report.passage.section", { clause: passage.clause })
    : t("report.clause", { clause: passage.clause });
}

/** Why there is no image: the PDF was deleted (by retention or by hand), with the date if known. */
function deletedNote(document: ReportDocument, t: TFunction, language: string): string {
  return document.deletedAt
    ? t("report.passage.deletedOn", { date: formatDate(document.deletedAt, language) })
    : t("report.passage.deleted");
}
