import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetArticleFocus, useCorrectArticleFocus, useGetClaimCategories,
  getGetClaimCoverageSummariesQueryKey, useListFocusGroups, type ArticleFocusState, type TrackedRecord,
} from '@workspace/api-client-react';
import { errText, newRequestId, useInvalidateWorkspace } from '@/lib/workspace';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const ctl = 'h-8 w-full rounded-md border border-input bg-background px-2 text-xs';

/** This always edits one article, never a group definition or claim record. */
export function FocusCorrection({ article, compact = false }: { article: TrackedRecord; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useGetArticleFocus(article.id, { query: { enabled: open, staleTime: 0, refetchInterval: 30_000 } });
  return <>
    <button type="button" onClick={() => setOpen(true)} data-testid={`button-focus-${article.id}`}
      className="text-left text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {compact ? 'Correct focus' : article.focusOverride ? `Focus: ${article.focusOverride.topicTitle} · analyst · Edit` : 'Article focus · Automatic · Edit'}
    </button>
    {open && <Dialog open onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Article focus</DialogTitle>
        <p className="text-xs text-muted-foreground">Applies to this article only. Choosing or editing a label does not rename a shared group or move its other articles. Claims and source links stay unchanged.</p>
        {q.isError && q.data && <p role="alert" className="text-xs">The focus could not refresh. Your edits are retained. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>}
        {q.isLoading && !q.data ? <p className="text-xs">Loading focus…</p> : !q.data ?
          <p role="alert" className="text-xs">Could not load article focus. <button className="underline" onClick={() => q.refetch()}>Retry</button></p> :
          <FocusForm key={article.id} articleId={article.id} state={q.data} onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>}
  </>;
}

function FocusForm({ articleId, state, onClose }: { articleId: string; state: ArticleFocusState; onClose: () => void }) {
  const [base] = useState(state);
  const changed = base.revision !== state.revision;
  const [category, setCategory] = useState(state.effective.categoryId);
  const [title, setTitle] = useState(state.effective.topicTitle);
  const [group, setGroup] = useState('');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => clearTimeout(t); }, [search]);
  const groups = useListFocusGroups({ q: query, offset }, { query: { staleTime: 15_000 } });
  const choices = groups.data?.groups ?? [];
  const categories = useGetClaimCategories();
  const mutation = useCorrectArticleFocus();
  const qc = useQueryClient();
  const invalidate = useInvalidateWorkspace();
  const save = async (mode: 'auto' | 'manual') => {
    setError('');
    try {
      await mutation.mutateAsync({ id: articleId, data: {
        mode, expectedRevision: base.revision, requestId,
        ...(mode === 'manual' ? { categoryId: category, topicTitle: title.trim(), ...(group ? { topicId: group } : {}) } : {}),
      } });
      await Promise.all([
        invalidate(),
        qc.invalidateQueries({ queryKey: getGetClaimCoverageSummariesQueryKey() }),
        qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /\/records\/[^/]+\/focus$/.test(q.queryKey[0]) }),
      ]);
      onClose();
    } catch (e) {
      setError(errText(e));
      // A changed decision must never reuse an ambiguous failed request.
      setRequestId(newRequestId());
      await qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /\/records\/[^/]+\/focus$/.test(q.queryKey[0]) });
    }
  };
  const change = () => { setGroup(''); setRequestId(newRequestId()); };
  return <form onSubmit={e => { e.preventDefault(); void save('manual'); }} className="space-y-3">
    <p className="text-xs" data-testid="text-current-focus">Current: {state.effective.topicTitle} · {state.mode === 'manual' ? 'Analyst correction' : 'Automatic'}</p>
    <label className="block text-xs">Search groups
      <input className={ctl} placeholder="Search existing focus labels" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-focus" />
    </label>
    <label className="block text-xs">Existing group
      <select className={ctl} value={group} disabled={mutation.isPending} data-testid="select-existing-focus"
        onChange={e => {
          const g = choices.find(g => g.topicId === e.target.value);
          setGroup(e.target.value); setRequestId(newRequestId());
          if (g) { setCategory(g.categoryId); setTitle(g.topicTitle); }
        }}>
        <option value="">Custom label / category</option>
        {group && !choices.some(g => g.topicId === group) && <option value={group}>{title}</option>}
        {choices.map(g => <option key={`${g.categoryId}:${g.topicId}`} value={g.topicId}>{g.topicTitle} · {categories.data?.find(c => c.id === g.categoryId)?.label ?? g.categoryId}</option>)}
      </select>
    </label>
    {groups.isError && <p role="alert" className="text-xs">Group search unavailable. <button type="button" onClick={() => groups.refetch()} className="underline">Retry</button></p>}
    <div className="flex gap-3 text-xs"><button type="button" disabled={!offset || groups.isFetching} onClick={() => setOffset(o => Math.max(0, o - 25))}>Previous</button>
      <button type="button" disabled={!groups.data?.hasMore || groups.isFetching} onClick={() => setOffset(o => o + 25)}>More groups</button>
      {groups.isFetching && <span>Searching…</span>}
    </div>
    <label className="block text-xs">Primary category
      <select className={ctl} value={category} disabled={mutation.isPending || !categories.data} data-testid="select-focus-category" onChange={e => { setCategory(e.target.value); change(); }}>
        {(categories.data ?? [{ id: category, label: category }]).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </label>
    {categories.isError && <p role="alert" className="text-xs">Categories unavailable. <button type="button" className="underline" onClick={() => categories.refetch()}>Retry</button></p>}
    <label className="block text-xs">Focus label
      <input className={ctl} value={title} required maxLength={300} disabled={mutation.isPending} data-testid="input-focus-label" onChange={e => { setTitle(e.target.value); change(); }} />
    </label>
    <p className="text-[11px] text-muted-foreground">Automatic placement: {state.automatic.topicTitle}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {changed && <p role="alert" className="text-xs text-destructive">Focus changed elsewhere. Close and reopen to review the latest placement before deciding again.</p>}
    <div className="flex flex-wrap justify-end gap-3 text-xs">
      <button type="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
      {state.mode === 'manual' && <button type="button" className="underline" disabled={mutation.isPending || changed} data-testid="button-clear-focus" onClick={() => void save('auto')}>Return to automatic</button>}
      <button type="submit" disabled={mutation.isPending || changed || !title.trim() || !categories.data} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" data-testid="button-save-focus">{mutation.isPending ? 'Saving…' : 'Save article focus'}</button>
    </div>
  </form>;
}
