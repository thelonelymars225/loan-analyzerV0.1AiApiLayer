import type { View } from "@rater/contracts";

/** Query keys in one place. Everything under "ratings" is refetched when a rating changes. */
export const queryKeys = {
  me: ["me"] as const,
  ratings: ["ratings"] as const,
  ratingsList: ["ratings", "list"] as const,
  rating: (id: string) => ["ratings", "detail", id] as const,
  ratingView: (id: string, view: View | undefined, language: string) =>
    ["ratings", "detail", id, view ?? "default", language] as const,
};
