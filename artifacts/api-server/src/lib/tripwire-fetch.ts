import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { Readable } from "node:stream";

export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99 || b === 175 && c === 48)
      || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113 || a >= 224);
  }
  if (isIP(ip) !== 6 || ip.includes(".")) return false;
  // Fail closed to native global-unicast. This excludes mapped/compatible IPv4,
  // NAT64, local, link-local, multicast, site-local and unspecified addresses.
  const halves = ip.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  const words = parts.map(p => parseInt(p || "0", 16));
  const [a = 0, b = 0, c = 0] = words;
  if (a < 0x2000 || a > 0x3fff) return false;
  if (a === 0x2002 || a === 0x3fff || a === 0x2001 && (b < 0x200 || b === 0xdb8)) return false;
  if (a === 0x2620 && b === 0x4f && c === 0x8000) return false;
  return true;
}
type Options = { httpsOnly?: boolean; accept?: string; maxBytes?: number };
const hosts = new Map<string, number>();
let concurrent = 0;
type Dependencies = { lookup?: typeof lookup; https?: typeof https; http?: typeof http };
export async function fetchPublicDocument(rawUrl: string, depth = 0, options: Options = {}, dependencies: Dependencies = {}): Promise<{ bytes: Buffer; contentType: string; url: string }> {
  const maxBytes = options.maxBytes ?? 3_000_000;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8_000_000) throw new Error("Invalid source fetch limit");
  const deadline = Date.now() + 15000;
  async function hop(url: string, redirects: number): Promise<{ bytes: Buffer; contentType: string; url: string }> {
    const target = new URL(url);
    if ((options.httpsOnly ?? true) && target.protocol !== "https:") throw new Error("Intake requires HTTPS, including redirects");
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password
      || target.port && target.port !== (target.protocol === "https:" ? "443" : "80") || target.href.length > 4000)
      throw new Error("Use a public HTTPS source URL on its standard port");
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    if (/^(localhost|metadata|metadata\.google\.internal)$|\.(localhost|local|internal|home|lan)$/i.test(hostname)) throw new Error("Internal host not allowed");
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      (dependencies.lookup ?? lookup)(hostname, { all: true }),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("Source fetch timed out")), Math.max(1, deadline - Date.now())); }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("Private and local URLs are not allowed, including special-use addresses");
    if (Date.now() >= deadline) throw new Error("Source fetch timed out");
    const address = addresses[0]!;
    if (concurrent >= 8 || (hosts.get(hostname) ?? 0) >= 2) throw new Error("Source concurrency limit reached; retry later");
    concurrent++; hosts.set(hostname, (hosts.get(hostname) ?? 0) + 1);
    return new Promise<{ bytes: Buffer; contentType: string; url: string }>((resolve, reject) => {
      const request = (target.protocol === "https:" ? dependencies.https ?? https : dependencies.http ?? http).get(target, {
        headers: { "User-Agent": "Tripwire/1.0 authorized article intake", Accept: options.accept ?? "text/html,application/pdf,text/plain", "Accept-Encoding": "gzip, deflate, br" },
        family: address.family,
        lookup: (_hostname, _options, cb) => cb(null, address.address, address.family),
      }, response => {
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
          response.destroy();
          if (redirects >= 3) { reject(new Error("Too many redirects")); return; }
          resolve(hop(new URL(response.headers.location, target).href, redirects + 1)); return;
        }
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) { response.destroy(); reject(new Error(`Source returned HTTP ${response.statusCode}`)); return; }
        const contentType = response.headers["content-type"] ?? "";
        if (!/^(text\/(html|plain|xml)|application\/(rss\+xml|atom\+xml|xml|pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|octet-stream|gzip))/i.test(contentType)) {
          response.destroy(); reject(new Error("Unsupported source content type")); return;
        }
        const encoding = response.headers["content-encoding"]?.toLowerCase();
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
        if (encoding && encoding !== "identity" && !decoder) { response.destroy(); reject(new Error("Unsupported compression")); return; }
        let wire = 0, size = 0;
        response.on("data", (chunk: Buffer) => { wire += chunk.length; if (wire > maxBytes) request.destroy(new Error(`Source exceeds the ${maxBytes / 1_000_000} MB fetch limit`)); });
        const body: Readable = decoder ? response.pipe(decoder) : response;
        const chunks: Buffer[] = [];
        const fail = (error: Error) => { response.destroy(); body.destroy(); reject(error); };
        response.on("error", fail); body.on("error", fail);
        body.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) { request.destroy(); fail(new Error(`Decompressed source exceeds the ${maxBytes / 1_000_000} MB fetch limit`)); }
          else chunks.push(chunk);
        });
        body.on("end", () => { clearTimeout(timer); resolve({ bytes: Buffer.concat(chunks), contentType, url: target.href }); });
      });
      // A single end-to-end deadline, including redirects, DNS and decompression.
      const timer = setTimeout(() => request.destroy(new Error("Source fetch timed out")), Math.max(1, deadline - Date.now()));
      request.on("close", () => clearTimeout(timer));
      request.on("error", reject);
    }).finally(() => { concurrent--; const count = (hosts.get(hostname) ?? 1) - 1; if (count) hosts.set(hostname, count); else hosts.delete(hostname); });
  }
  return hop(rawUrl, depth);
}
