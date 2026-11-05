import { useMemo, useState } from 'react';
import { OutletBrand } from '@/components/outlet-brand';
import { ExternalLink, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, PageHead, ReportingChip, RowsSkeleton, SentimentMark } from '@/components/bits';
import { byKind, fmtDate, useWorkspace } from '@/lib/workspace';
import type { Observation, TrackedRecord } from '@workspace/api-client-react';

type Dossier = {
  name: string;
  articles: TrackedRecord[];
  observations: { claim: TrackedRecord; obs: Observation }[];
  outlets: Map<string, number>;
  types: Map<string, number>;
};

export default function JournalistsPage() {
  const { data, isLoading, isError, refetch } = useWorkspace();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const dossiers = useMemo(() => {
    const map = new Map<string, Dossier>();
    const get = (raw: string) => {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, articles: [], observations: [], outlets: new Map(), types: new Map() });
      return map.get(key)!;
    };
    for (const a of byKind(data?.records, 'article')) {
      for (const j of a.journalists ?? []) {
        if (!j.trim()) continue;
        const d = get(j);
        d.articles.push(a);
        if (a.outlet) d.outlets.set(a.outlet, (d.outlets.get(a.outlet) ?? 0) + 1);
        const t = a.reportingType ?? 'unassessed';
        d.types.set(t, (d.types.get(t) ?? 0) + 1);
      }
    }
    for (const c of byKind(data?.records, 'claim')) {
      for (const o of c.observations ?? []) if (o.journalist.trim()) get(o.journalist).observations.push({ claim: c, obs: o });
    }
    return [...map.values()].sort((a, b) => b.articles.length + b.observations.length - (a.articles.length + a.observations.length));
  }, [data]);

  const list = dossiers.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  const cur = dossiers.find((d) => d.name === sel) ?? list[0];

  return (
    <div className="tw-rise flex min-h-[100dvh] flex-col">
      <PageHead title="Journalists" count={dossiers.length}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="h-8 w-48 bg-card pl-8 text-sm" data-testid="input-journalist-search" />
        </div>
      </PageHead>
      {isLoading ? <RowsSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} /> : dossiers.length === 0 ? <Empty title="No bylines recorded yet" /> : (
        <div className="grid flex-1 md:grid-cols-[260px_1fr]">
          <ul className="max-h-[40dvh] overflow-y-auto border-b border-border md:max-h-none md:border-b-0 md:border-r">
            {list.map((d) => (
              <li key={d.name}>
                <button onClick={() => setSel(d.name)} data-testid={`button-journalist-${d.name}`}
                  className={cn('flex w-full items-center justify-between border-l-2 px-5 py-2.5 text-left text-sm', cur?.name === d.name ? 'border-accent bg-card' : 'border-transparent hover:bg-card/60')}>
                  <span className="truncate">{d.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{d.articles.length}·{d.observations.length}</span>
                </button>
              </li>
            ))}
          </ul>
          {cur && (
            <section className="px-5 py-6 md:px-10" data-testid="detail-journalist">
              <h2 className="font-serif text-3xl">{cur.name}</h2>
              <div className="mt-4 grid gap-6 sm:grid-cols-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Outlets</p>
                  {[...cur.outlets].sort((a, b) => b[1] - a[1]).map(([o, n]) => <p key={o} className="text-sm">{o} <span className="font-mono text-xs text-muted-foreground">{n}</span></p>)}
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Classification</p>
                  <div className="flex flex-wrap gap-2">
                    {[...cur.types].map(([t, n]) => <span key={t} className="inline-flex items-center gap-1"><ReportingChip value={t} /><span className="font-mono text-xs">{n}</span></span>)}
                  </div>
                </div>
              </div>

              {cur.observations.length > 0 && (
                <div className="mt-8">
                  <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-accent">Claim observations</h3>
                  <ul className="divide-y divide-border border-y border-border">
                    {cur.observations.map(({ claim, obs }) => (
                      <li key={obs.id} className="py-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="font-mono uppercase">{obs.stage}</span>
                          <time className="font-mono text-muted-foreground">{fmtDate(obs.observedAt, true)}</time>
                          <span className={obs.verified ? 'text-[hsl(152_30%_32%)]' : 'text-muted-foreground'}>{obs.verified ? 'verified' : 'unverified'}</span>
                        </div>
                        <p className="mt-0.5 font-serif text-[15px]">{claim.title}</p>
                        {obs.attribution && <p className="text-sm italic text-muted-foreground">“{obs.attribution}”</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-8">
                <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-accent">Bylines</h3>
                <ul className="divide-y divide-border border-y border-border">
                  {[...cur.articles].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 py-2.5">
                      <time className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{fmtDate(a.publishedAt ?? a.createdAt)}</time>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">{a.sourceType === 'x' ? <span>X · {a.outlet}</span> : <OutletBrand name={a.outlet ?? '—'} />}<ReportingChip value={a.reportingType} /><SentimentMark value={a.sentiment} focus={a.focus} /></div>
                        <p className="font-serif text-[15px] leading-snug">{a.title}</p>
                      </div>
                      {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
