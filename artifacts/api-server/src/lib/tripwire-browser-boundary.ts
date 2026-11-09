import type { Request, Response, NextFunction } from "express";
// Same-origin only. Never trust X-Forwarded-Host as authentication or an origin
// allowlist. Replit proxies preserve Host; rejecting an unknown proxy is safer
// than reflecting an attacker-controlled Origin with credentials.
export function browserBoundary(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Vary", "Origin");
  const origin = req.get("origin");
  if (origin) {
    let same = false;
    try {
      const parsed = new URL(origin);
      same = ["https:", "http:"].includes(parsed.protocol) && parsed.host === req.get("host");
    } catch { /* invalid origin */ }
    if (!same) { res.status(403).json({ error: "Cross-origin requests are not allowed" }); return; }
  }
  if (req.get("sec-fetch-site") === "cross-site") { res.status(403).json({ error: "Cross-site requests are not allowed" }); return; }
  const noBody = !req.get("transfer-encoding") && Number(req.get("content-length") ?? 0) === 0;
  const existingBodylessAction = noBody && (req.method === "DELETE" || req.method === "POST" &&
    (req.path === "/refresh" || req.path === "/x-feeds/refresh" || /^\/records\/[^/]+\/restore$/.test(req.path)));
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !existingBodylessAction && !req.is("application/json")) {
    res.status(415).json({ error: "State changes require application/json" }); return;
  }
  next();
}
const rates = new Map<string, { count: number; until: number }>();
export function intensiveLimit(req: Request, res: Response, next: NextFunction) {
  const name = req.method + ":" + req.path.split("/").slice(0, 4).join("/");
  const now = Date.now();
  if (rates.size > 2000) for (const [k, value] of rates) if (value.until <= now) rates.delete(k);
  const bucket = rates.get(name);
  const current = bucket && bucket.until > now ? bucket : { count: 0, until: now + 60000 };
  rates.set(name, current);
  if (++current.count > (req.method === "GET" ? 120 : 30)) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Workspace request limit reached; retry in a minute" }); return; }
  next();
}
