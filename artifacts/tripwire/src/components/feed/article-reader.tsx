import { useEffect, useRef, useState } from 'react';
import { QuickCorrection } from './quick-correction';
import { getGetArticleContentQueryKey, useGetArticleContent, type TrackedRecord } from '@workspace/api-client-react';
import { ChevronLeft, ChevronDown, ChevronRight, Download, ExternalLink, Flag, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACTIVE_RETRIEVAL, fmtDate, isFlagged, useEnrich } from '@/lib/workspace';
import { Importer } from '@/components/importer';
import { contentStatus, hasMainText, publicationET, type Impact } from '@/lib/article-signals';
import { articleCredits } from '@/lib/media-coverage';
import { OutletBrand } from '@/components/outlet-brand';
import { ProvenancePanel } from '@/components/provenance/provenance-panel';
import { ProcessArticleButton } from '@/components/provenance/claim-processing';
import { DevelopmentsPanel } from './developments';
import { ArticleClaims } from './article-claims';
import { ContentDot, ImpactWord, articleTags } from './feed-meta';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const n = (v?: number) => (v ?? 0).toLocaleString('en-US');
const label = (v?: string) => (v ? v.replace(/-/g, ' ') : 'unclassified');

function ContentBody({ articleId, captureId, revision, complete, showComplete, onRawToggle, rawOpen, feedbackId }: {
  feedbackId?: string; articleId: string; captureId: string | null; revision: string; complete?: boolean; showComplete: boolean; rawOpen: boolean; onRawToggle: () => void;
}) {
  const params = captureId || feedbackId ? { ...(captureId ? { capture: captureId } : {}), ...(feedbackId ? { feedback: feedbackId } : {}) } : undefined;
  const q = useGetArticleContent(articleId, params, { query: { queryKey: [...getGetArticleContentQueryKey(articleId, params), { revision }], staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: 1 } });
  if (q.isLoading) return (
    <div className="space-y-2 py-1" aria-busy data-testid="content-loading">
      {[92, 100, 84, 97, 60].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}
    </div>
  );
  if (q.isError || !q.data) return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs" data-testid="content-error">
      <span className="text-muted-foreground">Text could not be loaded.</span>
      <button type="button" onClick={() => q.refetch()} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid="button-content-retry"><RefreshCw className="h-3 w-3" /> Retry</button>
    </div>
  );
  const { text, raw, characters, rawCharacters } = q.data;
  return (
    <>
      {text ? <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed" data-testid={`text-fulltext-${articleId}`}>{text}</div>
        : <p className="text-xs text-muted-foreground">No extracted text in this capture.</p>}
      <div className="mt-3 border-t border-border pt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {n(characters)} chars{rawCharacters ? ` · raw ${n(rawCharacters)}` : ''}{showComplete && !complete ? ' · text incomplete' : ''}
      </div>
      {raw && (
        <div className="mt-2 text-xs">
          <button type="button" onClick={onRawToggle} aria-expanded={rawOpen} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" data-testid="button-toggle-raw">
            {rawOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Raw source (shown as text)
          </button>
          {rawOpen && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">{raw}</pre>}
        </div>
      )}
    </>
  );
}

export function ArticleReader({ article: a, impact, onClose, signedIn, onToggleFlag, flagPending, onOpenArticle, feedbackId }: {
  article: TrackedRecord; impact: { value: Impact; reason: string }; onClose: () => void;
  /** Retained (dismissed/historical) view: read-only, content served via feedback event. */
  feedbackId?: string;
  signedIn: boolean; onToggleFlag: () => void; flagPending: boolean;
  onOpenArticle?: (id: string) => void;
}) {
  const captures = a.retainedContent ?? [];
  const hasMain = hasMainText(a);
  const defaultCapture = hasMain ? 'main' : (captures[0]?.id ?? 'main');
  const enrich = useEnrich();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const r = a.retrieval;
  const evidence = [...(a.classificationEvidence ?? [])].sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99));
  const [captureId, setCaptureId] = useState<string>(defaultCapture);
  useEffect(() => { setCaptureId(defaultCapture); }, [a.id, defaultCapture]);
  const capture = captures.find(c => c.id === captureId);
  const flagged = isFlagged(a);
  const [importOpen, setImportOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  useEffect(() => { setImportOpen(false); setRawOpen(false); setEvidenceOpen(false); }, [a.id]);
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
  const attributions = [...new Map(credits.filter(c => c.attribution && c.attribution.trim() !== a.byline?.trim()).map(c => [c.attribution, c])).values()];
  const contributors = credits.filter(c => c.role === 'contributor');
  const bylineCredits = credits.filter(c => c.role !== 'contributor');

  return (
    <article aria-labelledby={`reader-title-${a.id}`} className="flex h-full flex-col" data-testid={`reader-${a.id}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-2.5">
        <button onClick={onClose} className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground lg:hidden" data-testid="button-reader-back">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="hidden items-center gap-2 lg:flex">
          <ImpactWord value={impact.value} reason={impact.reason} id={`reader-${a.id}`} />
          <ContentDot article={a} />
        </div>
        <div className="flex items-center gap-1">
        {signedIn && !feedbackId && (
          <button onClick={onToggleFlag} disabled={flagPending} aria-pressed={flagged} aria-label={flagged ? 'Unflag article' : 'Flag article'} title={flagged ? 'Unflag' : 'Flag'}
            className={cn('flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted', flagged ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid="button-reader-flag">
            <Flag className={cn('h-4 w-4', flagged && 'fill-current')} />
          </button>
        )}
        <button ref={closeRef} onClick={onClose} aria-label="Close reader" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-reader-close">
          <ChevronRight className="h-4 w-4" />
        </button>
        </div>
      </div>

      <div className="tw-headline-container flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="mb-3 flex items-center gap-3">
          <OutletBrand name={a.sourceType === 'x' ? 'X' : outlet} variant="square" />
          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-wide" data-testid="text-reader-outlet">{outlet}</div>
            <time dateTime={a.publishedAt ?? undefined} className="font-mono text-[11px] text-muted-foreground" data-testid="text-reader-published">{pub.label}</time>
          </div>
        </div>
        <h2 id={`reader-title-${a.id}`} className="tw-reader-headline font-serif font-semibold" data-testid="text-reader-title">{a.title}</h2>

        {feedbackId && <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="text-reader-retained">Retained record · read-only</p>}
        {!feedbackId && <div className="mt-4">
          <button type="button" onClick={() => setImportOpen(v => !v)} aria-expanded={importOpen} aria-controls={`article-importer-${a.id}`}
            className="mb-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground" data-testid="button-toggle-importer">
            {importOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Add / update content
          </button>
          {a.kind === 'article' && hasMain && signedIn && <ProcessArticleButton key={`proc-${a.id}`} articleId={a.id} />}
          {importOpen && <div id={`article-importer-${a.id}`}><Importer key={a.id} targetId={a.id} targetTitle={a.title} compact onCommitted={record => { if (record.id !== a.id) onOpenArticle?.(record.id); }} /></div>}
        </div>}

        {a.kind === 'article' && !feedbackId && <ArticleClaims key={`claims-${a.id}`} articleId={a.id} />}

        <dl className="mt-5 grid gap-4 rounded-md border border-border/70 bg-background/70 p-4">
          <Field label="Byline">
            {bylineCredits.length ? (
              <ul className="space-y-0.5" data-testid="list-reader-credits">
                {bylineCredits.map((c, i) => (
                  <li key={`${c.name}-${c.role}-${i}`}>{c.name} <span className="font-mono text-[11px] text-muted-foreground">{c.role}</span></li>
                ))}
              </ul>
            ) : <span className="text-muted-foreground">Not recorded</span>}
          </Field>
          {contributors.length > 0 && (
            <Field label="Contributing reporters">
              <ul className="space-y-0.5" data-testid="list-reader-contributors">{contributors.map((c, i) => <li key={i}>{c.name}</li>)}</ul>
            </Field>
          )}
          {(a.byline || attributions.length > 0) && (
            <Field label="Credit wording">
              {a.byline && <p className="italic" data-testid="text-reader-byline">{a.byline}</p>}
              {attributions.map((c, i) => <p key={i} className="italic text-muted-foreground">{c.attribution}</p>)}
            </Field>
          )}
          <Field label="Impact">
            <ImpactWord value={impact.value} reason={impact.reason} id={`reader-field-${a.id}`} />
            <span className="ml-2 text-muted-foreground" data-testid="text-reader-impact-reason">{impact.reason}</span>
            {!feedbackId && a.kind === 'article' && <QuickCorrection article={a} />}
          </Field>
          {a.topic && <Field label="Topic"><span className="text-xs" data-testid="text-reader-topic">{a.topic}{a.topicMode === 'manual' ? <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">manual</span> : null}</span></Field>}
          {tags.length > 0 && <Field label="Tags"><span className="font-mono text-xs">{tags.join(' · ')}</span></Field>}
          {(a.entities ?? []).length > 0 && (
            <Field label="Entities">
              <div className="flex flex-wrap gap-1">{a.entities!.map((e) => <span key={e} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px]">{e}</span>)}</div>
            </Field>
          )}
          {a.publishedAt && a.publicationSource && (
            <Field label="Publication time source">
              <span className="text-xs" data-testid="text-publication-source">{a.publicationSource === 'google-news' ? 'Google News feed timestamp' : a.publicationSource === 'publisher' ? 'Publisher metadata' : 'Imported / edited date'}</span>
              {a.publicationSourceUrl && <a href={a.publicationSourceUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted-foreground underline underline-offset-2">Source</a>}
            </Field>
          )}
          <Field label="Type">
            <span className="font-mono text-xs uppercase tracking-wider" data-testid="text-reader-type">{label(a.contentType)} · {label(a.contentFormat ?? 'text')}</span>
            {evidence.length > 0 && (
              <div className="mt-1">
                <button type="button" onClick={() => setEvidenceOpen(v => !v)} aria-expanded={evidenceOpen} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-toggle-evidence">
                  {evidenceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Evidence ({evidence.length})
                </button>
                {evidenceOpen && (
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground" data-testid="list-reader-evidence">
                    {evidence.map((e, i) => (
                      <li key={i} className="break-words"><span className="text-foreground">{e.signal}</span> {e.value}{(e.contentType || e.contentFormat) && <> {'->'} {[e.contentType, e.contentFormat].filter(Boolean).join(' / ')}</>}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          {a.intakeMethod && (
            <Field label="Intake">
              <span className="text-xs">{a.intakeMethod === 'google-news' ? 'Google News discovery' : a.intakeMethod === 'sitemap' ? 'Publisher news sitemap' : 'Publisher RSS / Atom'}</span>
              {a.discoveryOnly && <p className="mt-1 text-xs text-muted-foreground">{hasMain ? 'Publisher link not yet verified. Imported content is retained below.' : 'Headline discovery only; article text and byline not retrieved.'}</p>}
              {a.intakeUrl && <a href={a.intakeUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-[10px] text-muted-foreground underline underline-offset-2">{a.intakeUrl}</a>}
            </Field>
          )}
          <Field label="Retrieval">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]" data-testid="text-reader-retrieval">
              <span className="uppercase tracking-wider">{r?.status ?? 'not attempted'}</span>
              {r?.method && <span className="text-muted-foreground">{r.method}</span>}
              {r?.characters != null && <span className="text-muted-foreground">{n(r.characters)} chars</span>}
              {r?.rawCharacters != null && <span className="text-muted-foreground">raw {n(r.rawCharacters)}</span>}
              {r?.attempts != null && <span className="text-muted-foreground">{r.attempts} att.</span>}
              {r?.lastAttempt && <span className="text-muted-foreground">{fmtDate(r.lastAttempt, true)}</span>}
              {r?.nextAttemptAt && <span className="text-muted-foreground">next {fmtDate(r.nextAttemptAt, true)}</span>}
              {a.url && !a.discoveryOnly && !feedbackId && (
                <button type="button" onClick={() => enrich.mutate({ data: { articleId: a.id } })} disabled={enrich.isPending || ACTIVE_RETRIEVAL.has(r?.status ?? '')}
                  className="inline-flex h-6 items-center gap-1 rounded border border-border px-2 font-sans text-[11px] hover:border-foreground disabled:opacity-50" data-testid="button-reader-fetch">
                  <RefreshCw className={cn('h-3 w-3', enrich.isPending && 'animate-spin')} /> Fetch source
                </button>
              )}
            </div>
            {r?.message && <p className="mt-1 text-xs text-muted-foreground">{r.message}</p>}
          </Field>
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

        <DevelopmentsPanel key={a.id} articleId={a.id} compact />
        {a.kind === 'article' && <ProvenancePanel key={`prov-${a.id}`} params={{ articleId: a.id }} editable={signedIn && !feedbackId} connect={{ articleId: a.id }} heading="Passages and source lineage" />}

        {captures.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="select-reader-capture">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Source</span>
            <select value={captureId} onChange={e => { setCaptureId(e.target.value); setRawOpen(false); }} aria-label="Content capture" className="h-7 max-w-full rounded-md border border-input bg-background px-2 text-xs">
              {hasMain && <option value="main">Article text</option>}
              {captures.map(c => <option key={c.id} value={c.id}>{c.fileName ?? c.source} · {fmtDate(c.capturedAt, true)}</option>)}
            </select>
          </div>
        )}

        {capture && (
          <section className="mt-3" data-testid={`capture-${capture.id}`}>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Retained capture · {capture.source}</h3>
            <ContentBody key={`${a.id}:${capture.id}`} articleId={a.id} captureId={capture.id} revision={capture.bodyHash ?? a.updatedAt ?? ''} feedbackId={feedbackId} showComplete={false} rawOpen={rawOpen} onRawToggle={() => setRawOpen(v => !v)} />
            {(capture.sourceUrl || (capture.uploadId && signedIn)) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2 text-xs">
                {capture.sourceUrl && <a href={capture.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4"><ExternalLink className="h-3 w-3" /> Capture source</a>}
                {capture.uploadId && signedIn && <a href={`${import.meta.env.BASE_URL}api/tripwire/imports/uploads/${capture.uploadId}/file`.replace(/\/\/api/, '/api')} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid={`link-capture-download-${capture.id}`}><Download className="h-3 w-3" /> Original file</a>}
              </div>
            )}
          </section>
        )}

        {!capture && hasMain && (
          <section className="mt-6">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {a.fullTextComplete ? 'Full text' : 'Partial text'}
            </h3>
            <ContentBody key={`${a.id}:main`} articleId={a.id} captureId={null} revision={a.fullTextHash ?? a.updatedAt ?? ''} complete={a.fullTextComplete} feedbackId={feedbackId} showComplete rawOpen={rawOpen} onRawToggle={() => setRawOpen(v => !v)} />
          </section>
        )}

        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground" data-testid="link-reader-source">
            <ExternalLink className="h-3.5 w-3.5" /> {a.discoveryOnly ? 'Open discovery link' : 'Open source'}
          </a>
        )}
      </div>
    </article>
  );
}
