import type { OrgSummary } from "@rater/contracts";
import { api, type Api } from "./api";
import { setActiveOrg, signOut } from "./auth";

type RatingsClient = Pick<Api, "listRatings" | "deleteRating">;

/**
 * Deletes every rating (and with it the uploaded PDF) in the session's active org.
 *
 * Always re-reads the first page instead of following the cursor: rows are disappearing
 * while we page, so a cursor could skip some. If a rating we already deleted shows up again,
 * the API did not delete it and we stop instead of looping.
 */
export async function deleteAllRatings(client: RatingsClient): Promise<number> {
  const deleted = new Set<string>();
  for (;;) {
    const page = await client.listRatings(null);
    if (page.items.length === 0) return deleted.size;
    for (const rating of page.items) {
      if (deleted.has(rating.id)) {
        throw new Error(`Rating ${rating.id} is still listed after it was deleted`);
      }
      await client.deleteRating(rating.id);
      deleted.add(rating.id);
    }
  }
}

interface DeleteMyDataDeps {
  ratings: RatingsClient;
  setActiveOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultDeps: DeleteMyDataDeps = { ratings: api, setActiveOrg, signOut };

/**
 * "Delete my data": removes every rating in the personal workspace, then signs out.
 * Company workspaces belong to the employer and are not touched.
 */
export async function deleteMyData(
  personalOrg: OrgSummary,
  activeOrgId: string | null,
  deps: DeleteMyDataDeps = defaultDeps,
): Promise<number> {
  // The API takes the org from the session, so the personal org must be the active one.
  if (activeOrgId !== personalOrg.id) await deps.setActiveOrg(personalOrg.id);
  const count = await deleteAllRatings(deps.ratings);
  await deps.signOut();
  return count;
}
