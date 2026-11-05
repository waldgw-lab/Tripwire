import { Storage } from "@google-cloud/storage";

const endpoint = "http://127.0.0.1:1106";
const storage = new Storage({ projectId: "", credentials: {
  audience: "replit", subject_token_type: "access_token", token_url: `${endpoint}/token`, type: "external_account",
  credential_source: { url: `${endpoint}/credential`, format: { type: "json", subject_token_field_name: "access_token" } }, universe_domain: "googleapis.com",
} });
export function privateFile(objectName: string) {
  if (!/^[a-f0-9-]{36}$/.test(objectName)) throw new Error("Invalid upload identifier");
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("Private file storage is not configured");
  const [bucket, ...parts] = dir.replace(/^\/+/, "").split("/");
  return storage.bucket(bucket!).file(`${parts.join("/")}/tripwire/${objectName}`);
}
export async function uploadUrl(id: string) {
  const file = privateFile(id);
  const response = await fetch(`${endpoint}/object-storage/signed-object-url`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ bucket_name: file.bucket.name, object_name: file.name, method: "PUT", expires_at: new Date(Date.now() + 15 * 60000).toISOString() }),
  });
  if (!response.ok) throw new Error("Could not prepare private upload");
  const result = await response.json() as { signed_url: string };
  return result.signed_url;
}
