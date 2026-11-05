import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { Bookmark, ChevronDown, ExternalLink, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorState, PageHead, ReportingChip, RowsSkeleton, SentimentMark } from '@/components/bits';
import { contentStatus, impactRating, publicationET } from '@/lib/article-signals';
import { ArticleEditor, ConfirmDelete } from '@/components/editors';
import { OutletBrand } from '@/components/outlet-brand';
import { FOCUS, REPORTING, SENTIMENT, byKind, toInput, useRefresh, useSave, useWorkspace } from '@/lib/workspace';

const ALL = '__all';
const IMPACTS = ['critical', 'high', 'low'];
const impactTone: Record<string, string> = {
  critical: 'bg-red-700 text-white border-red-700',
  high: 'border-foreground text-foreground',
  low: 'border-border text-muted-foreground',
};

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
  const [open, setOpen] = useState<string | null>(null);
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
      return [a.title, a.summary, a.fullText, a.outlet, a.topic, ...(a.journalists ?? []), ...(a.entities ?? [])]
        .some((s) => s?.toLowerCase().includes(needle));
    });
  }, [articles, impacts, q, topic, outlet, rt, sent, focus, impact, mode]);

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

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur md:px-8">
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

      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : rows.length === 0 ? (
        filtered ? <Empty title="No matches"><button onClick={clear} className="text-xs text-accent underline" data-testid="button-empty-clear">Clear filters</button></Empty>
          : mode === 'saved' ? <Empty title="Nothing retained yet" />
          : <Empty title="No articles yet">
              <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-empty-refresh" className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-60">
                {refresh.isPending ? 'Checking feeds' : 'Refresh feeds'}
              </button>
            </Empty>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((a) => {
            const expanded = open === a.id;
            const pub = publicationET(a.publishedAt ?? undefined);
            const imp = impacts.get(a.id) ?? impactRating(a, watches);
            const status = contentStatus(a);
            return (
              <li key={a.id} className={cn('group px-5 py-3.5 transition-colors md:px-8', expanded ? 'bg-card' : 'hover:bg-card/60')} data-testid={`row-article-${a.id}`}>
                <div className="flex items-start gap-3 sm:gap-4">
                  <OutletBrand name={a.sourceType === 'x' ? 'X' : (a.outlet ?? '—')} variant="square" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <time dateTime={a.publishedAt ?? undefined} title={pub.label} className="font-mono text-[11px] text-muted-foreground" data-testid={`text-published-${a.id}`}>{pub.date}</time>
                      <span className="font-mono text-[11px] text-muted-foreground">{pub.time}</span>
                      <span className="font-semibold" data-testid={`text-outlet-${a.id}`}>{a.sourceType === 'x' ? (a.outlet ?? 'X') : (a.outlet ?? '—')}</span>
                      {(a.journalists ?? []).length > 0 && <span className="text-muted-foreground">{a.journalists!.join(', ')}</span>}
                      <span title={imp.reason} className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-medium uppercase tracking-wider', impactTone[imp.value])} data-testid={`status-impact-${a.id}`}>{imp.value}</span>
                      <span role="img" aria-label={status.label} title={status.label} className={cn('inline-block h-2 w-2 shrink-0 rounded-full', status.color)} data-testid={`status-content-${a.id}`} />
                      {a.reportingType && a.reportingType !== 'unassessed' && <ReportingChip value={a.reportingType} />}
                      <SentimentMark value={a.sentiment} focus={a.focus} />
                      {a.topic && <span className="font-mono text-[10px] text-muted-foreground">#{a.topic}</span>}
                    </div>
                    <button onClick={() => setOpen(expanded ? null : a.id)} className="flex w-full items-start gap-2 text-left" data-testid={`button-expand-${a.id}`}>
                      <span className="font-serif text-[17px] leading-snug">{a.title}</span>
                      <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                    </button>
                    {expanded && (
                      <div className="tw-rise mt-3 space-y-3 border-l-2 border-accent pl-4">
                        {a.summary && <p className="text-sm text-muted-foreground">{a.summary}</p>}
                        {(a.entities ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1">{a.entities!.map((e) => <span key={e} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px]">{e}</span>)}</div>
                        )}
                        {a.fullText ? (
                          <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap font-serif text-[15px] leading-relaxed" data-testid={`text-fulltext-${a.id}`}>{a.fullText}</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
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

      <ArticleEditor open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} record={editing} />
      <ConfirmDelete target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
