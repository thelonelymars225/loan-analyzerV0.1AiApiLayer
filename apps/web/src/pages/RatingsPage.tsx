import { DEFAULT_RETENTION_DAYS } from "@rater/contracts";
import { useTranslation } from "react-i18next";
import { RatingsList } from "../components/ratings/RatingsList";
import { UploadCard } from "../components/ratings/UploadCard";

export function RatingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <title>{`${t("nav.ratings")} · ${t("app.name")}`}</title>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("ratings.title")}</h1>
        <p className="text-muted-foreground">{t("ratings.intro")}</p>
      </header>
      <UploadCard defaultView="employee" retentionDays={DEFAULT_RETENTION_DAYS} />
      <section aria-labelledby="recent-title" className="space-y-4">
        <h2 id="recent-title" className="text-lg font-semibold">
          {t("ratings.recent")}
        </h2>
        <RatingsList />
      </section>
    </div>
  );
}
