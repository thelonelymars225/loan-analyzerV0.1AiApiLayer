import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { setApiLanguage } from "../lib/api";
import ar from "../locales/ar.json";
import en from "../locales/en.json";

export const LANGUAGES = ["en", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language's name in that language, for the language switchers. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ar: "العربية" };

const STORAGE_KEY = "rater.language";

/** Sets <html lang dir> so the browser, screen readers and logical CSS follow the language. */
export function applyDocumentLanguage(language: string): void {
  const root = document.documentElement;
  root.lang = language;
  root.dir = i18n.dir(language);
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

function savedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null; // storage can be blocked (private mode, sandboxed frames)
  }
}

function saveLanguage(language: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not remembering the choice is fine.
  }
}

function browserLanguage(): Language {
  const preferred = typeof navigator === "undefined" ? "" : navigator.language;
  return preferred.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function onLanguageChanged(language: string): void {
  applyDocumentLanguage(language);
  setApiLanguage(language);
  saveLanguage(language);
}

/** Initialises i18next once. Resources are bundled, so this is synchronous. */
export function initI18n(language: Language = savedLanguage() ?? browserLanguage()) {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { en: { translation: en }, ar: { translation: ar } },
      lng: language,
      fallbackLng: "en",
      supportedLngs: [...LANGUAGES],
      interpolation: { escapeValue: false }, // React already escapes
      initAsync: false,
      returnNull: false,
    });
    i18n.on("languageChanged", onLanguageChanged);
  }
  applyDocumentLanguage(i18n.language);
  setApiLanguage(i18n.language);
  return i18n;
}

export function otherLanguage(language: string): Language {
  return language.startsWith("ar") ? "en" : "ar";
}

export { i18n };
