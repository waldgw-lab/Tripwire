import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  useGetFocusGroupArticles, getGetFocusGroupArticlesQueryKey, useListFocusGroups, getListFocusGroupsQueryKey,
  useGetClaimCategories, useCorrectFocusGroupArticles, type FocusGroupDetail, type FocusGroupArticlesResult,
} from '@workspace/api-client-react';
import { errText, newRequestId, useInvalidateClaims } from '@/lib/workspace';

const ctl = 'mt-1 w-full rounded border border-input bg-background p-2 text-xs';
const MAX = 100;
const PAGE = 50;

/** Edits ONLY explicitly checked articles. Never renames the shared group. */
export function FocusArticleBatch({ topicId, source, onDone, onCancel, onPending }: {
  topicId: string; source: FocusGroupDetail; onDone: (r: FocusGroupArticlesResult) => void; onCancel: () => void; onPending: (p: boolean) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [baseToken] = useState(source.token);
  const page = useGetFocusGroupArticles(topicId, { offset }, { query: { queryKey: getGetFocusGroupArticlesQueryKey(topicId, { offset }), staleTime: 0, refetchInterval: 30_000 } });
  const [selected, setSelected] = useState<Map<string, string>>(() => new Map());
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [category, setCategory] = useState(source.effective.categoryId);
  const [label, setLabel] = useState(source.effective.topicTitle);
  const [destTopic, setDestTopic] = useState<string | undefined>(source.effective.topicId);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const categories = useGetClaimCategories();
  const groups = useListFocusGroups({ q: search.trim() || undefined, offset: 0 }, { query: { queryKey: getListFocusGroupsQueryKey({ q: search.trim() || undefined, offset: 0 }), enabled: mode === 'manual' } });
  const m = useCorrectFocusGroupArticles();
  const invalidate = useInvalidateClaims();
  const pendingRef = useRef(onPending); pendingRef.current = onPending;
  useEffect(() => { pendingRef.current(m.isPending); }, [m.isPending]);

  const stale = source.token !== baseToken || !!page.data && page.data.token !== baseToken;
  const rows = page.data?.articles ?? [];
  const pageIds = rows.map(a => a.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const unconfirm = () => setConfirmed(false);
  const toggle = (id: string, title: string) => { unconfirm(); setSelected(prev => {
    const n = new Map(prev); if (n.has(id)) n.delete(id); else if (n.size < MAX) n.set(id, title); return n; }); };
  const togglePage = () => { unconfirm(); setSelected(prev => {
    const n = new Map(prev);
    if (allOnPage) pageIds.forEach(id => n.delete(id));
    else for (const a of rows) { if (n.size >= MAX) break; n.set(a.id, a.title); }
    return n; }); };
  const room = MAX - selected.size;

  const save = async () => {
    if (!confirmed || stale || !selected.size) return;
    setError('');
    try {
      const r = await m.mutateAsync({ id: topicId, data: {
        articleIds: [...selected.keys()], mode, expectedToken: baseToken, reason: reason.trim(), requestId: newRequestId(),
        ...(mode === 'manual' ? { categoryId: category, topicTitle: label.trim(), ...(destTopic ? { topicId: destTopic } : {}) } : {}),
      } });
      await invalidate(); onDone(r);
    } catch (e) { setError(errText(e)); setConfirmed(false); }
  };
  const disabled = m.isPending || stale || !confirmed || !selected.size || reason.trim().length < 5 || (mode === 'manual' && (!label.trim() || !category || !categories.data));

  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }} aria-label="Edit selected articles">
    <fieldset disabled={m.isPending} className="contents">
    <p className="text-xs" data-testid="text-batch-scope">Only the articles you check are moved. The shared group label, unselected articles and future articles are unchanged.</p>

    <fieldset className="rounded border border-border">
      <legend className="sr-only">Articles in this group</legend>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allOnPage} onChange={togglePage} disabled={!rows.length || (!allOnPage && room === 0)} aria-label="Select or deselect all articles on this page" data-testid="checkbox-group-page" />
          This page
        </label>
        <span className="font-mono text-[11px]" aria-live="polite" data-testid="text-batch-selected">{selected.size} of max {MAX} selected</span>
      </div>
      {page.isLoading ? <div className="space-y-1.5 p-2" aria-busy>{[0, 1, 2, 3].map(i => <div key={i} className="h-3 animate-pulse rounded bg-muted" />)}</div>
        : page.isError ? <p role="alert" className="p-2 text-xs">Article list unavailable. <button type="button" className="underline" onClick={() => page.refetch()}>Retry</button></p>
        : <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto">{rows.map(a => <li key={a.id} className="flex items-start gap-2 px-2 py-1.5 text-xs">
            <input id={`batch-${a.id}`} type="checkbox" className="mt-0.5" checked={selected.has(a.id)} disabled={!selected.has(a.id) && room === 0}
              onChange={() => toggle(a.id, a.title)} aria-label={`Select ${a.title}`} data-testid={`checkbox-group-article-${a.id}`} />
            <label htmlFor={`batch-${a.id}`} className="min-w-0 flex-1 cursor-pointer leading-snug">{a.title}</label>
             <Link href={`/feed?article=${encodeURIComponent(a.id)}`} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] text-muted-foreground underline" aria-label={`Open ${a.title} in feed`}>Open</Link>
          </li>)}</ul>}
      <div className="flex items-center justify-between border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        <button type="button" className="underline disabled:opacity-40" disabled={offset === 0 || page.isFetching} onClick={() => setOffset(o => Math.max(0, o - PAGE))} data-testid="button-batch-prev">Previous</button>
        <span>{page.data ? `${page.data.count ? offset + 1 : 0}–${offset + rows.length} of ${page.data.count}` : '…'}</span>
        <button type="button" className="underline disabled:opacity-40" disabled={!page.data?.hasMore || page.isFetching} onClick={() => setOffset(o => o + PAGE)} data-testid="button-batch-next">Next</button>
      </div>
    </fieldset>
    {room === 0 && <p className="text-[11px] text-muted-foreground">Selection limit of {MAX} reached. Save this batch, then reopen for more.</p>}

    <div className="inline-flex overflow-hidden rounded-md border border-input text-xs" role="radiogroup" aria-label="Destination for selected articles">
      {(['manual', 'auto'] as const).map(v => <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => { setMode(v); unconfirm(); }}
        className={mode === v ? 'bg-foreground px-3 py-1.5 text-background' : 'bg-card px-3 py-1.5 hover:bg-muted'} data-testid={v === 'auto' ? 'button-reset-batch' : undefined}>
        {v === 'manual' ? 'Move to manual focus' : 'Return selected to automatic'}</button>)}
    </div>

    {mode === 'manual' ? <div className="space-y-2 rounded border border-border p-2">
      <label className="block text-xs">Find existing group (optional)<input className={ctl} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search focus groups" /></label>
      {!!groups.data?.groups.length && <ul className="max-h-28 overflow-y-auto text-xs" aria-label="Matching focus groups">{groups.data.groups.map(g => <li key={`${g.categoryId}::${g.topicId}`}>
        <button type="button" className={`w-full rounded px-2 py-1 text-left hover:bg-muted ${destTopic === g.topicId && category === g.categoryId ? 'bg-muted font-medium' : ''}`}
          onClick={() => { setCategory(g.categoryId); setLabel(g.topicTitle); setDestTopic(g.topicId); unconfirm(); }}>{g.topicTitle} <span className="text-muted-foreground">· {categories.data?.find(c => c.id === g.categoryId)?.label ?? g.categoryId}</span></button></li>)}</ul>}
      {groups.isError && <p role="alert" className="text-[11px]">Group search unavailable. You can still type a label.</p>}
      {groups.data?.hasMore && <p className="text-[11px] text-muted-foreground">First 25 matches shown. Refine the search to find another group.</p>}
      <label className="block text-xs">Primary category<select className={ctl} value={category} onChange={e => { setCategory(e.target.value); setDestTopic(undefined); unconfirm(); }} disabled={!categories.data} data-testid="select-batch-category">
        {(categories.data ?? [{ id: category, label: category }]).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select></label>
      {categories.isError && <p role="alert" className="text-[11px]">Categories unavailable. <button type="button" className="underline" onClick={() => categories.refetch()}>Retry</button></p>}
      <label className="block text-xs">Focus label<input className={ctl} maxLength={300} value={label} onChange={e => { setLabel(e.target.value); setDestTopic(undefined); unconfirm(); }} data-testid="input-batch-label" /></label>
      <p className="text-[11px] text-muted-foreground">{destTopic ? 'Joins the existing group with this label.' : 'Label will be matched or created for the selected articles only.'}</p>
    </div> : <p className="rounded border border-border p-2 text-xs">Removes article-level focus choices for the selected articles so automatic placement applies again.</p>}

    <label className="block text-xs">Reason<textarea className={ctl} rows={2} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} aria-describedby="batch-reason-hint" data-testid="input-batch-reason" /></label>
    <p id="batch-reason-hint" className="-mt-2 text-[10px] text-muted-foreground">At least 5 characters.</p>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={!selected.size} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-batch" />
      I reviewed these {selected.size} selected article{selected.size === 1 ? '' : 's'} and want to change only them.</label>
    {stale && <p role="alert" className="text-xs text-destructive">Group membership changed since this preview opened. Close and reopen to review a fresh selection.</p>}
    {error && <p role="alert" className="text-xs text-destructive" data-testid="batch-error">{error}</p>}
    <div className="flex justify-end gap-3 text-xs">
      <button type="button" disabled={m.isPending} onClick={onCancel}>Cancel</button>
      <button type="submit" disabled={disabled} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" data-testid="button-save-batch">
        {m.isPending ? 'Saving…' : mode === 'manual' ? `Move ${selected.size} selected` : `Return ${selected.size} to automatic`}</button>
    </div>
    </fieldset>
  </form>;
}
