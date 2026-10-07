import type { Passage, View } from "@rater/contracts";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { isSectionNumber } from "../../lib/passages";
import { PIN_CLASSES, SEVERITY_TONE } from "../../lib/report";
import { VIEWER_TABS, type ViewerItem, type ViewerTab } from "../../lib/viewer";
import { Badge, ToneDot } from "../ui/badge";
import { Tabs } from "../ui/tabs";

interface IssuesPanelProps {
  ratingId: string;
  view: View;
  items: Record<ViewerTab, ViewerItem[]>;
  tab: ViewerTab;
  onTabChange: (tab: ViewerTab) => void;
  selectedId: string | null;
  onSelect: (item: ViewerItem, passage?: Passage) => void;
}

const LIST_ID = "viewer-items";

/**
 * The table of contents for the comments: Issues (by severity) and What's good.
 * Choosing an item marks it on the page and scrolls to it.
 */
export function IssuesPanel({
  ratingId,
  view,
  items,
  tab,
  onTabChange,
  selectedId,
  onSelect,
}: IssuesPanelProps) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t("viewer.panelLabel")}
      className="flex flex-col rounded-xl border border-border bg-card shadow-xs"
    >
      <div className="space-y-3 border-b border-border p-3">
        <Tabs
          label={t("viewer.panelLabel")}
          items={VIEWER_TABS.map((value) => ({
            value,
            label: `${t(`viewer.tabs.${value}`)} (${items[value].length})`,
          }))}
          value={tab}
          onValueChange={onTabChange}
          controls={LIST_ID}
          className="w-full [&>button]:flex-1"
        />
        {items[tab].length === 0 && (
          <p className="text-xs text-muted-foreground">{t(`viewer.empty.${tab}`)}</p>
        )}
      </div>

      <ol
        id={LIST_ID}
        className="max-h-[45dvh] divide-y divide-border overflow-y-auto lg:max-h-none"
      >
        {items[tab].map((item) => (
          <li key={item.id}>
            <PanelItem
              item={item}
              selected={item.id === selectedId}
              onSelect={onSelect}
              reportLink={`/ratings/${ratingId}?view=${view}#${item.id}`}
            />
          </li>
        ))}
      </ol>
    </aside>
  );
}

function PanelItem({
  item,
  selected,
  onSelect,
  reportLink,
}: {
  item: ViewerItem;
  selected: boolean;
  onSelect: (item: ViewerItem, passage?: Passage) => void;
  reportLink: string;
}) {
  const { t } = useTranslation();
  const { finding } = item;
  const tone = item.tab === "good" ? "good" : SEVERITY_TONE[finding.severity];
  const where = item.passage
    ? `${passageLabel(item.passage.clause, t)} · ${t("report.passage.page", { page: item.passage.page })}`
    : t("viewer.notLocated");

  return (
    <div className={cn("px-3 py-2.5", selected && "bg-primary-soft/50")}>
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
        aria-expanded={selected}
        className="flex w-full items-start gap-3 text-start"
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            item.number === null ? "bg-muted text-muted-foreground" : PIN_CLASSES[tone],
          )}
        >
          {item.number ?? "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block text-sm font-medium">
            {finding.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {item.tab === "issues" && (
              <span className="flex items-center gap-1">
                <ToneDot tone={SEVERITY_TONE[finding.severity]} />
                {t(`severity.${finding.severity}`)}
              </span>
            )}
            <span>{where}</span>
          </span>
        </span>
      </button>

      {selected && (
        <div className="mt-2 space-y-2 ps-9 text-sm">
          <p dir="auto" className="leading-relaxed">
            {finding.message}
          </p>
          {finding.passages.length > 1 && (
            <span
              role="group"
              aria-label={t("report.passage.pick")}
              className="flex gap-1"
            >
              {finding.passages.map((passage) => (
                <Badge
                  key={`${passage.clause}-${passage.page}`}
                  outline
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => onSelect(item, passage)}
                >
                  {passageLabel(passage.clause, t)}
                </Badge>
              ))}
            </span>
          )}
          <Link
            to={reportLink}
            className="inline-block text-xs font-medium text-primary hover:underline"
          >
            {t("viewer.backToCard")}
          </Link>
        </div>
      )}
    </div>
  );
}

function passageLabel(clause: string, t: TFunction): string {
  return isSectionNumber(clause)
    ? t("report.passage.section", { clause })
    : t("report.clause", { clause });
}
