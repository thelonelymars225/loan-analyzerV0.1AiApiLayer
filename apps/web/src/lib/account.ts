import { api } from "./api";
import { signOut } from "./auth";

interface DeleteMyDataDeps {
  deleteMyData: () => Promise<void>;
  signOut: () => Promise<void>;
}

const defaultDeps: DeleteMyDataDeps = { deleteMyData: api.deleteMyData, signOut };

/**
 * "Delete my data": the API deletes every rating and PDF the user uploaded, then we sign out.
 * If the delete fails the user stays signed in and sees the error.
 */
export async function deleteMyData(deps: DeleteMyDataDeps = defaultDeps): Promise<void> {
  await deps.deleteMyData();
  await deps.signOut();
}
