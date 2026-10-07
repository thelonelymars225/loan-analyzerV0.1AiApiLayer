import type {
  ArticleRef,
  Clause,
  ClauseLocation,
  ContractFieldName,
  ContractFields,
  Deadline,
  FieldProvenance,
  Finding,
  ImpactKind,
  ImpactParams,
  LawArticle,
  Score,
  Versions,
  View,
} from "@rater/contracts";
import type { LlmUsage } from "@rater/llm";

/** One word from `pdftotext -bbox-layout`, in PDF points from the page's top-left corner. */
export interface BboxWord {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** One page of `pdftotext -bbox-layout` output. Pages are numbered from 1. */
export interface PageLayout {
  page: number;
  width: number;
  height: number;
  words: BboxWord[];
}

/** A rectangle on a page, in PDF points. */
export interface PageRegion {
  page: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** Step 1 output. */
export type Detection = { ok: true } | { ok: false; reason: string };

export interface ExtractionIssue {
  field: string;
  message: string;
}

/** Step 2 output. */
export interface ExtractionResult {
  fields: ContractFields;
  provenance: Partial<Record<ContractFieldName, FieldProvenance>>;
  /** Section 15 items. textAr is null until Arabic OCR is merged in with attachArabicOcr. */
  clauses: Clause[];
  /** Where every numbered clause and section is printed (boxes only, no text). */
  clauseLocations: ClauseLocation[];
  /** Arabic-column regions covering Section 15, for OCR. Empty if Section 15 was not found. */
  section15ArabicRegions: PageRegion[];
  /**
   * Strings that identify people or the employer (names, as printed in either language).
   * Used only to build the redaction context. Never persisted, never logged.
   */
  identifyingStrings: string[];
  /**
   * Placeholder for each identifying string (employer name → "[EMPLOYER]", employee name →
   * "[EMPLOYEE]"). Strings missing here are redacted as "[NAME]". Same privacy rules as above.
   */
  namePlaceholders?: Record<string, NamePlaceholder>;
  issues: ExtractionIssue[];
  /** True when a required field is missing or the wage parts don't sum to the total. */
  needsReview: boolean;
}

export type NamePlaceholder = "[EMPLOYER]" | "[EMPLOYEE]" | "[NAME]";

/** Step 3 input. */
export interface RedactionContext {
  /** Names to replace, with the placeholder to use for each. */
  names: { text: string; placeholder: NamePlaceholder }[];
}

/** Rule-first law lookup: the articles a rule cites. */
export interface ArticleLookup {
  byRefs(refs: ArticleRef[]): Promise<LawArticle[]>;
}

/** Cache of validated ClauseAnalysis results, keyed by clauseCacheKey(). */
export interface ClauseCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** A finding from step 4b plus the numbers the impact step needs. */
export interface AnalysedFinding extends Finding {
  impactParams?: ImpactParams;
  /** The rule's impact formula (Rule.impact), so applyImpact needs no rules table. */
  impactKind?: ImpactKind;
}

export interface StepVersions {
  law: string;
  ruleset: string;
}

/** What runPipeline returns. The worker persists this; the eval runner compares it. */
export interface PipelineResult {
  status: "done" | "needs_review" | "rejected";
  rejectReason?: string;
  extraction: ExtractionResult | null;
  /** Findings after impact, in pipeline order. */
  findings: Finding[];
  deadlines: Deadline[];
  scores: Record<View, Score>;
  versions: Versions;
  usage: LlmUsage;
}
