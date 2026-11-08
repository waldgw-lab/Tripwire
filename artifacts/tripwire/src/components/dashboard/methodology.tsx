import { useGetClaimCategories } from '@workspace/api-client-react';
import { methodologySections, type MethodologySection } from '@/lib/methodology';

function ClaimCategories() {
  const { data, isLoading, isError, refetch } = useGetClaimCategories({ query: { staleTime: 300_000 } });
  return (
    <div className="mt-5 rounded-lg border border-border bg-card/70 p-4" data-testid="section-methodology-categories">
      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Development categories and review fallback</h4>
      {isLoading ? (
        <div className="mt-3 space-y-2" aria-label="Loading categories">{[0, 1, 2].map(i => <div key={i} className="h-4 animate-pulse rounded bg-muted" />)}</div>
      ) : isError || !data ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Categories could not be loaded.</span>
          <button onClick={() => refetch()} className="rounded-md border border-border bg-card px-2.5 py-1 hover:border-foreground" data-testid="button-retry-categories">Retry</button>
        </div>
      ) : data.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No categories are defined.</p>
      ) : (
        <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {data.map((c, i) => (
            <li key={c.id} className="flex gap-3" data-testid={`text-category-${c.id}`}>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground pt-0.5">{String(i + 1).padStart(2, '0')}</span>
              <div><p className="text-sm font-medium">{c.label}</p>{c.description && <p className="text-xs leading-relaxed text-muted-foreground">{c.description}</p>}</div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">Uncategorized / Needs Review keeps uncertain material visible without forcing a match. Catalog order breaks primary-placement ties.</p>
    </div>
  );
}

function Section({ s, index }: { s: MethodologySection; index: number }) {
  const hid = `methodology-${s.id}-heading`;
  return (
    <section id={`methodology-${s.id}`} aria-labelledby={hid} className="scroll-mt-24 border-t border-border pt-8 first:border-t-0 first:pt-0" data-testid={`section-methodology-${s.id}`}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{String(index).padStart(2, '0')}</p>
      <h3 id={hid} className="font-display text-3xl font-semibold leading-tight tracking-tight">{s.title}</h3>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed">{s.introduction}</p>
      <dl className="mt-5 space-y-4">
        {s.concepts.map(c => (
          <div key={c.title} className="grid gap-1 border-l-2 border-border pl-4 md:grid-cols-[220px_1fr] md:gap-6 md:border-l-0 md:pl-0">
            <dt className="text-sm font-semibold leading-snug">{c.title}</dt>
            <dd className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{c.text}</dd>
          </div>
        ))}
      </dl>
      {s.id === 'claims' && <ClaimCategories />}
    </section>
  );
}

export function Methodology() {
  const jump = (id: string) => document.getElementById(`methodology-${id}`)?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
  return (
    <article aria-labelledby="methodology-title" data-testid="panel-methodology">
      <header className="mb-6">
        <h2 id="methodology-title" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Methodology</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">How Tripwire organizes reporting. This describes product methodology, not live operating status; it is read-only and changes nothing.</p>
        <nav aria-label="Methodology sections" className="mt-4 flex flex-wrap gap-1.5">
          {methodologySections.map(s => (
            <a key={s.id} href={`#methodology-${s.id}`} onClick={e => { e.preventDefault(); jump(s.id); }}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`link-methodology-${s.id}`}>{s.title}</a>
          ))}
        </nav>
      </header>
      <div className="tw-glass space-y-10 rounded-xl border border-border p-5 md:p-8">
        {methodologySections.map((s, i) => <Section key={s.id} s={s} index={i} />)}
      </div>
    </article>
  );
}
