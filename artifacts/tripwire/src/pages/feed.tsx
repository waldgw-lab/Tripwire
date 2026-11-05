import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Bookmark, ExternalLink, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorState, PageHead, RowsSkeleton } from '@/components/bits';
import { impactRating } from '@/lib/article-signals';
import { FeedMeta } from '@/components/feed/feed-meta';
import { ArticleReader } from '@/components/feed/article-reader';
import { ArticleEditor, ConfirmDelete } from '@/components/editors';
import { OutletBrand } from '@/components/outlet-brand';
import { articleCredits } from '@/lib/media-coverage';
import { FOCUS, REPORTING, SENTIMENT, byKind, toInput, useRefresh, useSave, useWorkspace } from '@/lib/workspace';

const ALL = '__all';
const IMPACTS = ['critical', 'high', 'low'];
const readParam = () => new URLSearchParams(window.location.search).get('article');
function writeParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('article', id); else url.searchParams.delete('article');
  window.history.replaceState(window.history.state, '', url);
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={`filter-${label.toLowerCase()}`} className={cn('h-8 w-auto min-w-[110px] gap-1 bg-card text-xs', value !== ALL && 'border-accent text-accent')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: all</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function FeedPage({ mode }: { mode: 'public' | 'feed' | 'saved' }) {
  const { isSignedIn } = useAuth();
  const { data, isLoading, isError, refetch } = useWorkspace();
  const save = useSave();
  const refresh = useRefresh();
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState(ALL);
  const [outlet, setOutlet] = useState(ALL);
  const [rt, setRt] = useState(ALL);
  const [sent, setSent] = useState(ALL);
  const [focus, setFocus] = useState(ALL);
  const [impact, setImpact] = useState(ALL);
  const [open, setOpenState] = useState<string | null>(() => readParam());
  const setOpen = useCallback((id: string | null) => { setOpenState(id); writeParam(id); }, []);
  const [editing, setEditing] = useState<TrackedRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TrackedRecord | null>(null);

  const articles = useMemo(() => {
    const a = byKind(data?.records, 'article');
    return a.sort((x, y) => (y.publishedAt ?? y.createdAt).localeCompare(x.publishedAt ?? x.createdAt));
  }, [data]);
  const watches = useMemo(() => byKind(data?.records, 'watch'), [data]);
  const impacts = useMemo(() => new Map(articles.map((a) => [a.id, impactRating(a, watches)])), [articles, watches]);
  const topics = useMemo(() => [...new Set(articles.map((a) => a.topic).filter(Boolean) as string[])].sort(), [articles]);
  const outlets = useMemo(() => [...new Set(articles.map((a) => a.outlet).filter(Boolean) as string[])].sort(), [articles]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return articles.filter((a) => {
      if (mode === 'saved' && !a.saved) return false;
      if (topic !== ALL && a.topic !== topic) return false;
      if (outlet !== ALL && a.outlet !== outlet) return false;
      if (rt !== ALL && (a.reportingType ?? 'unassessed') !== rt) return false;
      if (sent !== ALL && (a.sentiment ?? 'unassessed') !== sent) return false;
      if (focus !== ALL && a.focus !== focus) return false;
      if (impact !== ALL && impacts.get(a.id)?.value !== impact) return false;
      if (!needle) return true;
      return [a.title, a.summary, a.fullText, a.outlet, a.topic, a.byline, ...articleCredits(a).map(c => c.name), ...(a.entities ?? [])]
        .some((s) => s?.toLowerCase().includes(needle));
    });
  }, [articles, impacts, q, topic, outlet, rt, sent, focus, impact, mode]);

  const selected = useMemo(() => (open ? articles.find((a) => a.id === open) ?? null : null), [articles, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (!selected || !narrow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const pane = document.getElementById('article-reader');
      const targets = [...(pane?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) return;
      if (!pane?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', trapTab);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', trapTab); };
  }, [selected, narrow]);

  const filtered = q || [topic, outlet, rt, sent, focus, impact].some((v) => v !== ALL);
  const clear = () => { setQ(''); setTopic(ALL); setOutlet(ALL); setRt(ALL); setSent(ALL); setFocus(ALL); setImpact(ALL); };
  const toggleSave = (a: TrackedRecord) => save.mutate({ data: { ...toInput(a), saved: !a.saved } });

  if (mode === 'saved' && !isSignedIn) {
    return (<><PageHead title="Saved" /><Empty title="Retained articles are private" /></>);
  }

  return (
    <div className="tw-rise">
      <PageHead title={mode === 'saved' ? 'Saved' : 'Feed'} count={rows.length}>
        {isSignedIn ? (
          <button onClick={() => setCreating(true)} data-testid="button-intake" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
            <Plus className="h-3.5 w-3.5" /> Intake
          </button>
        ) : null}
      </PageHead>

      <div className="tw-glass sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 backdrop-blur md:px-8">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search headline, text, journalist, entity" className="h-8 bg-card pl-8 text-sm" data-testid="input-search" />
        </div>
        <Filter label="Impact" value={impact} onChange={setImpact} options={IMPACTS} />
        <Filter label="Topic" value={topic} onChange={setTopic} options={topics} />
        <Filter label="Outlet" value={outlet} onChange={setOutlet} options={outlets} />
        <Filter label="Reporting" value={rt} onChange={setRt} options={[...REPORTING]} />
        <Filter label="Sentiment" value={sent} onChange={setSent} options={[...SENTIMENT]} />
        <Filter label="Focus" value={focus} onChange={setFocus} options={[...FOCUS]} />
        {filtered && <button onClick={clear} data-testid="button-clear-filters" className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      <div className={cn(selected && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,46%)]')}>
      <div className="min-w-0">
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : rows.length === 0 ? (
        filtered ? <Empty title="No matches"><button onClick={clear} className="text-xs text-accent underline" data-testid="button-empty-clear">Clear filters</button></Empty>
          : mode === 'saved' ? <Empty title="Nothing retained yet" />
          : <Empty title="No articles yet">
              <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-empty-refresh" className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-60">
                {refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
              </button>
            </Empty>
      ) : (
        <ol className="space-y-2.5 px-3 py-3 md:px-5 md:py-4">
          {rows.map((a) => {
            const active = open === a.id;
            const imp = impacts.get(a.id) ?? impactRating(a, watches);
            return (
              <li key={a.id} onClick={() => setOpen(a.id)} className={cn('tw-feed-item group relative cursor-pointer rounded-xl px-3 py-3.5 transition-colors md:px-5', active && 'tw-feed-item-active')} data-testid={`row-article-${a.id}`}>
                <div className="flex items-start gap-3 sm:gap-4">
                  <OutletBrand name={a.sourceType === 'x' ? 'X' : (a.outlet ?? '—')} variant="square" className="mt-0.5 h-14 w-14 rounded-xl shadow-sm sm:h-16 sm:w-16" />
                  <div className="min-w-0 flex-1">
                    <FeedMeta article={a} impact={imp} />
                    <button onClick={(e) => { e.stopPropagation(); setOpen(a.id); }} aria-expanded={active} aria-controls="article-reader" className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2" data-testid={`button-expand-${a.id}`}>
                      <span className="font-serif text-[17px] leading-snug">{a.title}</span>
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5" onClick={event => event.stopPropagation()}>
                    {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" data-testid={`link-source-${a.id}`}><ExternalLink className="h-4 w-4" /></a>}
                    {isSignedIn && (
                      <>
                        <button onClick={() => toggleSave(a)} className={cn('flex h-8 w-8 items-center justify-center rounded-md', a.saved ? 'text-accent' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-save-${a.id}`}>
                          <Bookmark className={cn('h-4 w-4', a.saved && 'fill-current')} />
                        </button>
                        <button onClick={() => setEditing(a)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:text-foreground md:opacity-0 md:group-hover:opacity-100" data-testid={`button-edit-${a.id}`}><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setDeleting(a)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:text-destructive md:opacity-0 md:group-hover:opacity-100" data-testid={`button-delete-${a.id}`}><Trash2 className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </div>
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/30 lg:hidden" onClick={() => setOpen(null)} aria-hidden />
          <aside id="article-reader" role={narrow ? 'dialog' : 'region'} aria-modal={narrow || undefined} aria-label={selected.title}
            className="tw-rise fixed inset-0 z-50 bg-card lg:static lg:z-auto lg:border-l lg:border-border lg:bg-card/85 lg:backdrop-blur-sm"
          >
            <div className="h-full lg:sticky lg:top-0 lg:h-[100dvh]">
              <ArticleReader article={selected} impact={impacts.get(selected.id) ?? impactRating(selected, watches)} onClose={() => setOpen(null)} />
            </div>
          </aside>
        </>
      )}
      </div>

      <ArticleEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
