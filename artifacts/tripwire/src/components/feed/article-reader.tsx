import { useEffect, useRef } from 'react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { contentStatus, publicationET, type Impact } from '@/lib/article-signals';
import { articleCredits } from '@/lib/media-coverage';
import { OutletBrand } from '@/components/outlet-brand';
import { ContentDot, ImpactWord, articleTags } from './feed-meta';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ArticleReader({ article: a, impact, onClose }: {
  article: TrackedRecord; impact: { value: Impact; reason: string }; onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [a.id]);
  const pub = publicationET(a.publishedAt ?? undefined);
  const credits = articleCredits(a);
  const status = contentStatus(a);
  const tags = articleTags(a);
  const outlet = a.sourceType === 'x' ? (a.outlet ?? 'X') : (a.outlet ?? '—');
  const attributions = credits.filter((c) => c.attribution);

  return (
    <article aria-labelledby={`reader-title-${a.id}`} className="flex h-full flex-col" data-testid={`reader-${a.id}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-2.5">
        <button onClick={onClose} className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground lg:hidden" data-testid="button-reader-back">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="hidden items-center gap-2 lg:flex">
          <ImpactWord value={impact.value} reason={impact.reason} id={`reader-${a.id}`} />
          <ContentDot article={a} />
        </div>
        <button ref={closeRef} onClick={onClose} aria-label="Close reader" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-reader-close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="mb-3 flex items-center gap-3">
          <OutletBrand name={a.sourceType === 'x' ? 'X' : outlet} variant="square" />
          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-wide" data-testid="text-reader-outlet">{outlet}</div>
            <time dateTime={a.publishedAt ?? undefined} className="font-mono text-[11px] text-muted-foreground" data-testid="text-reader-published">{pub.label}</time>
          </div>
        </div>
        <h2 id={`reader-title-${a.id}`} className="font-serif text-xl font-semibold leading-snug" data-testid="text-reader-title">{a.title}</h2>

        <dl className="mt-5 grid gap-4 rounded-md border border-border/70 bg-background/70 p-4">
          <Field label="Byline">
            {credits.length ? (
              <ul className="space-y-0.5" data-testid="list-reader-credits">
                {credits.map((c, i) => (
                  <li key={`${c.name}-${c.role}-${i}`}>{c.name} <span className="font-mono text-[11px] text-muted-foreground">{c.role}</span></li>
                ))}
              </ul>
            ) : <span className="text-muted-foreground">Not recorded</span>}
          </Field>
          {(a.byline || attributions.length > 0) && (
            <Field label="Credit wording">
              {a.byline && <p className="italic" data-testid="text-reader-byline">{a.byline}</p>}
              {attributions.map((c, i) => <p key={i} className="italic text-muted-foreground">{c.attribution}</p>)}
            </Field>
          )}
          <Field label="Impact">
            <ImpactWord value={impact.value} reason={impact.reason} id={`reader-field-${a.id}`} />
            <span className="ml-2 text-muted-foreground" data-testid="text-reader-impact-reason">{impact.reason}</span>
          </Field>
          {tags.length > 0 && <Field label="Tags"><span className="font-mono text-xs">{tags.join(' · ')}</span></Field>}
          {(a.entities ?? []).length > 0 && (
            <Field label="Entities">
              <div className="flex flex-wrap gap-1">{a.entities!.map((e) => <span key={e} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px]">{e}</span>)}</div>
            </Field>
          )}
          <Field label="Content">
            <span className="inline-flex items-center gap-2"><ContentDot article={a} /> {status.label}</span>
          </Field>
        </dl>

        {a.summary && (
          <section className="mt-6">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Summary</h3>
            <p className="text-sm leading-relaxed" data-testid="text-reader-summary">{a.summary}</p>
          </section>
        )}

        {a.fullText && (
          <section className="mt-6">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {a.fullTextComplete ? 'Full text' : 'Partial text'}
            </h3>
            <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed" data-testid={`text-fulltext-${a.id}`}>{a.fullText}</div>
            {!a.fullTextComplete && <p className="mt-3 border-t border-border pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Text incomplete</p>}
          </section>
        )}

        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground" data-testid="link-reader-source">
            <ExternalLink className="h-3.5 w-3.5" /> Open source
          </a>
        )}
      </div>
    </article>
  );
}
