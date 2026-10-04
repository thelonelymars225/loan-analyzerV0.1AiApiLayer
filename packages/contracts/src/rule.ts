import { z } from "zod";
import { Confidence, ScoreCategory, Severity } from "./enums";

/** The official documents the law corpus is built from. */
export const LawSource = z.enum([
  "labor_law",
  "implementing_regulations",
  "qiwa_template",
]);
export type LawSource = z.infer<typeof LawSource>;

/** A pointer into the law corpus, used for rule-first article lookup. */
export const ArticleRef = z.object({
  source: LawSource,
  /** Article number as printed, e.g. "84" or "20". For the Qiwa template, the clause number, e.g. "14.5". */
  article: z.string().min(1),
  paragraph: z.string().optional(),
});
export type ArticleRef = z.infer<typeof ArticleRef>;

/** Kind decides which pipeline step evaluates the rule. */
export const RuleKind = z.enum([
  /** Deterministic check on extracted fields (step 4a). */
  "field",
  /** Section 15 clause analysed by the LLM (step 4b). */
  "clause",
  /** Section 15 contradicting sections 1-14 (step 4c). */
  "cross",
  /** Always-true legal information shown to the reader; never changes the score. */
  "info",
  /** Market convention, not law. Feeds the market sub-score at low confidence. */
  "market",
]);
export type RuleKind = z.infer<typeof RuleKind>;

export const ImpactKind = z.enum(["eos_gap", "art77_gap", "leave_value"]);
export type ImpactKind = z.infer<typeof ImpactKind>;

/**
 * One entry in the rules table. Rules are data: code only implements the check
 * function named by the rule ID (field and market rules) or passes `detect` to the LLM
 * (clause and cross rules).
 */
export const Rule = z.object({
  /** Stable ID, e.g. "EOS-BASE-01". */
  id: z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{2}$/),
  kind: RuleKind,
  /** Short English title for lists. */
  title: z.string().min(1),
  /** Sub-scores a failing finding counts against. The first one is the primary category. */
  categories: z.array(ScoreCategory).min(1),
  /** Contract field names the rule reads (field and market rules). */
  fields: z.array(z.string()).default([]),
  /** Human-readable statement of the check. */
  check: z.string().optional(),
  /** For clause and cross rules: what the analyser looks for in Section 15. */
  detect: z.string().optional(),
  /** Article citations as shown to readers, e.g. "Art. 84". */
  articles: z.array(z.string()),
  /** Machine references into the law corpus for rule-first lookup. */
  articleRefs: z.array(ArticleRef).default([]),
  /** Severity when the rule is violated. Info rules use "none". */
  severityIfFail: Severity,
  /** SAR impact formula to apply to findings from this rule, if any. */
  impact: ImpactKind.optional(),
  /** Analyst note: nuance the analyser must respect. */
  note: z.string().optional(),
  /** Employee view message. May contain {placeholders} filled from the finding. */
  employeeMsg: z.string().min(1),
  /** HR view message. May contain {placeholders}. */
  hrMsg: z.string().min(1),
  /** Employee view: what to ask the employer for. */
  askFor: z.string().optional(),
  /** HR view: suggested replacement wording. */
  suggestedWording: z.string().optional(),
  /** Employee message when the field check passes in the employee's favour ("what's good"). */
  goodMsg: z.string().optional(),
  /** Whether a human verified the rule against the law text. */
  verified: z.boolean(),
  /** Default confidence of findings from this rule. */
  confidence: Confidence.default("high"),
});
export type Rule = z.infer<typeof Rule>;
export type RuleInput = z.input<typeof Rule>;

export const RulesFile = z.object({
  rulesetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  lawVersion: z.string().min(1),
  rules: z.array(Rule),
});
export type RulesFile = z.infer<typeof RulesFile>;

/** One chunk of the law corpus: an article, or a paragraph of a long article. */
export const LawArticle = z.object({
  lawVersion: z.string(),
  source: LawSource,
  article: z.string(),
  paragraph: z.string().nullable().default(null),
  /** Official Arabic text: the source of truth. Null when not yet ingested. */
  textAr: z.string().nullable(),
  /** Unofficial English rendering, for display only. */
  textEnUnofficial: z.string().nullable(),
  /** Where the text was taken from. */
  sourceUrl: z.string().nullable().default(null),
  effectiveFrom: z.string().nullable().default(null),
  effectiveTo: z.string().nullable().default(null),
});
export type LawArticle = z.infer<typeof LawArticle>;
