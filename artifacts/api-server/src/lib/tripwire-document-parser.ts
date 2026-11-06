import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { parsePdfWith } from "./tripwire-pdf-layout";
const require = createRequire(import.meta.url);

// The worker executes this fixed parser program, never document-provided code.
// Memory/time ceilings contain pathological PDFs/OLE/ZIPs and do not block API.
const program = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
// Compiler name annotations are harmless in this isolated fixed program.
const __name = (value) => value;
const parsePdf = ${parsePdfWith.toString()};
(async () => {
  const bytes = Buffer.from(workerData.bytes);
  const mod = await import(pathToFileURL(workerData.module).href);
  let text, outlet;
  if (workerData.kind === 'pdf') { const result = await parsePdf(mod, bytes); text = result.text; outlet = result.outlet; }
  else if (workerData.kind === 'docx') text = (await (mod.default || mod).extractRawText({ buffer: bytes })).value;
  else {
    const WordExtractor = mod.default || mod;
    const document = await new WordExtractor().extract(bytes);
    text = [document.getHeaders(),document.getBody(),document.getTextboxes(),document.getFootnotes(),document.getEndnotes()].filter(Boolean).join('\\n\\n');
  }
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('Parsing limit');
  parentPort.postMessage({text,outlet});
})().catch(() => parentPort.postMessage({error:true}));
`;
export async function boundedDocumentText(bytes: Buffer, filename: string) {
  return (await boundedDocument(bytes, filename)).text;
}
export async function boundedDocument(bytes: Buffer, filename: string) {
  if (bytes.length > 10485760) throw new Error("Files must be 10 MB or smaller");
  let kind: string, module: string;
  if (bytes.subarray(0, 5).toString() === "%PDF-") { kind = "pdf"; module = require.resolve("unpdf"); }
  else if (bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1") { kind = "doc"; module = require.resolve("word-extractor"); }
  else if (bytes.subarray(0, 2).toString() === "PK" && /\.docx$/i.test(filename)) {
    let total = 0, entries = 0;
    for (let offset = 0; offset < bytes.length - 46; offset++) if (bytes.readUInt32LE(offset) === 0x02014b50) {
      total += bytes.readUInt32LE(offset + 24); entries++;
      if (total > 25_000_000 || entries > 3000) throw new Error("Document expands beyond the safe parsing limit");
    }
    kind = "docx"; module = require.resolve("mammoth");
  } else throw new Error("The file is not a supported PDF, DOC or DOCX document");
  return new Promise<{ text: string; outlet?: string }>((resolve, reject) => {
    const worker = new Worker(program, { eval: true, env: {}, workerData: { bytes, kind, module },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Document parsing exceeded its time limit")); }, 15000);
    worker.once("message", (value: { text?: string; outlet?: string; error?: boolean }) => {
      clearTimeout(timer); void worker.terminate();
      const text = value.text?.trim();
      if (!text || value.error) reject(new Error("No readable text was found within safe parsing limits. Use extracted text for scanned or encrypted documents."));
      else resolve({ text, outlet: value.outlet });
    });
    worker.once("error", () => { clearTimeout(timer); reject(new Error("Document exceeded safe parsing limits")); });
    worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error("Document parser stopped")); });
  });
}
