import { boundedDocument } from "./tripwire-document-parser";

/** Preserve publisher layout inside the memory/time-limited parser worker. */
export async function pdfDocument(bytes: Buffer): Promise<{ text: string; outlet?: string }> {
  return boundedDocument(bytes, "publisher.pdf");
}
