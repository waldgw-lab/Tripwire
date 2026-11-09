import { useState } from 'react';
import { useGetFocusGroup, useGetClaimCategories, useUpdateFocusGroup, type FocusGroupDetail, type FocusGroupArticlesResult } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { errText, fmtDate, newRequestId, useInvalidateClaims } from '@/lib/workspace';
import { FocusArticleBatch } from './focus-article-batch';
import { Link } from 'wouter';

const ctl = 'mt-1 w-full rounded border border-input bg-background p-2 text-xs';

const tab = (on: boolean) => `rounded px-3 py-1.5 text-xs ${on ? 'bg-foreground text-background' : 'border border-input bg-card hover:bg-muted'}`;

export function FocusGroupEditor({ topicId, onSaved, onArticlesSaved }: { topicId: string; onSaved?: (group: FocusGroupDetail) => void; onArticlesSaved?: (r: FocusGroupArticlesResult) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'shared' | 'articles'>('shared');
  const [busy, setBusy] = useState(false);
  const setOpenSafe = (o: boolean) => { if (busy && !o) return; setOpen(o); if (!o) setMode('shared'); };
  const q = useGetFocusGroup(topicId, { query: { enabled: open, staleTime: 0, refetchInterval: 30_000 } });
  return <>
    <button type="button" className="shrink-0 p-2 text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => setOpenSafe(true)} data-testid={`button-edit-group-${topicId}`}>Edit group</button>
    {open && <Dialog open onOpenChange={setOpenSafe}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogTitle>{mode === 'shared' ? 'Edit shared focus group' : 'Edit selected articles'}</DialogTitle>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Edit scope">
          <button type="button" role="tab" aria-selected={mode === 'articles'} disabled={busy} className={tab(mode === 'articles')} onClick={() => setMode('articles')} data-testid="button-group-mode-articles">Edit selected articles</button>
          <button type="button" role="tab" aria-selected={mode === 'shared'} disabled={busy} className={tab(mode === 'shared')} onClick={() => setMode('shared')} data-testid="button-group-mode-shared">Shared label/category</button>
        </div>
        {q.isError && q.data && <p role="alert" className="text-xs">The preview could not refresh. Your edits are retained. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>}
        {q.isLoading && !q.data ? <p>Loading preview…</p> : !q.data ? <p role="alert">Group preview unavailable. <button className="underline" onClick={() => q.refetch()}>Retry</button></p> :
          mode === 'articles' ? <FocusArticleBatch key={`b-${topicId}`} topicId={topicId} source={q.data} onPending={setBusy} onCancel={() => setOpenSafe(false)}
            onDone={r => { setBusy(false); onArticlesSaved?.(r); setOpen(false); setMode('shared'); }} /> :
          <GroupForm key={topicId} topicId={topicId} current={q.data} onDone={d => { onSaved?.(d); setOpen(false); }} onCancel={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>}
  </>;
}

function GroupForm({ topicId, current, onDone, onCancel }: { topicId: string; current: FocusGroupDetail; onDone: (d: FocusGroupDetail) => void; onCancel: () => void }) {
  const [base] = useState(current);
  const [label, setLabel] = useState(current.effective.topicTitle);
  const [category, setCategory] = useState(current.effective.categoryId);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const categories = useGetClaimCategories();
  const m = useUpdateFocusGroup();
  const invalidate = useInvalidateClaims();
  const changed = base.token !== current.token;
  const save = async (mode: 'manual' | 'auto') => {
    if (!confirmed || changed) return;
    setError('');
    try {
      const d = await m.mutateAsync({ id: topicId, data: { mode, expectedToken: base.token, confirmed, reason: reason.trim(), requestId: newRequestId(),
        ...(mode === 'manual' ? { categoryId: category, topicTitle: label.trim() } : {}) } });
      await invalidate(); onDone(d);
    } catch (e) { setError(errText(e)); }
  };
  const disabled = m.isPending || changed || !confirmed || reason.trim().length < 5;
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save('manual'); }}>
    <p className="text-xs" data-testid="text-group-scope">This changes a shared label/category for {current.count} reporting article{current.count === 1 ? '' : 's'}, including future articles placed in this group. It does not change article text, claims, evidence links or article-only overrides.</p>
    <label className="block text-xs">Shared label<input className={ctl} maxLength={300} value={label} onChange={e => { setLabel(e.target.value); setConfirmed(false); }} data-testid="input-group-label" /></label>
    <label className="block text-xs">Primary category<select className={ctl} value={category} onChange={e => { setCategory(e.target.value); setConfirmed(false); }} disabled={!categories.data} data-testid="select-group-category">
      {(categories.data ?? [{ id: category, label: category }]).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select></label>
    {categories.isError && <p role="alert" className="text-xs">Category list unavailable. <button type="button" className="underline" onClick={() => categories.refetch()}>Retry</button></p>}
    <details className="text-xs" open><summary>Affected articles · {current.count}</summary>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">{current.articles.map(a => <li key={a.id}><Link className="underline" href={`/feed?article=${encodeURIComponent(a.id)}`}>{a.title}</Link></li>)}</ul>
      {current.count > current.articles.length && <p>Showing the first {current.articles.length}; the change applies to all {current.count}.</p>}
    </details>
    <label className="block text-xs">Reason<textarea className={ctl} rows={2} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-group-reason" /></label>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-group" />I reviewed the scope and want to change this shared group, not just one article.</label>
    {current.mode === 'manual' && <p className="text-xs text-muted-foreground">Removing the shared correction restores underlying labels/categories; article-only choices remain.</p>}
    {changed && <p role="alert" className="text-xs text-destructive">Group membership or labels changed. Close and reopen to review the latest preview.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="flex justify-end gap-3 text-xs">
      <button type="button" disabled={m.isPending} onClick={onCancel}>Cancel</button>
      {current.mode === 'manual' && <button type="button" disabled={disabled} className="underline" onClick={() => void save('auto')} data-testid="button-reset-group">Remove shared correction</button>}
      <button type="submit" disabled={disabled || !label.trim() || !categories.data} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" data-testid="button-save-group">{m.isPending ? 'Saving…' : 'Save shared group'}</button>
    </div>
    {!!current.history.length && <details className="text-xs"><summary>Group correction history</summary><ul className="mt-2 space-y-2">{current.history.map(h => <li key={h.id}><p>{h.before?.topicTitle} → {h.after?.topicTitle} · {h.after?.categoryId}</p><p className="text-muted-foreground">{h.reason} · {fmtDate(h.timestamp)}</p></li>)}</ul></details>}
  </form>;
}
