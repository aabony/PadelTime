import { Hono } from "hono";
import { makeAuth } from "./auth";
import type { Env } from "./env";
import { api } from "./routes";
import { ensureSchema } from "./lib/ensureSchema";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { previewFor } from "./lib/preview";

const app = new Hono<{ Bindings: Env }>();

// Additive schema changes that couldn't be applied from the deploy pipeline.
app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// Better Auth owns /api/auth/* (sign-up, sign-in, session, sign-out, …).
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  makeAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw),
);

app.route("/api", api);

// Shared links get a real preview: the SPA shell with the session's title and
// a live description injected (wrangler routes /join/* here, and old /board/*
// links, which the app sends on to the join page).
const preview = () => async (c: { env: Env; req: { url: string; raw: Request } }) => {
  const url = new URL(c.req.url);
  const shell = await c.env.ASSETS.fetch(new Request(new URL("/", url), { headers: c.req.raw.headers }));
  const code = url.pathname.split("/")[2] ?? "";
  let meta: Awaited<ReturnType<typeof previewFor>> = null;
  if (code) {
    try {
      await ensureSchema(c.env.DB);
      meta = await previewFor(drizzle(c.env.DB, { schema }), code);
    } catch (err) {
      console.error("preview failed:", err);
    }
  }
  if (!meta) return shell;
  const title = `${meta.title} · PadelTime`;
  const set = (attr: string, value: string) => ({
    element(el: Element) {
      el.setAttribute(attr, value);
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', set("content", meta.description))
    .on('meta[property="og:title"]', set("content", meta.title))
    .on('meta[property="og:description"]', set("content", meta.description))
    .on('meta[property="og:url"]', set("content", url.origin + url.pathname))
    .on('meta[name="twitter:title"]', set("content", meta.title))
    .on('meta[name="twitter:description"]', set("content", meta.description))
    .transform(shell);
};
app.get("/join/*", preview());
app.get("/board/*", preview());

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Something went wrong on our side" }, 500);
});

// Static assets (the React app) are served by the Workers runtime for all
// non-/api routes — see "assets" in wrangler.jsonc (SPA fallback enabled).
export default app;
