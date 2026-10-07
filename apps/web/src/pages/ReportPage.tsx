import { View, type RatingReport } from "@rater/contracts";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DeleteRatingDialog } from "../components/ratings/DeleteRatingDialog";
import { StatusChip } from "../components/ratings/StatusChip";
import { RatingProgress } from "../components/report/RatingProgress";
import { ReportView } from "../components/report/ReportView";
import { ErrorState, LoadingState } from "../components/states/states";
import { Button } from "../components/ui/button";
import { buttonVariants } from "../components/ui/variants";
import { ApiError, api } from "../lib/api";
import { ratingErrorMessage } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { usePolling } from "../lib/live";
import { queryKeys } from "../lib/queries";
import { isInProgress, POLL_MS } from "../lib/ratings";

export function ReportPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // No ?view= means "the rating's default view"; the API decides and echoes it back.
  const parsedView = View.safeParse(searchParams.get("view"));
  const requestedView = parsedView.success ? parsedView.data : undefined;

  const rating = useQuery({
    queryKey: queryKeys.ratingView(id, requestedView, i18n.language),
    queryFn: () => api.getRating(id, requestedView),
    placeholderData: keepPreviousData, // keep the old view on screen while the other one loads
  });

  // Re-read the rating while it runs; polling stops once it is done, needs review or failed.
  usePolling(rating.refetch, isInProgress(rating.data?.status) ? POLL_MS : false);

  function changeView(view: View) {
    setSearchParams({ view }, { replace: true });
  }

  const report = rating.data;

  return (
    <div className="space-y-6">
      <title>{`${t("report.title")} · ${t("app.name")}`}</title>
      <div>
        <Link
          to="/"
          className={buttonVariants({
            variant: "link",
            size: "sm",
            className: "-ms-3 px-3",
          })}
        >
          <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
          {t("report.back")}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("report.title")}</h1>
          {report && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusChip status={report.status} />
              <span>
                {t("report.created", {
                  date: formatDateTime(report.createdAt, i18n.language),
                })}
              </span>
            </p>
          )}
        </div>
        {report && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t("ratings.delete")}
          </Button>
        )}
      </header>

      <ReportBody rating={rating} onViewChange={changeView} />

      <DeleteRatingDialog
        ratingId={id}
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onDeleted={() => void navigate("/")}
      />
    </div>
  );
}

interface ReportBodyProps {
  rating: UseQueryResult<RatingReport>;
  onViewChange: (view: View) => void;
}

/** Loading, error, in-progress, failed, or the finished report. */
function ReportBody({ rating, onViewChange }: ReportBodyProps) {
  const { t } = useTranslation();

  if (rating.isPending) return <LoadingState />;
  if (rating.isError) {
    const notFound = rating.error instanceof ApiError && rating.error.status === 404;
    return (
      <ErrorState
        error={rating.error}
        message={notFound ? t("report.notFound") : undefined}
        title={t("report.loadError")}
        onRetry={notFound ? undefined : () => void rating.refetch()}
      />
    );
  }

  const report = rating.data;
  if (isInProgress(report.status)) return <RatingProgress status={report.status} />;
  if (report.status === "failed") {
    return (
      <ErrorState
        title={t("report.failedTitle")}
        message={
          report.error ? ratingErrorMessage(t, report.error) : t("errors.rating_failed")
        }
      >
        <Link
          to="/"
          className={buttonVariants({
            variant: "secondary",
            size: "sm",
            className: "mt-2",
          })}
        >
          {t("report.tryAnother")}
        </Link>
      </ErrorState>
    );
  }
  return <ReportView report={report} onViewChange={onViewChange} />;
}
