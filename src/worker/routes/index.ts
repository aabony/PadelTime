import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "../db/schema";
import { makeAuth } from "../auth";
import { normalizeLevel } from "../../shared/levels";
import { parseGender } from "../../shared/genders";
import type { ApiCtx, AuthedUser } from "./context";
import { groupRoutes } from "./groups";
import { matchRoutes } from "./matches";
import { publicRoutes } from "./publicRoutes";
import { sessionRoutes } from "./sessions";

export const api = new Hono<ApiCtx>();

/** ADMIN_EMAILS: "a@x.com, b@y.com, *@club.com" — exact addresses or whole domains. */
export function isAdminEmail(list: string | undefined, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const domain = e.slice(e.indexOf("@"));
  return (list ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === e || (entry.startsWith("*@") && entry.slice(1) === domain));
}

api.use("*", async (c, next) => {
  const db = drizzle(c.env.DB, { schema });
  c.set("db", db);
  const auth = makeAuth(c.env, new URL(c.req.url).origin);
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  let user: AuthedUser | null = null;
  if (s?.user) {
    // The cookie caches the auth user for a few minutes; the profile and admin
    // flag are read from D1 so a just-saved profile is seen straight away.
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, s.user.id)).limit(1);
    if (row) {
      user = {
        id: row.id,
        name: row.name,
        email: row.email,
        isAdmin: row.isAdmin || isAdminEmail(c.env.ADMIN_EMAILS, row.email),
        firstName: row.firstName,
        lastName: row.lastName,
        phone: row.phone,
        dob: row.dob,
        gender: parseGender(row.gender),
        level: normalizeLevel(row.level),
        playtomicLevel: row.playtomicLevel,
      };
    }
  }
  c.set("user", user);
  await next();
});

api.get("/health", (c) => c.json({ ok: true }));
api.route("/", groupRoutes);
api.route("/", sessionRoutes);
api.route("/", matchRoutes);
api.route("/", publicRoutes);
