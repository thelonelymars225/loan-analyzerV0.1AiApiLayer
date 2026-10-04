import { api } from "./api";
import { signOut } from "./auth";

interface DeleteMyDataDeps {
  deleteMyData: () => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultDeps: DeleteMyDataDeps = { deleteMyData: api.deleteMyData, signOut };

/**
 * "Delete my data": the API deletes every rating and PDF in the personal workspace, then we
 * sign out. The API finds the personal workspace itself, whatever workspace is active (another
 * tab may have switched it), so a company workspace is never touched by mistake.
 * If the delete fails the user stays signed in and sees the error.
 */
export async function deleteMyData(deps: DeleteMyDataDeps = defaultDeps): Promise<void> {
  await deps.deleteMyData();
  await deps.signOut();
}
