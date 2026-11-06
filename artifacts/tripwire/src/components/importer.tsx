import { useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  useAnalyzeImport, useCommitImport, useRequestImportUpload,
  type ImportDraft, type TrackedRecord,
} from '@workspace/api-client-react';
import { FileUp, Link2, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { errText, fromLocalInput, toLocalInput, useInvalidateWorkspace } from '@/lib/workspace';

const MAX = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

type Meta = { title: string; outlet: string; url: string; byline: string; contributors: string; publishedAt: string; sourceType: 'article' | 'x'; fullTextComplete: boolean };

export function Importer({ targetId, targetTitle, onCommitted, compact }: {
  targetId?: string; targetTitle?: string; onCommitted?: (r: TrackedRecord) => void; compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [done, setDone] = useState<TrackedRecord | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestUpload = useRequestImportUpload();
  const analyze = useAnalyzeImport();
  const commit = useCommitImport();
  const invalidate = useInvalidateWorkspace();
  const busy = uploading || analyze.isPending;
  const urlMode = !file && isUrl(text);

  const pickFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/\.(pdf|docx?)$/i.test(f.name)) { setError('Only PDF, DOC or DOCX files are accepted.'); return; }
    if (f.size > MAX) { setError('File exceeds the 10 MB limit.'); return; }
    setFile(f);
  };

  const run = async () => {
    setError(null); setDone(null);
    try {
      let body: { text?: string; url?: string; uploadId?: string; targetId?: string };
      if (file) {
        setUploading(true);
        const contentType = file.type || 'application/octet-stream';
        const { uploadId, uploadUrl } = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType } });
        const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
        setUploading(false);
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        body = { uploadId };
      } else if (urlMode) body = { url: text.trim() };
      else body = { text };
      if (targetId) body.targetId = targetId;
      const d = await analyze.mutateAsync({ data: body });
      const c = d.candidate;
      setDraft(d);
      setMeta({
        title: c.title ?? '', outlet: c.outlet ?? '', url: c.url ?? (urlMode ? text.trim() : ''), byline: c.byline ?? '',
        contributors: (c.credits ?? []).filter(credit => credit.role === 'contributor').map(credit => credit.name).join(', '),
        publishedAt: toLocalInput(c.publishedAt), sourceType: c.sourceType === 'x' ? 'x' : 'article', fullTextComplete: false,
      });
    } catch (e) {
      setUploading(false);
      setError(errText(e));
    }
  };

  const confirm = () => {
    if (!draft || !meta) return;
    setError(null);
    commit.mutate({
      data: {
        draftId: draft.draftId, title: meta.title.trim(), outlet: meta.outlet || undefined, url: meta.url || undefined,
        byline: meta.byline || undefined,
        contributors: meta.contributors,
        // The minute-precision form must not truncate seconds or relabel an
        // unchanged feed timestamp as a manually edited date.
        publishedAt: meta.publishedAt === toLocalInput(draft.candidate.publishedAt) ? draft.candidate.publishedAt : fromLocalInput(meta.publishedAt),
        sourceType: meta.sourceType,
        fullTextComplete: meta.fullTextComplete,
      },
    }, {
      onSuccess: (r) => {
        invalidate();
        setDone(r); setDraft(null); setMeta(null); setText(''); setFile(null);
        onCommitted?.(r);
      },
      onError: (e) => setError(`Save failed: ${errText(e)}`),
    });
  };

  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta(m => (m ? { ...m, [k]: v } : m));
  const matchedTarget = targetId ?? draft?.matchedId;

  return (
    <section className={cn('rounded-xl border border-border bg-card/85 backdrop-blur-sm', compact ? 'p-3' : 'p-4 md:p-5')} data-testid="panel-importer">
      {targetId && (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="text-import-target">
          Enriching: {targetTitle ?? 'this article'}
        </p>
      )}
      {!draft && (
        <>
          <div className="rounded-lg border border-input bg-background focus-within:border-foreground">
            <textarea value={text} onChange={e => setText(e.target.value)} disabled={!!file || busy}
              placeholder="Paste article text or a URL" rows={compact ? 4 : 7}
              className="block w-full resize-y rounded-t-lg bg-transparent px-3 py-2.5 text-sm outline-none disabled:opacity-50" data-testid="input-import-text" />
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
              <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-import-file" />
              {file ? (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs" data-testid="text-import-file">
                  <FileUp className="h-3.5 w-3.5" /><span className="truncate">{file.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                  <button onClick={() => setFile(null)} disabled={busy} aria-label="Remove file" data-testid="button-import-remove-file"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : (
                <button onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-import-upload">
                  <FileUp className="h-3.5 w-3.5" /> Upload PDF, DOC, DOCX (10 MB)
                </button>
              )}
              <button onClick={run} disabled={busy || (!file && !text.trim())}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50" data-testid="button-import-analyze">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : urlMode ? <Link2 className="h-3.5 w-3.5" /> : null}
                {uploading ? 'Uploading' : analyze.isPending ? 'Analyzing' : urlMode ? 'Fetch & analyze' : 'Analyze'}
              </button>
            </div>
          </div>
        </>
      )}

      {draft && meta && (
        <div className="space-y-3" data-testid="panel-import-preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Preview · {draft.source} · {draft.characterCount.toLocaleString()} chars</h3>
            <span className="rounded-md border border-border px-2 py-0.5 text-[11px]" data-testid="text-import-match">
              {matchedTarget ? `Updates existing${draft.matchReason ? ` · ${draft.matchReason}` : ''}` : 'Creates new article'}
            </span>
          </div>
          {draft.warnings.length > 0 && (
            <ul className="space-y-0.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="list-import-warnings">
              {draft.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs">Title<Input value={meta.title} onChange={e => set('title', e.target.value)} className="mt-1 h-8" data-testid="input-import-title" /></label>
            <label className="text-xs">Outlet<Input value={meta.outlet} onChange={e => set('outlet', e.target.value)} className="mt-1 h-8" data-testid="input-import-outlet" /></label>
            <label className="text-xs">URL<Input value={meta.url} onChange={e => set('url', e.target.value)} className="mt-1 h-8" data-testid="input-import-url" /></label>
            <label className="text-xs">Byline<Input value={meta.byline} onChange={e => set('byline', e.target.value)} className="mt-1 h-8" data-testid="input-import-byline" /></label>
            <label className="text-xs">Published<Input type="datetime-local" value={meta.publishedAt} onChange={e => set('publishedAt', e.target.value)} className="mt-1 h-8" data-testid="input-import-published" /></label>
            <label className="sm:col-span-2 text-xs">Contributing reporters<textarea value={meta.contributors} onChange={e => set('contributors', e.target.value)} rows={2} className="mt-1 block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="input-import-contributors" /></label>
            <label className="text-xs">Type
              <select value={meta.sourceType} onChange={e => set('sourceType', e.target.value as Meta['sourceType'])} className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="select-import-type">
                <option value="article">Article</option><option value="x">X post</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end text-xs"><Switch checked={meta.fullTextComplete} onCheckedChange={v => set('fullTextComplete', v)} data-testid="switch-import-complete" /> I confirm the text is complete</label>
          </div>
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Extracted text</div>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 font-serif text-sm leading-relaxed" data-testid="text-import-extracted">
              {draft.candidate.fullText || 'No text extracted.'}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setDraft(null); setMeta(null); }} disabled={commit.isPending} className="h-8 rounded-md border border-border px-3 text-xs" data-testid="button-import-back">Back</button>
            <button onClick={confirm} disabled={commit.isPending || !meta.title.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50" data-testid="button-import-confirm">
              {commit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {matchedTarget ? 'Save to existing' : 'Create article'}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-destructive" data-testid="text-import-error">{error}</p>}
      {done && !targetId && (
        <p className="mt-2 text-xs" data-testid="text-import-done">Saved: <Link href={`/?article=${done.id}`} className="underline underline-offset-4">{done.title}</Link></p>
      )}
      {done && targetId && <p className="mt-2 text-xs" data-testid="text-import-done">Content added to this article.</p>}
    </section>
  );
}
