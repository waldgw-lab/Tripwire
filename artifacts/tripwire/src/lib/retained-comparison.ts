/** Offsets are JavaScript UTF-16 positions in the ORIGINAL capture only. */
export function retainedComparison(original: string, selected: string, excerpt: string, start: number, end: number) {
  const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start
    && end <= original.length && original.slice(start, end) === excerpt;
  const selectedStart = valid ? selected.indexOf(excerpt) : -1;
  const context = (text: string, a: number, b: number) => {
    let left = Math.max(0, a - 240), right = Math.min(text.length, b + 240);
    if (left && /[\uDC00-\uDFFF]/.test(text[left])) left--;
    if (right < text.length && /[\uD800-\uDBFF]/.test(text[right - 1])) right++;
    return { before: text.slice(left, a), quote: text.slice(a, b), after: text.slice(b, right) };
  };
  return { valid, original: valid ? context(original, start, end) : null,
    selectedStart: selectedStart < 0 ? null : selectedStart,
    selected: selectedStart < 0 ? null : context(selected, selectedStart, selectedStart + excerpt.length) };
}
