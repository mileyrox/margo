import type { Request, RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";

/**
 * Which websites may call the API from a browser:
 * - the app's own address (whatever domain the request came in on),
 * - Replit's domains for this app (REPLIT_DOMAINS, REPLIT_DEV_DOMAIN),
 * - anything listed in the ALLOWED_ORIGINS secret (comma separated, e.g. a custom domain),
 * - localhost while developing.
 */
function allowedOrigin(origin: string, req: Request): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  const forwarded = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim();
  const host = forwarded || req.headers.host || "";
  if (url.host === host) return true;
  const listed = [process.env.REPLIT_DOMAINS, process.env.REPLIT_DEV_DOMAIN, process.env.ALLOWED_ORIGINS]
    .filter(Boolean).join(",").split(",").map((value) => value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  if (listed.includes(url.host.toLowerCase())) return true;
  if (process.env.NODE_ENV !== "production" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  return false;
}

/** The Chrome extension signs in with its own token (no cookies), so it may call this one route from anywhere. */
const openRoutes = ["/api/extension/lookup", "/api/extension/swap", "/api/healthz", "/api/email/inbound"];

export const corsPolicy: RequestHandler = cors((req, callback) => {
  const origin = req.headers.origin;
  const open = openRoutes.some((path) => req.url?.startsWith(path));
  if (open) return callback(null, { origin: true, credentials: false });
  callback(null, { origin: !origin || allowedOrigin(origin, req as Request), credentials: true });
});

/** Blocks changes (POST, PUT, DELETE...) sent from another website, even if the browser would send them. */
export const blockOtherSites: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (openRoutes.some((path) => req.originalUrl.startsWith(path))) return next();
  const origin = req.headers.origin;
  if (origin && !allowedOrigin(origin, req)) { res.status(403).json({ error: "Requests from other websites aren't allowed." }); return; }
  next();
};

/** Standard security headers for API responses. */
export const securityHeaders: RequestHandler = helmet({
  // The API only returns data and files; it never serves a page.
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", "data:"] } },
  // Receipt photos and the sign-in proxy are loaded by the app on the same site.
  crossOriginResourcePolicy: { policy: "same-site" },
});
