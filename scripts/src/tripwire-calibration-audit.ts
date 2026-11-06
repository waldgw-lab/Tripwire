import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { db, pool, tripwireRecords, tripwireContent } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
const policyPath = "../../artifacts/api-server/src/lib/tripwire-impact-policy.ts";
const { assessArticle, IMPACT_POLICY_VERSION } = await import(policyPath);
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));

type Sample = { sample: string; page: number | null; row: number; metadata: string; headline: string; annotatedNegative: boolean };
const dir = "generated-artifacts/calibration";
await mkdir(dir, { recursive: true });
const previousReport = await readFile("docs/calibration/sample-inventory.json", "utf8").then(JSON.parse).catch(() => undefined);
const samples: Sample[] = [];
for (const [sample, file] of [["HIGH", "Tripwire_Feed_HIGH_1793978132331.pdf"], ["CRITICAL", "Tripwire_Feed_CRITICAL_1793978132332.pdf"]]) {
  const text = execFileSync("pdftotext", ["-layout", `attached_assets/${file}`, "-"], { encoding: "utf8", maxBuffer: 10_000_000 });
  const pages = text.split("\f");
  let row = 0;
  for (const [page, raw] of pages.entries()) {
    const entries = [...raw.matchAll(/(?:^|\n)\s*(\d{2} [A-Z]{3,4}\s*·\s*\d{4}\s*·[\s\S]*?)(?=\n\s*\d{2} [A-Z]{3,4}\s*·\s*\d{4}\s*·|$)/g)];
    for (const entry of entries) {
      const flattened = entry[1]!.replace(/\s+/g, " ").trim();
      const parsed = flattened.match(/^([\s\S]*?·\s*(?:HIGH|CRITICAL)\s*·)\s*([\s\S]+)$/);
      const metadata = flattened;
      const headline = (parsed?.[2] ?? "").replace(/\b(?:Politics|Geopolitics|Military Operations|Intelligence|Foreign Policy|Defense|OPINION|VIDEO|AUDIO|LIVE-UPDATES|COMMENTARY|ANALYSIS|INTERVIEW|REVIEW|EXPLAINER)\s*·\s*/g, "").trim();
      if (!headline) throw new Error(`Unparsed ${sample} page ${page + 1}`);
      samples.push({ sample: sample!, page: page + 1, row: ++row, metadata, headline,
        annotatedNegative: sample === "HIGH" && page === 0 && /LeBron James|Photos of the Week|An Absolute Beauty/.test(headline) });
    }
  }
}
const low = await readFile("attached_assets/Pasted--06-NOV-0924-The-Washington-Post-low-Politics-Jay-Rocke_1793977370846.txt", "utf8");
const entries = low.trim().split(/(?=\b\d{2} [A-Z]{3}\s*\n\s*·)/).filter(s => s.trim());
for (const [i, entry] of entries.entries()) {
  const parts = entry.split(/\n\s*\n/).filter(s => s.trim()).map(s => s.replace(/\s+/g, " ").trim());
  samples.push({ sample: "LOW", page: null, row: i + 1, metadata: parts[0]!, headline: parts.slice(1).join(" "), annotatedNegative: false });
}
const norm = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const outlets = ["The Washington Post", "The New York Times", "The Wall Street Journal", "Washington Examiner", "The Atlantic", "Reuters", "Axios", "CNN", "CBS", "ABC", "NBC", "Daily Mail"];
try {
  const rows = await db.select().from(tripwireRecords).where(and(eq(tripwireRecords.kind, "article"), inArray(tripwireRecords.owner, ["workspace", "public"])));
  const merged = new Map<string, typeof rows[number]>();
  for (const row of rows.sort((a,b) => a.owner === b.owner ? 0 : a.owner === "public" ? -1 : 1)) merged.set(String(row.data.baseId ?? row.id), row);
  const articles = [...merged].map(([id, row]) => ({ id, ...row.data } as { id: string; title: string; outlet?: string; fullTextHash?: string; fullText?: string; summary?: string; topic?: string; impact?: string; publishedAt?: string; byline?: string; url?: string; entities?: string[] }));
  const inventory = [];
  for (const sample of samples) {
    const outlet = outlets.find(o => norm(sample.metadata).includes(norm(o)));
    const prefix = norm(sample.headline.replace(/[.…]+$/, ""));
    const candidates = articles.filter(a => (!outlet || a.outlet === outlet) &&
      (norm(a.title) === prefix || prefix.length > 18 && norm(a.title).startsWith(prefix)));
    let match = candidates.length === 1 ? candidates[0] : undefined;
    // Dates disambiguate repeated/truncated headlines; never select by score alone.
    if (candidates.length > 1) {
      const date = sample.metadata.match(/(\d{2}) ([A-Z]{3})/)?.slice(1);
      const dated = candidates.filter(a => {
        if (!a.publishedAt || !date) return false;
        const value = new Intl.DateTimeFormat("en-GB", {timeZone:"America/New_York", day:"2-digit", month:"short"}).format(new Date(a.publishedAt)).toUpperCase();
        return value === date.join(" ");
      });
      if (dated.length === 1) match = dated[0];
    }
    let body = match?.fullText ?? "";
    if (match?.fullTextHash) {
      const [blob] = await db.select({ text: tripwireContent.text }).from(tripwireContent).where(eq(tripwireContent.hash, match.fullTextHash));
      body = blob?.text ?? "";
    }
    const assessment = match ? assessArticle({ ...match, fullText: body }) : undefined;
    inventory.push({ ...sample, outlet, matchStatus: match ? "matched-retained-identity" : candidates.length ? "ambiguous" : "unresolved",
      articleId: match?.id, url: match?.url, fullHeadline: match?.title, byline: match?.byline, publishedAt: match?.publishedAt,
      candidates: match ? undefined : candidates.map(a => ({ id: a.id, title: a.title, url: a.url })),
      retainedCharacters: match ? body.length : undefined, contentHash: match?.fullTextHash,
      prior: previousReport?.inventory.find((i: Sample) => i.sample === sample.sample && i.row === sample.row)?.prior ??
        (match ? { topic: match.topic, impact: match.impact ?? sample.sample.toLowerCase(), entities: match.entities } : undefined),
      proposed: assessment ? { relevance: assessment.relevance, topic: assessment.topic, impact: assessment.impact, confidence: assessment.confidence,
        explanation: assessment.explanation, evidence: assessment.evidence } : { relevance: "review", explanation: "No unambiguous retained article identity; no invented headline completion or disposition." },
      reviewStatus: !match || assessment?.confidence !== "high" ? "needs-review" : "retained-text-policy-evaluation",
    });
  }
  const totals = Object.fromEntries(["LOW", "HIGH", "CRITICAL"].map(s => [s, samples.filter(x => x.sample === s).length]));
  if (totals.LOW !== 158 || totals.HIGH !== 202 || totals.CRITICAL !== 222) throw new Error(`Unexpected inventory counts ${JSON.stringify(totals)}`);
  const report = { policyVersion: IMPACT_POLICY_VERSION, generatedAt: new Date().toISOString(), totals,
    matched: inventory.filter(i => i.articleId).length, unresolved: inventory.filter(i => !i.articleId).length,
    review: inventory.filter(i => i.reviewStatus === "needs-review").length,
    note: "All rows inventoried. PDF page references preserve truncated titles. Policy proposals use matched retained text, not external verification. Planning visually inspected every PDF page; execution re-rendered HIGH page 1 to confirm the three red-circled negatives. Automated proposals are not sourcing judgments.",
    inventory };
  await mkdir("docs/calibration", { recursive: true });
  await writeFile("docs/calibration/sample-inventory.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, inventory: undefined }, null, 2));
} finally { await pool.end(); }
