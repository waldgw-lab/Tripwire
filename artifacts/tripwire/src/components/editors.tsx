import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArticleCorrectionInputReason, ArticleDismissalInputReason, type ArticleCredit, type Observation, type RecordInput, type TrackedRecord } from '@workspace/api-client-react';
import { articleCredits, creditRoles } from '@/lib/media-coverage';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteRecord } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldLabel } from '@/components/bits';
import {
  FOCUS, REPORTING, SENTIMENT, STAGES, WATCH_TYPES, errText, fromLocalInput, isConflict, newRequestId, useInvalidateWorkspace, splitList, toInput, toLocalInput, useRemove, useSave, useWorkspace, byKind,
} from '@/lib/workspace';

function F({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={className}><FieldLabel>{label}</FieldLabel>{children}</label>;
}

function Pick({ value, onChange, options, testId, placeholder }: { value: string; onChange: (v: string) => void; options: readonly string[]; testId: string; placeholder?: string }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger data-testid={testId} className="h-9 bg-card"><SelectValue placeholder={placeholder ?? 'Select'} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Shell({ open, onOpenChange, title, onSubmit, pending, canSubmit = true, wide, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; onSubmit: () => void; pending: boolean; canSubmit?: boolean; wide?: boolean; children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={wide ? 'max-h-[92dvh] overflow-y-auto sm:max-w-3xl' : 'max-h-[92dvh] overflow-y-auto sm:max-w-xl'}>
        <DialogHeader><DialogTitle className="font-display text-3xl font-semibold">{title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(); }} className="space-y-4">
          {children}
          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-md px-4 text-sm text-muted-foreground hover:text-foreground" data-testid="button-cancel">Cancel</button>
            <button type="submit" disabled={pending || !canSubmit} className="h-9 rounded-md bg-primary px-5 text-sm text-primary-foreground disabled:opacity-50" data-testid="button-submit">
              {pending ? 'Saving' : 'Save'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type EditorProps = { open: boolean; onOpenChange: (o: boolean) => void; record?: TrackedRecord | null };

const initImpact = (r?: TrackedRecord | null) => !r ? 'auto' : r.impactMode ? (r.impactMode === 'manual' ? r.impact ?? 'auto' : 'auto') : r.impact ?? 'auto';
const initTopicAuto = (r?: TrackedRecord | null) => !r ? true : r.topicMode ? r.topicMode !== 'manual' : !r.topic;

export function ArticleEditor({ open, onOpenChange, record: opened }: EditorProps) {
  const save = useSave();
  const { data: ws } = useWorkspace();
  const record = opened ? (ws?.records.find(r => r.id === opened.id) ?? opened) : opened;
  const [baseRev, setBaseRev] = useState(0);
  const [topicAuto, setTopicAuto] = useState(true);
  const [cReason, setCReason] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [conflict, setConflict] = useState(false);
  const [credits, setCredits] = useState<ArticleCredit[]>([]);
  const [f, setF] = useState({ sourceType: 'article', title: '', url: '', outlet: '', publishedAt: '', topic: '', entities: '', reportingType: 'unassessed', sentiment: 'unassessed', focus: '', summary: '', fullText: '', fullTextComplete: false, impact: 'auto', saved: false });
  useEffect(() => {
    if (!open) return;
    const record = opened;
    setBaseRev(record?.classificationRevision ?? 0); setTopicAuto(initTopicAuto(record)); setCReason(''); setCNotes(''); setConflict(false);
    setCredits(record ? articleCredits(record) : [{ name: '', role: 'author' }]);
    setF({
      sourceType: record?.sourceType ?? 'article', title: record?.title ?? '', url: record?.url ?? '', outlet: record?.outlet ?? '',
      publishedAt: toLocalInput(record?.publishedAt), topic: record?.topic ?? '',
      entities: (record?.entities ?? []).join(', '), reportingType: record?.reportingType ?? 'unassessed', sentiment: record?.sentiment ?? 'unassessed',
      focus: record?.focus ?? '', summary: record?.summary ?? '', fullText: record?.fullText ?? '', fullTextComplete: record?.fullTextComplete ?? false, impact: initImpact(record), saved: record ? (record.flagged ?? record.saved ?? false) : false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opened?.id]);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const isX = f.sourceType === 'x';
  const impactChanged = !!opened && f.impact !== initImpact(opened);
  const topicChanged = !!opened && (topicAuto !== initTopicAuto(opened) || (!topicAuto && f.topic.trim() !== (opened.topic ?? '')));
  const classChanged = impactChanged || topicChanged;
  const classOk = !classChanged || (!!cReason && (cReason !== 'Other' || !!cNotes.trim()));
  const currentRev = record?.classificationRevision ?? 0;

  const submit = () => {
    const data: RecordInput = {
      ...(record ? toInput(record) : {}), kind: 'article', title: f.title.trim(),
      sourceType: f.sourceType as RecordInput['sourceType'], url: f.url || undefined, outlet: f.outlet || undefined,
      credits: credits.filter(c => c.name.trim()).map(c => ({ ...c, name: c.name.trim() })),
      journalists: [...new Set(credits.filter(c => c.role === 'author' && c.name.trim()).map(c => c.name.trim()))],
      publishedAt: fromLocalInput(f.publishedAt), topic: topicAuto ? undefined : (f.topic.trim() || undefined), topicMode: topicAuto ? 'auto' : 'manual', impactMode: f.impact === 'auto' ? 'auto' : 'manual',
      ...(classChanged ? { classificationReason: cReason, classificationNotes: cNotes.trim() || undefined } : { classificationReason: undefined, classificationNotes: undefined }),
      expectedClassificationRevision: record ? baseRev : undefined,
      entities: splitList(f.entities), reportingType: f.reportingType as RecordInput['reportingType'],
      sentiment: f.sentiment as RecordInput['sentiment'], focus: (f.focus || undefined) as RecordInput['focus'],
      summary: f.summary || undefined, fullText: f.fullText || undefined, fullTextComplete: f.fullTextComplete,
      impact: f.impact === 'auto' ? undefined : f.impact as RecordInput['impact'], saved: f.saved, flagged: f.saved, flaggedAt: f.saved ? (record?.flaggedAt ?? new Date().toISOString()) : undefined,
    };
    save.mutate({ data }, { onSuccess: () => onOpenChange(false), onError: (e) => { if (isConflict(e)) setConflict(true); } });
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} title={record ? 'Edit item' : 'Intake'} onSubmit={submit} pending={save.isPending} canSubmit={!!f.title.trim() && classOk && !conflict} wide>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <F label="Source"><Pick testId="select-source-type" value={f.sourceType} onChange={set('sourceType')} options={['article', 'x', 'statement', 'document']} /></F>
        <F label={isX ? 'Post text (headline)' : 'Headline'}><Input data-testid="input-title" value={f.title} onChange={(e) => set('title')(e.target.value)} /></F>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="URL"><Input data-testid="input-url" value={f.url} onChange={(e) => set('url')(e.target.value)} /></F>
        <F label={isX ? 'Account' : 'Outlet'}><Input data-testid="input-outlet" value={f.outlet} onChange={(e) => set('outlet')(e.target.value)} /></F>
        <F label="Published"><Input type="datetime-local" data-testid="input-published" value={f.publishedAt} onChange={(e) => set('publishedAt')(e.target.value)} /></F>
        <F label="Topic"><div className="flex items-center gap-2">
          <Input data-testid="input-topic" value={topicAuto ? (record?.automaticAssessment?.topic ?? f.topic) : f.topic} disabled={topicAuto} onChange={(e) => set('topic')(e.target.value)} />
          <span className="flex shrink-0 items-center gap-1.5 text-xs"><Switch checked={topicAuto} onCheckedChange={setTopicAuto} aria-label="Automatic topic" data-testid="switch-topic-auto" /> Auto</span>
        </div></F>
        <F label="Entities, comma separated"><Input data-testid="input-entities" value={f.entities} onChange={(e) => set('entities')(e.target.value)} /></F>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Byline credits</legend>
        {credits.map((credit, index) => <div key={index} className="grid grid-cols-[1fr_130px_28px] gap-2">
          <Input aria-label={`Credited name ${index + 1}`} placeholder="Name as credited" data-testid={`input-credit-name-${index}`} value={credit.name} onChange={e => setCredits(current => current.map((c, i) => i === index ? { ...c, name: e.target.value } : c))} />
          <Pick value={credit.role} options={creditRoles} testId={`select-credit-role-${index}`} onChange={role => setCredits(current => current.map((c, i) => i === index ? { ...c, role: role as ArticleCredit['role'] } : c))} />
          <button type="button" aria-label={`Remove credit ${index + 1}`} data-testid={`button-remove-credit-${index}`} onClick={() => setCredits(current => current.filter((_, i) => i !== index))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          <Input aria-label={`Credit wording ${index + 1}`} placeholder="Original credit wording (optional)" className="col-span-3 h-8 text-xs" value={credit.attribution ?? ''} onChange={e => setCredits(current => current.map((c, i) => i === index ? { ...c, attribution: e.target.value } : c))} />
        </div>)}
        <button type="button" data-testid="button-add-credit" className="inline-flex items-center gap-1 text-xs" onClick={() => setCredits(current => [...current, { name: '', role: 'author' }])}><Plus className="h-3.5 w-3.5" /> Credit</button>
        {record?.byline && <p className="text-xs text-muted-foreground">{record.byline}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <F label="Reporting"><Pick testId="select-reporting" value={f.reportingType} onChange={set('reportingType')} options={REPORTING} /></F>
        <F label="Sentiment"><Pick testId="select-sentiment" value={f.sentiment} onChange={set('sentiment')} options={SENTIMENT} /></F>
        <F label="Focus"><Pick testId="select-focus" value={f.focus} onChange={set('focus')} options={FOCUS} placeholder="None" /></F>
        <F label="Impact"><Select value={f.impact} onValueChange={set('impact')}>
          <SelectTrigger data-testid="select-impact" className="h-9 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>{[['auto', 'Automatic'], ['critical', 'CRITICAL'], ['high', 'HIGH'], ['low', 'LOW']].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select></F>
      </div>
      {classChanged && (
        <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[200px_1fr]" data-testid="editor-classification-reason">
          <F label="Classification reason"><Pick testId="select-classification-reason" value={cReason} onChange={setCReason} options={Object.values(ArticleCorrectionInputReason)} placeholder="Required" /></F>
          <F label={cReason === 'Other' ? 'Note (required)' : 'Note'}><Input data-testid="input-classification-notes" value={cNotes} maxLength={4000} onChange={e => setCNotes(e.target.value)} /></F>
        </div>
      )}
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 px-3 py-2 text-xs" data-testid="text-editor-conflict">
          <span>Classification changed elsewhere (rev {baseRev} {'->'} {currentRev}). Now: impact {record?.impact?.toUpperCase() ?? '—'} ({record?.impactMode ?? 'auto'}), topic {record?.topic || '—'} ({record?.topicMode ?? 'auto'}).</span>
          <button type="button" className="underline underline-offset-4" data-testid="button-editor-decide-again" onClick={() => { setBaseRev(currentRev); setConflict(false); }}>Keep my choice, decide again</button>
        </div>
      )}
      <F label="Summary" className="block"><Textarea rows={2} data-testid="input-summary" value={f.summary} onChange={(e) => set('summary')(e.target.value)} /></F>
      <F label="Full text" className="block"><Textarea rows={9} className="font-serif text-[15px] leading-relaxed" data-testid="input-fulltext" value={f.fullText} onChange={(e) => set('fullText')(e.target.value)} /></F>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.fullTextComplete} onCheckedChange={value => set('fullTextComplete')(value === true)} data-testid="checkbox-fulltext-complete" /> Full article text is complete</label>
      <label className="flex items-center gap-2 text-sm"><Switch checked={f.saved} onCheckedChange={set('saved')} data-testid="switch-flagged" /> Flagged</label>
    </Shell>
  );
}

const blankObs = (): Observation => ({ id: crypto.randomUUID(), stage: 'origin', articleId: '', journalist: '', attribution: '', evidence: '', observedAt: new Date().toISOString(), verified: false, url: '' });

export function ClaimEditor({ open, onOpenChange, record, articles }: EditorProps & { articles: TrackedRecord[] }) {
  const save = useSave();
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [summary, setSummary] = useState('');
  const [entities, setEntities] = useState('');
  const [obs, setObs] = useState<Observation[]>([]);
  useEffect(() => {
    if (!open) return;
    setTitle(record?.title ?? ''); setTopic(record?.topic ?? ''); setSummary(record?.summary ?? '');
    setEntities((record?.entities ?? []).join(', ')); setObs(record?.observations ?? []);
  }, [open, record]);
  const patch = (i: number, p: Partial<Observation>) => setObs((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const linkArticle = (i: number, id: string) => {
    const a = articles.find((x) => x.id === id);
    const credits = a ? articleCredits(a) : [];
    patch(i, { articleId: id, url: a?.url ?? obs[i].url, journalist: obs[i].journalist || credits.find(c => c.role === 'author')?.name || credits[0]?.name || '', observedAt: a?.publishedAt ?? obs[i].observedAt });
  };

  const submit = () => {
    const data: RecordInput = {
      ...(record ? toInput(record) : {}), kind: 'claim', title: title.trim(), topic: topic || undefined, summary: summary || undefined,
      entities: splitList(entities), observations: obs.map((o) => ({ ...o, url: o.url || undefined })),
    };
    save.mutate({ data }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} title={record ? 'Edit claim' : 'New claim'} onSubmit={submit} pending={save.isPending} canSubmit={!!title.trim()} wide>
      <F label="Claim" className="block"><Textarea rows={2} className="font-serif text-base" data-testid="input-claim-title" value={title} onChange={(e) => setTitle(e.target.value)} /></F>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Topic"><Input data-testid="input-claim-topic" value={topic} onChange={(e) => setTopic(e.target.value)} /></F>
        <F label="Entities, comma separated"><Input data-testid="input-claim-entities" value={entities} onChange={(e) => setEntities(e.target.value)} /></F>
      </div>
      <F label="Notes" className="block"><Textarea rows={2} data-testid="input-claim-summary" value={summary} onChange={(e) => setSummary(e.target.value)} /></F>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel>Observations</FieldLabel>
          <button type="button" onClick={() => setObs((o) => [...o, blankObs()])} data-testid="button-add-observation" className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><Plus className="h-3.5 w-3.5" /> Observation</button>
        </div>
        <div className="space-y-3">
          {obs.map((o, i) => (
            <div key={o.id} className="rounded-md border border-border bg-muted/40 p-3" data-testid={`editor-observation-${i}`}>
              <div className="grid gap-2 sm:grid-cols-[130px_1fr_auto]">
                <Pick testId={`select-stage-${i}`} value={o.stage} onChange={(v) => patch(i, { stage: v as Observation['stage'] })} options={STAGES} />
                <Select value={o.articleId || undefined} onValueChange={(v) => linkArticle(i, v)}>
                  <SelectTrigger className="h-9 bg-card" data-testid={`select-article-${i}`}><SelectValue placeholder="Link article" /></SelectTrigger>
                  <SelectContent className="max-w-[520px]">
                    {articles.map((a) => <SelectItem key={a.id} value={a.id}><span className="truncate">{a.outlet ? `${a.outlet} — ` : ''}{a.title}</span></SelectItem>)}
                  </SelectContent>
                </Select>
                <button type="button" onClick={() => setObs((x) => x.filter((_, j) => j !== i))} className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-destructive" data-testid={`button-remove-observation-${i}`}><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Input placeholder="Journalist" value={o.journalist} onChange={(e) => patch(i, { journalist: e.target.value })} data-testid={`input-obs-journalist-${i}`} />
                <Input type="datetime-local" value={toLocalInput(o.observedAt)} onChange={(e) => patch(i, { observedAt: fromLocalInput(e.target.value) ?? '' })} data-testid={`input-obs-time-${i}`} />
                <Input placeholder="URL" value={o.url ?? ''} onChange={(e) => patch(i, { url: e.target.value })} data-testid={`input-obs-url-${i}`} />
              </div>
              <Input className="mt-2 font-serif italic" placeholder="Verbatim attribution" value={o.attribution} onChange={(e) => patch(i, { attribution: e.target.value })} data-testid={`input-obs-attribution-${i}`} />
              <Textarea className="mt-2" rows={2} placeholder="Evidence" value={o.evidence} onChange={(e) => patch(i, { evidence: e.target.value })} data-testid={`input-obs-evidence-${i}`} />
              <label className="mt-2 flex items-center gap-2 text-xs"><Checkbox checked={o.verified} onCheckedChange={(c) => patch(i, { verified: c === true })} data-testid={`checkbox-obs-verified-${i}`} /> Analyst verified</label>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function WatchEditor({ open, onOpenChange, record, initialWatchType = 'position', excludeTypes = [], allowedTypes }: EditorProps & { initialWatchType?: string; excludeTypes?: string[]; allowedTypes?: string[] }) {
  const save = useSave();
  const { data: workspace } = useWorkspace();
  const organizations = byKind(workspace?.records, 'watch').filter(w => w.watchType === 'organization' && w.id !== record?.id);
  const outlets = byKind(workspace?.records, 'outlet');
  const [f, setF] = useState({ title: '', watchType: initialWatchType, outlet: '', organization: '', individual: '', tier: '1', aliases: '', summary: '', enabled: true });
  useEffect(() => {
    if (!open) return;
    setF({ title: record?.position || record?.title || '', watchType: record?.watchType === 'person' ? 'position' : record?.watchType ?? initialWatchType, outlet: record?.outlet ?? '', organization: record?.organization ?? '', individual: record?.individual ?? '', tier: String(record?.tier ?? 1), aliases: (record?.aliases ?? []).join(', '), summary: record?.summary ?? '', enabled: record?.enabled ?? true });
  }, [open, record, initialWatchType]);
  const submit = () => {
    const data: RecordInput = {
      ...(record ? toInput(record) : {}), kind: 'watch', title: f.watchType === 'position' ? record?.title ?? f.title.trim() : f.title.trim(), watchType: f.watchType as RecordInput['watchType'],
      position: f.watchType === 'position' ? f.title.trim() : '', individual: f.watchType === 'position' ? f.individual.trim() : '', organization: f.organization.trim(),
      outlet: f.watchType === 'journalist' ? f.outlet.trim() : '',
      tier: Number(f.tier), aliases: splitList(f.aliases), summary: f.summary, enabled: f.enabled,
    };
    save.mutate({ data }, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={record ? 'Edit watch' : 'Add watch'} onSubmit={submit} pending={save.isPending} canSubmit={!!f.title.trim()}>
      <F label={f.watchType === 'position' ? 'Position' : f.watchType === 'x-account' ? 'Handle' : 'Name'} className="block"><Input data-testid="input-watch-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></F>
      <div className="grid grid-cols-2 gap-3">
        <F label="Type"><Pick testId="select-watch-type" value={f.watchType} onChange={(v) => setF({ ...f, watchType: v })} options={WATCH_TYPES.filter(t => (!allowedTypes || allowedTypes.includes(t)) && (!excludeTypes.includes(t) || t === f.watchType))} /></F>
        <F label="Tier"><Pick testId="select-watch-tier" value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={['1', '2', '3']} /></F>
      </div>
      {f.watchType === 'journalist' ? <F label="Outlet" className="block">
        <Input list="watch-outlets" data-testid="input-watch-outlet" value={f.outlet} onChange={e => setF({ ...f, outlet: e.target.value })} />
        <datalist id="watch-outlets">{outlets.map(w => <option key={w.id} value={w.title} />)}</datalist>
      </F> : <F label={f.watchType === 'organization' ? 'Parent organization' : 'Organization'} className="block">
        <Input list="watch-organizations" data-testid="input-watch-organization" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} />
        <datalist id="watch-organizations">{organizations.map(w => <option key={w.id} value={w.title} />)}</datalist>
      </F>}
      {f.watchType === 'position' && <F label="Individual" className="block"><Input data-testid="input-watch-individual" value={f.individual} onChange={(e) => setF({ ...f, individual: e.target.value })} /></F>}
      <F label="Aliases, comma separated" className="block"><Input data-testid="input-watch-aliases" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} /></F>
      <F label="Relevance" className="block"><Textarea rows={2} data-testid="input-watch-summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></F>
      <label className="flex items-center gap-2 text-sm"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} data-testid="switch-watch-enabled" /> Active</label>
    </Shell>
  );
}

export function OutletEditor({ open, onOpenChange, record }: EditorProps) {
  const save = useSave();
  const [f, setF] = useState({ title: '', url: '', feedUrl: '', enabled: true, tier: '1' });
  useEffect(() => {
    if (!open) return;
    setF({ title: record?.title ?? '', url: record?.url ?? '', feedUrl: record?.feedUrl ?? '', enabled: record?.enabled ?? true, tier: String(record?.tier ?? 1) });
  }, [open, record]);
  const submit = () => {
    const data: RecordInput = { ...(record ? toInput(record) : {}), kind: 'outlet', title: f.title.trim(), url: f.url || undefined, feedUrl: f.feedUrl || undefined, enabled: f.enabled, tier: Number(f.tier) };
    save.mutate({ data }, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={record ? 'Edit outlet' : 'Add outlet'} onSubmit={submit} pending={save.isPending} canSubmit={!!f.title.trim()}>
      <F label="Outlet" className="block"><Input data-testid="input-outlet-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></F>
      <F label="Site URL" className="block"><Input data-testid="input-outlet-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></F>
      <F label="Feed URL" className="block"><Input className="font-mono text-xs" data-testid="input-outlet-feed" value={f.feedUrl} onChange={(e) => setF({ ...f, feedUrl: e.target.value })} /></F>
      <div className="flex items-end justify-between gap-3">
        <F label="Tier" className="w-28"><Pick testId="select-outlet-tier" value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={['1', '2', '3']} /></F>
        <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} data-testid="switch-outlet-enabled" /> Polling enabled</label>
      </div>
    </Shell>
  );
}

const DISMISS_REASONS = Object.values(ArticleDismissalInputReason);

function ArticleDelete({ target, onClose }: { target: TrackedRecord; onClose: () => void }) {
  const invalidate = useInvalidateWorkspace();
  const qc = useQueryClient();
  const remove = useDeleteRecord({ mutation: { onSettled: () => invalidate() } });
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [dup, setDup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const canSubmit = !!reason && (reason !== 'Other' || !!notes.trim()) && !remove.isPending;
  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    remove.mutate({ id: target.id, data: { reason: reason as ArticleDismissalInputReason, notes: notes.trim() || undefined, duplicateOf: reason === 'Duplicate item' && dup.trim() ? dup.trim() : undefined, requestId: requestId.current } }, {
      onSuccess: onClose,
      onError: (e) => {
        if (isConflict(e)) { requestId.current = newRequestId(); void qc.invalidateQueries(); setError('This article changed or was already removed. Review the current state and confirm again.'); }
        else setError(errText(e));
      },
    });
  };
  return (
    <Dialog open onOpenChange={o => !o && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="font-serif text-xl font-normal">Delete “{target.title}”?</DialogTitle></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3">
          <F label="Reason" className="block"><Pick testId="select-delete-reason" value={reason} onChange={setReason} options={DISMISS_REASONS} placeholder="Required" /></F>
          {reason === 'Duplicate item' && <F label="Duplicate of article id (optional)" className="block"><Input className="font-mono text-xs" data-testid="input-delete-duplicate" value={dup} onChange={e => setDup(e.target.value)} /></F>}
          <F label={reason === 'Other' ? 'Note (required)' : 'Note (optional)'} className="block"><Textarea rows={2} maxLength={4000} data-testid="input-delete-notes" value={notes} onChange={e => setNotes(e.target.value)} /></F>
          {error && <p role="alert" className="text-xs text-destructive" data-testid="text-delete-error">{error}</p>}
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={remove.isPending} className="h-9 rounded-md px-4 text-sm text-muted-foreground hover:text-foreground" data-testid="button-cancel-delete">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="h-9 rounded-md bg-destructive px-5 text-sm text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-delete">
              {remove.isPending ? 'Deleting' : error ? 'Retry delete' : 'Delete'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDelete({ target, onClose }: { target: TrackedRecord | null; onClose: () => void }) {
  if (target?.kind === 'article') return <ArticleDelete key={target.id} target={target} onClose={onClose} />;
  return <GenericDelete target={target} onClose={onClose} />;
}

function GenericDelete({ target, onClose }: { target: TrackedRecord | null; onClose: () => void }) {
  const remove = useRemove();
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle className="font-serif text-xl font-normal">Delete “{target?.title}”?</AlertDialogTitle></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
          <AlertDialogAction data-testid="button-confirm-delete" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => target && remove.mutate({ id: target.id }, { onSuccess: onClose })}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
