import type { RatingSummary } from "@rater/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { usePolling, useRatingEvents } from "../../lib/live";
import { queryKeys } from "../../lib/queries";
import { isInProgress, pollInterval } from "../../lib/ratings";
import { BAND_TONE } from "../../lib/report";
import { EmptyState, ErrorState, LoadingState } from "../states/states";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DeleteRatingDialog } from "./DeleteRatingDialog";
import { StatusChip } from "./StatusChip";

export function RatingsList({ orgId }: { orgId: string }) {
  const { t } = useTranslation();

  const ratings = useInfiniteQuery({
    queryKey: queryKeys.ratingsList(orgId),
    queryFn: ({ pageParam }) => api.listRatings(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = ratings.data?.pages.flatMap((page) => page.items) ?? [];
  // Rows still running get live status over SSE, with polling as the fallback.
  const runningIds = items
    .filter((item) => isInProgress(item.status))
    .map((item) => item.id);
  const { live } = useRatingEvents(runningIds);
  usePolling(ratings.refetch, pollInterval(runningIds.length > 0, live));

  if (ratings.isPending) return <LoadingState />;
  if (ratings.isError) {
    return (
      <ErrorState
        error={ratings.error}
        title={t("ratings.loadError")}
        onRetry={() => void ratings.refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t("ratings.empty")}
        description={t("ratings.emptyHint")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ul
        aria-label={t("ratings.listLabel")}
        className="divide-y divide-border rounded-xl border border-border bg-card"
      >
        {items.map((rating) => (
          <RatingRow key={rating.id} rating={rating} />
        ))}
      </ul>
      {ratings.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void ratings.fetchNextPage()}
            loading={ratings.isFetchingNextPage}
          >
            {t("ratings.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function RatingRow({ rating }: { rating: RatingSummary }) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const created = formatDateTime(rating.createdAt, i18n.language);

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Link
        to={`/ratings/${rating.id}`}
        className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 rounded-md focus-visible:outline-offset-4"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-medium group-hover:text-primary">
            {t("ratings.ratingOf", { date: created })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(`ratings.view.${rating.defaultView}`)}
          </span>
        </span>
        <span className="ms-auto flex items-center gap-3">
          <StatusChip status={rating.status} />
          {rating.scoreOverall !== null && rating.band ? (
            <span className="flex items-center gap-2">
              <span
                className="text-lg font-semibold tabular-nums"
                aria-label={t("ratings.scoreLabel", { score: rating.scoreOverall })}
              >
                {rating.scoreOverall}
              </span>
              <Badge tone={BAND_TONE[rating.band]}>{t(`band.${rating.band}`)}</Badge>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{t("ratings.noScore")}</span>
          )}
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground rtl:rotate-180"
          />
        </span>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirming(true)}
        aria-label={t("ratings.deleteNamed", {
          name: t("ratings.ratingOf", { date: created }),
        })}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <DeleteRatingDialog
        ratingId={rating.id}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}
