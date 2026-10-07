import type { MeResponse } from "@rater/contracts";
import { createContext, useContext } from "react";

/** The signed-in user, loaded once by <RequireAuth>. */
export interface Session {
  me: MeResponse;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <RequireAuth>");
  return session;
}
