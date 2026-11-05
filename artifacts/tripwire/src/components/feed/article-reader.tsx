import { useEffect, useRef, useState } from 'react';
import type { TrackedRecord } from '@workspace/api-client-react';
import { ChevronLeft, ChevronDown, ChevronRight, Download, ExternalLink, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate, isFlagged } from '@/lib/workspace';
import { Importer } from '@/components/importer';
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

export function ArticleReader({ article: a, impact, onClose, signedIn, onToggleFlag, flagPending }: {
  article: TrackedRecord; impact: { value: Impact; reason: string }; onClose: () => void;
  signedIn: boolean; onToggleFlag: () => void; flagPending: boolean;
}) {
  const captures = a.retainedContent ?? [];
  const defaultCapture = a.fullText ? 'main' : (captures[0]?.id ?? 'main');
  const [captureId, setCaptureId] = useState<string>(defaultCapture);
  useEffect(() => { setCaptureId(defaultCapture); }, [a.id, defaultCapture]);
  const capture = captures.find(c => c.id === captureId);
  const flagged = isFlagged(a);
  const [importOpen, setImportOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  useEffect(() => { setImportOpen(false); setRawOpen(false); }, [a.id]);
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
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="hidden items-center gap-2 lg:flex">
          <ImpactWord value={impact.value} reason={impact.reason} id={`reader-${a.id}`} />
          <ContentDot article={a} />
        </div>
        <div className="flex items-center gap-1">
        {signedIn && (
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

        <div className="mt-4">
          <button type="button" onClick={() => setImportOpen(v => !v)} aria-expanded={importOpen} aria-controls={`article-importer-${a.id}`}
            className="mb-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs hover:border-foreground" data-testid="button-toggle-importer">
            {importOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Add / update content
          </button>
          {importOpen && <div id={`article-importer-${a.id}`}><Importer key={a.id} targetId={a.id} targetTitle={a.title} compact /></div>}
        </div>

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

        {captures.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="select-reader-capture">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Source</span>
            <select value={captureId} onChange={e => setCaptureId(e.target.value)} aria-label="Content capture" className="h-7 max-w-full rounded-md border border-input bg-background px-2 text-xs">
              {a.fullText && <option value="main">Article text</option>}
              {captures.map(c => <option key={c.id} value={c.id}>{c.fileName ?? c.source} · {fmtDate(c.capturedAt, true)}</option>)}
            </select>
          </div>
        )}

        {capture && (
          <section className="mt-3" data-testid={`capture-${capture.id}`}>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Retained capture · {capture.source}</h3>
            <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{capture.text}</div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2 text-xs">
              {capture.sourceUrl && <a href={capture.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4"><ExternalLink className="h-3 w-3" /> Capture source</a>}
              {capture.uploadId && signedIn && <a href={`${import.meta.env.BASE_URL}api/tripwire/imports/uploads/${capture.uploadId}/file`.replace(/\/\/api/, '/api')} className="inline-flex items-center gap-1 underline underline-offset-4" data-testid={`link-capture-download-${capture.id}`}><Download className="h-3 w-3" /> Original file</a>}
              {capture.raw && (
                <div className="w-full">
                  <button type="button" onClick={() => setRawOpen(v => !v)} aria-expanded={rawOpen} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" data-testid="button-toggle-raw">
                    {rawOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Raw source (shown as text)
                  </button>
                  {rawOpen && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">{capture.raw}</pre>}
                </div>
              )}
            </div>
          </section>
        )}

        {!capture && a.fullText && (
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
