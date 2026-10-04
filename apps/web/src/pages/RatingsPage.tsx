import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RatingsList } from "../components/ratings/RatingsList";
import { UploadCard } from "../components/ratings/UploadCard";
import { EmptyState } from "../components/states/states";
import { defaultViewFor } from "../lib/ratings";
import { useSession } from "../lib/session";

export function RatingsPage() {
  const { t } = useTranslation();
  const { activeOrg } = useSession();

  if (!activeOrg) {
    return (
      <EmptyState
        icon={Building2}
        title={t("workspace.none")}
        description={t("workspace.noneHint")}
      />
    );
  }

  const isCompany = activeOrg.kind === "company";

  return (
    <div className="space-y-8">
      <title>{`${t("nav.ratings")} · ${t("app.name")}`}</title>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {isCompany ? t("ratings.titleCompany") : t("ratings.title")}
        </h1>
        <p className="text-muted-foreground">
          {isCompany ? t("ratings.introCompany") : t("ratings.intro")}
        </p>
      </header>
      {/* Keyed by org: a new workspace starts with its own default view. */}
      <UploadCard
        key={activeOrg.id}
        defaultView={defaultViewFor(activeOrg.kind)}
        retentionDays={activeOrg.retentionDays}
      />
      <section aria-labelledby="recent-title" className="space-y-4">
        <h2 id="recent-title" className="text-lg font-semibold">
          {t("ratings.recent")}
        </h2>
        <RatingsList orgId={activeOrg.id} />
      </section>
    </div>
  );
}
