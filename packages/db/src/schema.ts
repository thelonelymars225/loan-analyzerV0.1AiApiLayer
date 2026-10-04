import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIM } from "@rater/contracts";
import type {
  Deadline,
  Impact,
  RatingStatus,
  ScoreCategory,
  View,
} from "@rater/contracts";
import { orgs, users } from "./auth-schema";

export * from "./auth-schema";

/**
 * Application tables. Every table that holds customer data carries org_id (directly, or
 * through its rating), and every query is scoped by it.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** An uploaded PDF. The file lives in the bucket; this row only points at it. */
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pages: integer("pages"),
    /** Retention: the PDF is deleted from the bucket after this time. */
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    /** Set when the PDF has been removed from the bucket. The row stays for the rating. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("documents_org_idx").on(t.orgId),
    index("documents_uploaded_by_idx").on(t.uploadedBy),
    index("documents_delete_after_idx").on(t.deleteAfter),
  ],
);

export const ratings = pgTable(
  "ratings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<RatingStatus>().notNull().default("queued"),
    /** Last pipeline step that finished, so a retried job resumes after it. */
    lastStep: text("last_step"),
    defaultView: text("default_view").$type<View>().notNull(),
    lawVersion: text("law_version"),
    rulesetVersion: text("ruleset_version"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    /** Overall score in the default view. The other view is computed from the sub-scores. */
    scoreOverall: integer("score_overall"),
    scoreLegal: integer("score_legal"),
    scoreMarket: integer("score_market"),
    scoreClarity: integer("score_clarity"),
    deadlines: jsonb("deadlines").$type<Deadline[]>(),
    /** Why the rating is needs_review: extraction issues, in plain English. */
    reviewReasons: jsonb("review_reasons").$type<string[]>(),
    /** LLM token usage for cost tracking. */
    usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number }>(),
    errorCode: text("error_code"),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("ratings_org_created_idx").on(t.orgId, t.createdAt),
    index("ratings_created_by_idx").on(t.createdBy, t.createdAt),
    index("ratings_document_idx").on(t.documentId),
  ],
);

/** Values read from sections 1-14, one row per field. */
export const contractFields = pgTable(
  "contract_fields",
  {
    ratingId: text("rating_id")
      .notNull()
      .references(() => ratings.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: jsonb("value"),
    page: integer("page"),
    confidence: text("confidence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ratingId, t.field] })],
);

/** Section 15 items, one row each. */
export const clauses = pgTable(
  "clauses",
  {
    id: text("id").primaryKey(),
    ratingId: text("rating_id")
      .notNull()
      .references(() => ratings.id, { onDelete: "cascade" }),
    section: integer("section").notNull(),
    number: text("number").notNull(),
    textEn: text("text_en").notNull(),
    textAr: text("text_ar"),
    textHash: text("text_hash").notNull(),
  },
  (t) => [index("clauses_rating_idx").on(t.ratingId)],
);

/** Feeds both views. */
export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    ratingId: text("rating_id")
      .notNull()
      .references(() => ratings.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    clauseRef: text("clause_ref"),
    verdict: text("verdict").notNull(),
    severity: text("severity").notNull(),
    confidence: text("confidence").notNull(),
    categories: text("categories").array().$type<ScoreCategory[]>().notNull(),
    articles: text("articles").array().notNull(),
    impact: jsonb("impact").$type<Impact>(),
    explanation: text("explanation").notNull(),
    employeeMsg: text("employee_msg").notNull(),
    hrMsg: text("hr_msg").notNull(),
    askFor: text("ask_for"),
    suggestedWording: text("suggested_wording"),
    source: text("source").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    /** Order within the pipeline output, so reports are stable. */
    position: integer("position").notNull().default(0),
  },
  (t) => [index("findings_rating_idx").on(t.ratingId)],
);

/** The law corpus, one row per article (or paragraph of a long article). */
export const lawArticles = pgTable(
  "law_articles",
  {
    id: text("id").primaryKey(),
    lawVersion: text("law_version").notNull(),
    sourceDoc: text("source_doc").notNull(),
    article: text("article").notNull(),
    paragraph: text("paragraph"),
    textAr: text("text_ar"),
    textEnUnofficial: text("text_en_unofficial"),
    sourceUrl: text("source_url"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    index("law_articles_version_article_idx").on(t.lawVersion, t.article),
    index("law_articles_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    uniqueIndex("law_articles_unique_idx").on(
      t.lawVersion,
      t.sourceDoc,
      t.article,
      sql`coalesce(${t.paragraph}, '')`,
    ),
  ],
);

/** Identical clauses are analysed once per law, ruleset, prompt and model version. */
export const clauseCache = pgTable(
  "clause_cache",
  {
    textHash: text("text_hash").notNull(),
    lawVersion: text("law_version").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    result: jsonb("result").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "clause_cache_pk",
      columns: [t.textHash, t.lawVersion, t.rulesetVersion, t.promptVersion, t.model],
    }),
  ],
);

/** Uploads, views, downloads and deletes. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_org_at_idx").on(t.orgId, t.at)],
);
