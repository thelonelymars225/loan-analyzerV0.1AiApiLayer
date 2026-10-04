import type { RatingStatus } from "@rater/contracts";
import { useTranslation } from "react-i18next";
import { isInProgress } from "../../lib/ratings";
import { STATUS_TONE } from "../../lib/report";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";

export function StatusChip({ status }: { status: RatingStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={STATUS_TONE[status]}>
      {isInProgress(status) && <Spinner className="size-3" />}
      {t(`status.${status}`)}
    </Badge>
  );
}
