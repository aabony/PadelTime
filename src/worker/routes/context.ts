import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import type { StoredProfile } from "../../shared/profile";
import type { Env } from "../env";

/** The signed-in user, read fresh from D1 on every API request (routes/index.ts). */
export interface AuthedUser extends StoredProfile {
  id: string;
  name: string;
  email: string;
  /** May create and run tournaments (ADMIN_EMAILS or the is_admin column). */
  isAdmin: boolean;
}

export type ApiCtx = {
  Bindings: Env;
  Variables: {
    db: DrizzleD1Database<typeof schema>;
    user: AuthedUser | null;
  };
};
