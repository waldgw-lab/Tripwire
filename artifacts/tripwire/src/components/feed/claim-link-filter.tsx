import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { categoryKey, categoryLabel, groupKey, topicLabel, type ClaimFeedFilter, type ClaimLinkMode, type useClaimLinkage } from '@/lib/claim-groups';

export function ClaimLinkFilter({ value, onChange, linkage }: { value: ClaimFeedFilter; onChange: (v: ClaimFeedFilter) => void; linkage: ReturnType<typeof useClaimLinkage> }) {
  const { summaries, summaryById, categoryById, linkageKnown } = linkage;
  const tree = useMemo(() => {
    const cats = new Map<string, Map<string, string>>();
    for (const s of summaries.data ?? []) {
      if (!s.articleIds?.length) continue;
      const ck = categoryKey(s);
      const m = cats.get(ck) ?? new Map(); m.set(groupKey(s), topicLabel(s)); cats.set(ck, m);
    }
    const order = new Map((linkage.categories.data ?? []).map((c, i) => [c.id, i]));
    return [...cats.entries()].sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
      .map(([ck, m]) => ({ ck, label: categoryLabel(ck, categoryById, [...summaryById.values()].find(s => categoryKey(s) === ck)), topics: [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])) }));
  }, [summaries.data, linkage.categories.data, categoryById, summaryById]);
  const toggle = (k: 'categories' | 'topics', id: string, on: boolean) => onChange({ ...value, [k]: on ? [...value[k], id] : value[k].filter(x => x !== id) });

  return (
    <fieldset className="min-w-0 rounded-lg border border-border p-3 min-[420px]:col-span-2 md:col-span-3" data-testid="filter-category-claims">
      <legend className="px-1 text-xs font-semibold">Claims</legend>
      {summaries.isLoading ? <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        : summaries.isError && !summaries.data ? <p className="flex items-center gap-2 text-xs text-muted-foreground">Claim links unavailable; not filtering. <button type="button" onClick={() => summaries.refetch()} className="inline-flex items-center gap-1 underline" data-testid="button-claim-filter-retry"><RefreshCw className="h-3 w-3" /> Retry</button></p>
        : !linkageKnown ? <p className="text-xs text-muted-foreground">Claim linkage not yet available; not filtering.</p>
        : <>
          <div className="mb-2 flex items-center gap-3">
            <div className="inline-flex h-7 overflow-hidden rounded-md border border-input text-xs" role="group" aria-label="Claim linkage">
              {(['all', 'with', 'without'] as ClaimLinkMode[]).map(m => (
                <button key={m} type="button" onClick={() => onChange({ ...value, mode: m, ...(m === 'without' ? { categories: [], topics: [] } : {}) })} aria-pressed={value.mode === m}
                  className={cn('px-2.5', value.mode === m ? 'bg-foreground text-background' : 'hover:bg-muted')} data-testid={`filter-claims-${m}`}>
                  {m === 'all' ? 'All' : m === 'with' ? 'With claims' : 'Without claims'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => onChange({ ...value, categories: [], topics: [] })} disabled={!value.categories.length && !value.topics.length} className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="filter-clear-claim-topics">Clear topics</button>
          </div>
          {value.mode === 'without' ? <p className="text-xs text-muted-foreground" data-testid="text-claim-topics-disabled">Category and topic filters are cleared and disabled while showing articles without claims.</p> : (tree.length ? (
            <div className="grid max-h-56 gap-2 overflow-y-auto min-[420px]:grid-cols-2 md:grid-cols-3">
              {tree.map(c => (
                <div key={c.ck} className="min-w-0">
                  <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs font-medium hover:bg-muted">
                    <input type="checkbox" checked={value.categories.includes(c.ck)} onChange={e => toggle('categories', c.ck, e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-black" data-testid={`filter-option-claim-category-${c.ck}`} />
                    {c.label}
                  </label>
                  {c.topics.map(([tk, t]) => (
                    <label key={tk} className="ml-4 flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted">
                      <input type="checkbox" checked={value.topics.includes(tk)} onChange={e => toggle('topics', tk, e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-black" data-testid={`filter-option-claim-topic-${tk}`} />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">No article-linked claim topics yet.</p>)}
        </>}
    </fieldset>
  );
}
