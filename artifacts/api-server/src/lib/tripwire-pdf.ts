import { extractText, getDocumentProxy } from "unpdf";

/** Preserve the paragraph layout of a publisher's single-column print view. */
export async function pdfDocument(bytes: Buffer): Promise<{ text: string; outlet?: string }> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const metadata = await doc.getMetadata();
    const title = String((metadata.info as { Title?: string })?.Title ?? "");
    if (!/[-–—]\s*The Washington Post$/i.test(title)) {
      return { text: (await extractText(doc, { mergePages: true })).text };
    }
    const paragraphs: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines: { y: number; height: number; font: string; parts: { x: number; text: string; font: string; height: number }[] }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        let line = lines.find(l => Math.abs(l.y - item.transform[5]!) < 2);
        if (!line) { line = { y: item.transform[5]!, height: item.height, font: item.fontName, parts: [] }; lines.push(line); }
        line.height = Math.max(line.height, item.height);
        line.parts.push({ x: item.transform[4]!, text: item.str, font: item.fontName, height: item.height });
      }
      lines.sort((a, b) => b.y - a.y);
      const gaps = lines.slice(1).map((line, i) => lines[i]!.y - line.y).filter(gap => gap > 2 && gap < 80).sort((a, b) => a - b);
      const leading = gaps[Math.floor(gaps.length * 0.35)] ?? 16;
      let block = "", previous: (typeof lines[number] & { text: string }) | undefined;
      for (const line of lines) {
        const text = line.parts.sort((a, b) => a.x - b.x).map(p => p.text).join("").trim();
        if (!text) continue;
        // Hyperlinks and fallback glyphs can use another font mid-sentence.
        // Base layout on the dominant font, not the first word on each line.
        const weights = new Map<string, number>();
        for (const part of line.parts) weights.set(part.font, (weights.get(part.font) ?? 0) + part.text.trim().length);
        line.font = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? line.font;
        line.height = line.parts.find(p => p.font === line.font && p.height > 0)?.height ?? line.height;
        const heading = (s: string) => s.length < 80 && !/[.!?:;”“"]$/.test(s);
        if (previous && (previous.y - line.y > Math.max(Math.max(previous.height, line.height) * 1.8, leading * 1.45) ||
          Math.abs(previous.height - line.height) > 2 || previous.font !== line.font && (heading(previous.text) || heading(text)))) {
          if (block) paragraphs.push(block);
          block = "";
        }
        block += `${block ? " " : ""}${text}`;
        previous = { ...line, text };
      }
      if (block) paragraphs.push(block);
    }
    return { text: paragraphs.join("\n\n"), outlet: "The Washington Post" };
  } finally { await doc.loadingTask.destroy(); }
}
