import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, otherLanguage } from "../../i18n";
import { cn } from "../../lib/cn";
import { buttonVariants } from "../ui/variants";

/** Switches between English and Arabic. The label is the other language, in that language. */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const next = otherLanguage(i18n.language);

  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={t("nav.switchLanguage")}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), className)}
    >
      <Languages aria-hidden="true" />
      <span lang={next}>{LANGUAGE_NAMES[next]}</span>
    </button>
  );
}
