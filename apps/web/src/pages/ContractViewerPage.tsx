import {
  View,
  type Passage,
  type RatingReport,
  type ReportDocument,
} from "@rater/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { PassageText } from "../components/report/PassageText";
import { ErrorState, LoadingState } from "../components/states/states";
import { buttonVariants } from "../components/ui/variants";
import { ContractPages } from "../components/viewer/ContractPages";
import { IssuesPanel } from "../components/viewer/IssuesPanel";
import { ApiError, api, apiUrls } from "../lib/api";
import { formatDate } from "../lib/format";
import { queryKeys } from "../lib/queries";
import { isInProgress } from "../lib/ratings";
import {
  DEFAULT_PAGE_SIZE,
  focusFromParams,
  focusParams,
  pageMarks,
  pageSizes,
  tabFromParams,
  viewerItems,
  type PageMark,
  type ViewerItem,
  type ViewerTab,
} from "../lib/viewer";

/**
 * The contract as the rater saw it: every page, with each finding marked where it is, and a
 * side panel that works as a table of contents for the findings. The URL carries the view,
 * the tab and the focused passage, so a link from a report card lands on the right lines.
 */
export function ContractViewerPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();

  const parsedView = View.safeParse(params.get("view"));
  const requestedView = parsedView.success ? parsedView.data : undefined;
  const rating = useQuery({
    queryKey: queryKeys.ratingView(id, requestedView, i18n.language),
    queryFn: () => api.getRating(id, requestedView),
  });

  return (
    <div className="space-y-4">
      <title>{`${t("viewer.title")} · ${t("app.name")}`}</title>
      <Link
        to={{
          pathname: `/ratings/${id}`,
          search: requestedView ? `?view=${requestedView}` : "",
        }}
        className={buttonVariants({
          variant: "link",
          size: "sm",
          className: "-ms-3 px-3",
        })}
      >
        <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
        {t("viewer.backToReport")}
      </Link>
      <ViewerBody rating={rating} />
    </div>
  );
}

function ViewerBody({ rating }: { rating: ReturnType<typeof useQuery<RatingReport>> }) {
  const { t } = useTranslation();
  if (rating.isPending) return <LoadingState />;
  if (rating.isError) {
    const notFound = rating.error instanceof ApiError && rating.error.status === 404;
    return (
      <ErrorState
        error={rating.error}
        title={t("viewer.loadError")}
        message={notFound ? t("report.notFound") : undefined}
        onRetry={notFound ? undefined : () => void rating.refetch()}
      />
    );
  }
  const report = rating.data;
  if (isInProgress(report.status) || report.status === "failed") {
    return <ErrorState title={t("viewer.title")} message={t("viewer.notReady")} />;
  }
  return <Viewer report={report} />;
}

function Viewer({ report }: { report: RatingReport }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const items = useMemo(() => viewerItems(report), [report]);
  const everyItem = useMemo(() => [...items.issues, ...items.good], [items]);
  const focus = focusFromParams(params, everyItem);
  // A focused item decides the tab, so a link to a positive finding opens "What's good".
  const tab: ViewerTab =
    everyItem.find((item) => item.id === focus?.itemId)?.tab ?? tabFromParams(params);
  const marks = pageMarks(items[tab], focus);
  const pages = report.document.pages ?? 0;
  const sizes = useMemo(() => pageSizes(everyItem, pages), [everyItem, pages]);

  /** Changes the URL's viewer state, keeping the view. */
  function update(changes: Record<string, string | null>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }
  function select(item: ViewerItem, passage: Passage | null = item.passage) {
    update({ tab: item.tab, ...focusParams(item, passage) });
  }
  function selectMark(mark: PageMark) {
    const item = everyItem.find((candidate) => candidate.id === mark.itemId);
    if (item) select(item, mark.passage);
  }
  function changeTab(next: ViewerTab) {
    update({ tab: next, focus: null, clause: null, page: null });
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("viewer.title")}</h1>
          {pages > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("viewer.pages", { count: pages })}
            </p>
          )}
        </div>
        {report.document.available && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={apiUrls.document(report.id, "inline")}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <ExternalLink aria-hidden="true" />
              {t("viewer.openPdf")}
            </a>
            <a
              href={apiUrls.document(report.id, "attachment")}
              download
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Download aria-hidden="true" />
              {t("viewer.download")}
            </a>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="lg:sticky lg:top-20 lg:order-2">
          <IssuesPanel
            ratingId={report.id}
            view={report.view}
            items={items}
            tab={tab}
            onTabChange={changeTab}
            selectedId={focus?.itemId ?? null}
            onSelect={select}
          />
        </div>
        <div className="lg:order-1">
          {report.document.available ? (
            <ContractPages
              ratingId={report.id}
              sizes={sizes.length > 0 ? sizes : [DEFAULT_PAGE_SIZE]}
              marks={marks}
              onSelect={selectMark}
            />
          ) : (
            <TextOnlyPages items={items[tab]} document={report.document} />
          )}
        </div>
      </div>
    </>
  );
}

/** What the viewer can still show once the PDF is deleted: the clause text as it was rated. */
function TextOnlyPages({
  items,
  document,
}: {
  items: ViewerItem[];
  document: ReportDocument;
}) {
  const { t, i18n } = useTranslation();
  const placed = items.filter((item) => item.finding.passages.length > 0);
  return (
    <div className="space-y-4">
      <div
        role="note"
        className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm"
      >
        <p className="font-medium">{t("viewer.textOnlyTitle")}</p>
        <p className="mt-1 text-muted-foreground">
          {document.deletedAt
            ? t("viewer.textOnlyBody", {
                date: formatDate(document.deletedAt, i18n.language),
              })
            : t("viewer.textOnlyBodyNoDate")}
        </p>
      </div>
      <ol className="space-y-4">
        {placed.map((item) => (
          <li key={item.id} id={`viewer-${item.id}`} className="space-y-2">
            <p dir="auto" className="text-sm font-medium">
              {item.number !== null && (
                <span className="me-1.5 tabular-nums">{item.number}.</span>
              )}
              {item.finding.title}
            </p>
            {item.finding.passages.map((passage) => (
              <PassageText key={`${passage.clause}-${passage.page}`} passage={passage} />
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
