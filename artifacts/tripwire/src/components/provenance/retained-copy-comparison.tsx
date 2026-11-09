import { useState } from 'react';
import {
  useGetArticleContent, useListEntityCaptures, getGetArticleContentQueryKey,
  getListEntityCapturesQueryKey, type ReportingEvidenceVersion,
} from '@workspace/api-client-react';
import { retainedComparison } from '@/lib/retained-comparison';

export function RetainedCopyComparison({ articleId, version }: { articleId: string; version: ReportingEvidenceVersion }) {
  const [open, setOpen] = useState(false);
  const captures = useListEntityCaptures({ articleId }, { query: {
    queryKey: getListEntityCapturesQueryKey({ articleId }), enabled: open, staleTime: 60_000,
  } });
  const capture = captures.data?.items.find(c => c.id === version.captureId);
  const params = capture ? { capture: capture.captureId } : undefined;
  const original = useGetArticleContent(articleId, params, { query: {
    queryKey: getGetArticleContentQueryKey(articleId, params), enabled: open && !!capture, staleTime: 60_000,
  } });
  const selected = useGetArticleContent(articleId, undefined, { query: {
    queryKey: getGetArticleContentQueryKey(articleId), enabled: open, staleTime: 60_000,
  } });
  const pending = captures.isLoading || (capture && original.isLoading) || selected.isLoading;
  const failed = captures.isError || original.isError || selected.isError;
  const comparison = original.data && selected.data && version.excerpt && version.start != null && version.end != null
    ? retainedComparison(original.data.text, selected.data.text, version.excerpt, version.start, version.end) : null;
  return (
    <details className="mt-2 rounded-md border border-border bg-card/60 px-3 py-2"
      onToggle={e => setOpen(e.currentTarget.open)} data-testid={`comparison-${version.evidenceId ?? version.captureId}`}>
      <summary className="cursor-pointer text-xs font-medium">Compare retained copies</summary>
      {open && <div className="mt-3 space-y-3 text-xs">
        <p className="text-muted-foreground">Read-only comparison. This does not change selected text, historical quotations, reviews or claim placement.</p>
        {pending ? <p role="status">Loading retained copies…</p> : failed ? <div role="alert">
          <p>Retained copies could not be loaded.</p>
          <button className="mt-1 underline" onClick={() => { void captures.refetch(); if (capture) void original.refetch(); void selected.refetch(); }}>Retry comparison</button>
        </div> : !capture ? <p role="status">The original capture is unavailable on this article.</p>
          : !comparison?.valid ? <p role="status">The historical quotation could not be validated at its original offsets. No comparison is inferred.</p>
          : <div className="grid gap-3 xl:grid-cols-2">
            <section><h4 className="mb-1 font-medium">Original capture context</h4>
              <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-2 text-muted-foreground">{comparison.original!.before}<mark className="bg-primary/15 text-foreground">{comparison.original!.quote}</mark>{comparison.original!.after}</blockquote>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Original offsets {version.start}–{version.end} · capture {version.captureId}</p>
            </section>
            <section><h4 className="mb-1 font-medium">Currently selected copy</h4>
              {comparison.selected ? <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-2 text-muted-foreground">{comparison.selected.before}<mark className="bg-primary/15 text-foreground">{comparison.selected.quote}</mark>{comparison.selected.after}</blockquote>
                : <p>Exact wording is absent from this selected copy. This does not mean the claim is false or disproved.</p>}
              {comparison.selectedStart != null && <p className="mt-1 font-mono text-[10px] text-muted-foreground">Position in selected text {comparison.selectedStart} (not the original evidence offset)</p>}
            </section>
          </div>}
      </div>}
    </details>
  );
}
