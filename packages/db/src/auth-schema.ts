import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { DEFAULT_RETENTION_DAYS } from "@rater/contracts";
import type { OrgKind } from "@rater/contracts";

/**
 * Tables owned by Better Auth (core + organization plugin), matching better-auth 1.7.7.
 *
 * The Drizzle adapter addresses columns by their TypeScript property name, so every
 * property below is spelled exactly like the Better Auth field (`emailVerified`,
 * `activeOrganizationId`, ...). The SQL names are plural and snake_case like the rest of
 * our schema. Pass `authTables` (below) to `drizzleAdapter(db, { schema: authTables })`.
 *
 * Better Auth checks this schema at start-up: every field it writes must exist, and any
 * extra column must be nullable or have a default.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Organization plugin. Not a foreign key: Better Auth manages it and clears it itself. */
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Password hash for email + password sign-in. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth's "organization". A personal account is an org of one (kind "personal");
 * an HR team is kind "company". `kind` and `retentionDays` are Better Auth
 * `additionalFields` on the organization model.
 */
export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: createdAt(),
  /** JSON string, as Better Auth stores it. */
  metadata: text("metadata"),
  kind: text("kind").$type<OrgKind>().notNull().default("personal"),
  /** Raw PDFs are deleted from the bucket this many days after upload. */
  retentionDays: integer("retention_days").notNull().default(DEFAULT_RETENTION_DAYS),
});

/** Better Auth's "member". `role` may hold several roles, comma separated. */
export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    // One membership per user and org; also serves lookups by organization_id.
    uniqueIndex("memberships_org_user_idx").on(t.organizationId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
  ],
);

export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

/** Better Auth's "invitation". */
export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").$type<InvitationStatus>().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("invitations_organization_id_idx").on(t.organizationId),
    index("invitations_email_idx").on(t.email),
    index("invitations_inviter_id_idx").on(t.inviterId),
  ],
);

/**
 * The auth tables keyed by Better Auth model name, for
 * `drizzleAdapter(db, { provider: "pg", schema: authTables })`.
 * Do not set `usePlural` or custom `modelName`s in the Better Auth config.
 */
export const authTables = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  organization: orgs,
  member: memberships,
  invitation: invitations,
};
