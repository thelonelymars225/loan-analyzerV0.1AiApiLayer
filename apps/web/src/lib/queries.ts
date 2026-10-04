import type { View } from "@rater/contracts";

/**
 * Query keys in one place. Everything under "ratings" is refetched when a rating changes;
 * the list key carries the org so switching workspace never shows another org's ratings.
 */
export const queryKeys = {
  me: ["me"] as const,
  ratings: ["ratings"] as const,
  ratingsList: (orgId: string) => ["ratings", "list", orgId] as const,
  rating: (id: string) => ["ratings", "detail", id] as const,
  ratingView: (id: string, view: View | undefined, language: string) =>
    ["ratings", "detail", id, view ?? "default", language] as const,
  members: (orgId: string) => ["orgs", orgId, "members"] as const,
};
