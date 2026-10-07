import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiUrls } from "../../lib/api";
import { cn } from "../../lib/cn";
import { HIGHLIGHT_CLASSES, PIN_CLASSES } from "../../lib/report";
import type { PageMark, PageSize } from "../../lib/viewer";

interface ContractPagesProps {
  ratingId: string;
  /** One entry per page, in order. */
  sizes: PageSize[];
  marks: PageMark[];
  onSelect: (mark: PageMark) => void;
}

/**
 * Every page of the contract, top to bottom, as images the API cuts on request, with the
 * findings drawn over them. The paper never mirrors: the stack is always left-to-right, even
 * when the app is in Arabic, because the PDF itself is laid out that way.
 */
export function ContractPages({ ratingId, sizes, marks, onSelect }: ContractPagesProps) {
  const { t } = useTranslation();
  return (
    <div dir="ltr" className="rounded-xl bg-muted/60 p-3 sm:p-4">
      <ol className="mx-auto space-y-4">
        {sizes.map((size, index) => {
          const page = index + 1;
          return (
            <li
              key={page}
              id={`contract-page-${page}`}
              aria-label={t("viewer.pageLabel", { page, pages: sizes.length })}
              className="relative overflow-hidden rounded-md border border-border bg-white shadow-xs"
              style={{ aspectRatio: size.width / size.height }}
            >
              <img
                src={apiUrls.page(ratingId, page)}
                alt={t("viewer.pageAlt", { page })}
                loading="lazy"
                decoding="async"
                className="block h-full w-full"
              />
              {marks
                .filter((mark) => mark.passage.page === page)
                .map((mark) => (
                  <Mark
                    key={`${mark.itemId}-${mark.passage.clause}`}
                    mark={mark}
                    size={size}
                    onSelect={onSelect}
                  />
                ))}
              <span
                aria-hidden="true"
                className="absolute right-2 bottom-2 rounded bg-foreground/70 px-1.5 py-0.5 text-[11px] font-medium text-background tabular-nums"
              >
                {page}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One finding's passage on the page: a translucent bar over the clause, with its number pinned
 * at the right edge beside the Arabic column (the text that prevails). The selected one is
 * scrolled into the middle of the screen.
 */
function Mark({
  mark,
  size,
  onSelect,
}: {
  mark: PageMark;
  size: PageSize;
  onSelect: (mark: PageMark) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const { box } = mark.passage;

  useEffect(() => {
    // jsdom has no scrollIntoView; browsers do.
    if (mark.selected)
      ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [mark.selected]);

  const percent = (value: number, whole: number) => `${(value / whole) * 100}%`;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(mark)}
      aria-label={
        mark.number === null
          ? mark.title
          : t("viewer.markLabel", { number: mark.number, title: mark.title })
      }
      aria-pressed={mark.selected}
      data-testid="page-mark"
      className={cn(
        "absolute rounded-sm ring-inset transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        HIGHLIGHT_CLASSES[mark.tone],
        mark.selected ? "ring-4" : "ring-2 hover:ring-4",
      )}
      style={{
        left: percent(box.xMin, size.width),
        top: percent(box.yMin, size.height),
        width: percent(box.xMax - box.xMin, size.width),
        height: percent(box.yMax - box.yMin, size.height),
      }}
    >
      {mark.number !== null && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full text-[11px] font-semibold shadow-sm",
            PIN_CLASSES[mark.tone],
          )}
        >
          {mark.number}
        </span>
      )}
    </button>
  );
}
