import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a >= 224);
  }
  return isIP(ip) === 6 && !ip.includes(".") && !/^(::|fc|fd|fe[89ab]|ff|2001:db8)/i.test(ip);
}
export async function fetchPublicDocument(rawUrl: string, depth = 0, options: { httpsOnly?: boolean; accept?: string } = {}): Promise<{ bytes: Buffer; contentType: string; url: string }> {
  const target = new URL(rawUrl);
  if (options.httpsOnly && target.protocol !== "https:") throw new Error("Intake requires HTTPS, including redirects");
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.port && !["80", "443"].includes(target.port) || target.href.length > 4000) throw new Error("Use a public http or https URL");
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("Private and local URLs are not allowed");
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    // Pin the validated address; resolving it again at connect time permits DNS rebinding.
    const request = (target.protocol === "https:" ? https : http).get(target, {
      headers: { "User-Agent": "Tripwire/1.0 article intake", Accept: options.accept ?? "text/html,application/pdf,text/plain,application/octet-stream;q=0.8" },
      family: address.family,
      lookup: (_hostname, _options, cb) => cb(null, address.address, address.family),
    }, response => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
        response.resume();
        if (depth >= 3) { reject(new Error("Too many redirects")); return; }
        resolve(fetchPublicDocument(new URL(response.headers.location, target).href, depth + 1, options)); return;
      }
      if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) { response.resume(); reject(new Error(`Source returned HTTP ${response.statusCode}`)); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 3_000_000) { response.destroy(new Error("Source exceeds the 3 MB fetch limit")); } else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers["content-type"] ?? "", url: target.href }));
    });
    const timer = setTimeout(() => request.destroy(new Error("Source fetch timed out")), 15000);
    request.on("close", () => clearTimeout(timer)); request.on("error", reject);
  });
}
