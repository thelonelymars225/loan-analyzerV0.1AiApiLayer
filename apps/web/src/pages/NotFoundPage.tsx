import { FileQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { EmptyState } from "../components/states/states";
import { buttonVariants } from "../components/ui/variants";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FileQuestion}
      title={t("common.notFoundTitle")}
      description={t("common.notFoundBody")}
    >
      <Link
        to="/"
        className={buttonVariants({
          variant: "secondary",
          size: "sm",
          className: "mt-2",
        })}
      >
        {t("common.goHome")}
      </Link>
    </EmptyState>
  );
}
