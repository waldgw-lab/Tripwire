import { useEffect, useMemo, useState } from 'react';
import {
  getGetArticleContentQueryKey, getListEntityCapturesQueryKey, useAddEntityEvidence, useCreateEntity, useDecideEntity, useGetArticleContent, useListEntityCaptures,
  type EntityAction, type EntityCapture, type EntityDetail, type EvidenceInput, type RegistryEntity,
} from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CLASSIFICATIONS, DIMENSIONS, ENTITY_TYPES, errorText, fmtWhen, shortHash, useInvalidateEntities } from '@/lib/entities';
import { ErrorLine, Mono, btnCls, inputCls, primaryCls } from './ui';
import { useAllEntities } from '@/lib/coverage-tree';

const Lbl = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block space-y-1"><Mono>{t}</Mono>{children}</label>;

export function CreateEntityDialog({ open, onOpenChange, organizations, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; organizations: RegistryEntity[]; onCreated: (id: string) => void }) {
  const create = useCreateEntity();
  const invalidate = useInvalidateEntities();
  const [name, setName] = useState(''); const [type, setType] = useState<RegistryEntity['type']>('person');
  const [facets, setFacets] = useState(''); const [rationale, setRationale] = useState(''); const [org, setOrg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (open) { setName(''); setFacets(''); setRationale(''); setOrg(''); setErr(''); } }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rationale.trim().length < 5) return setErr('Inclusion reason is required (5+ characters).');
    create.mutate({ data: { name: name.trim(), type, rationale: rationale.trim(), facets: facets.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12), organizationId: org || undefined } }, {
      onSuccess: ent => { invalidate(); onOpenChange(false); onCreated(ent.id); }, onError: x => setErr(errorText(x)),
    });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md">
    <DialogHeader><DialogTitle className="font-display text-2xl uppercase">New entity</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-muted-foreground">Created as Discovered. Monitoring requires sourced evidence.</p>
      <Lbl t="Name"><input required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={inputCls} data-testid="input-entity-name" /></Lbl>
      <Lbl t="Type"><select value={type} onChange={e => setType(e.target.value as RegistryEntity['type'])} className={inputCls} data-testid="select-entity-type">{ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}</select></Lbl>
      {organizations.length > 0 && <Lbl t="Organization"><select value={org} onChange={e => setOrg(e.target.value)} className={inputCls} data-testid="select-entity-org"><option value="">None</option>{organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Lbl>}
      <Lbl t="Facets, comma separated"><input value={facets} onChange={e => setFacets(e.target.value)} className={inputCls} data-testid="input-entity-facets" /></Lbl>
      <Lbl t="Inclusion reason"><textarea required minLength={5} maxLength={2000} rows={3} value={rationale} onChange={e => setRationale(e.target.value)} className={`${inputCls} h-auto py-1.5`} data-testid="input-entity-rationale" /></Lbl>
      <ErrorLine error={err} />
      <div className="flex justify-end"><button type="submit" disabled={create.isPending || !name.trim()} className={primaryCls} data-testid="button-entity-create">{create.isPending ? 'Creating' : 'Create'}</button></div>
    </form>
  </DialogContent></Dialog>;
}

export type ActionPreset = Pick<EntityAction, 'action'> & Partial<EntityAction>;

export function EntityActionDialog({ preset, detail, onClose }: { preset: ActionPreset | null; detail: EntityDetail; onClose: () => void }) {
  const organizations = useAllEntities();
  const [organizationId, setOrganizationId] = useState('');
  const decide = useDecideEntity();
  const invalidate = useInvalidateEntities();
  const e = detail.entity;
  const [rationale, setRationale] = useState(''); const [state, setState] = useState<'Active' | 'Watch'>('Watch');
  const [cls, setCls] = useState(e.classification); const [priority, setPriority] = useState(String(e.priority));
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]); const [targetId, setTargetId] = useState('');
  const [dims, setDims] = useState<Record<string, string>>({}); const [err, setErr] = useState('');
  const [unresolved, setUnresolved] = useState(e.unresolved); const [name, setName] = useState(e.name);
  useEffect(() => {
    if (!preset) return;
    setRationale(''); setErr(''); setEvidenceIds([]); setTargetId(preset.targetId ?? ''); setCls(e.classification); setPriority(String(e.priority));
    setState(preset.state === 'Active' || preset.state === 'Watch' ? preset.state : e.state === 'Active' ? 'Active' : 'Watch'); setName(e.name); setDims(Object.fromEntries(DIMENSIONS.map(d => [d, ''])));
    setUnresolved(e.unresolved);
    setOrganizationId(e.organizationId ?? '');
  }, [preset, e.classification, e.priority, e.state, e.name, e.organizationId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!preset) return null;
  const a = preset.action;
  const monitor = a === 'monitor'; const merge = a === 'merge'; const reassess = a === 'reassess' || monitor;
  const rename = a === 'rename'; const needsState = monitor || a === 'reactivate' || a === 'reassess';
  const structuralOk = e.type === 'organization' || e.type === 'position';
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (rationale.trim().length < 5) return setErr('Rationale is required (5+ characters).');
    if (needsState && !evidenceIds.length) return setErr('Select at least one supporting evidence record.');
    if (rename && !name.trim()) return setErr('New display name is required.');
    if (cls === 'structural' && !structuralOk) return setErr('Structural classification is limited to organizations and positions.');
    if (merge && !targetId.trim()) return setErr('Target entity ID required.');
    const dimensions = Object.fromEntries(Object.entries(dims).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    const data: EntityAction = { ...preset, rationale: rationale.trim(),
      ...(a === 'organize' ? { organizationId: organizationId || null } : {}),
      ...(monitor || a === 'reactivate' || a === 'reassess' ? { state, evidenceIds } : {}), ...(merge ? { targetId: targetId.trim(), evidenceIds } : {}), ...(rename ? { name: name.trim() } : {}),
      ...(reassess ? { classification: cls, priority: Number(priority), unresolved, ...(Object.keys(dimensions).length ? { dimensions } : {}) } : {}),
      ...(a === 'correct' && evidenceIds.length ? { evidenceIds } : {}) };
    decide.mutate({ id: e.id, data }, { onSuccess: () => { invalidate(e.id); onClose(); }, onError: x => setErr(errorText(x)) });
  };
  return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
    <DialogHeader><DialogTitle className="font-display text-2xl uppercase">{a} · {e.name}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-3">
      {a === 'organize' && <Lbl t="Organization"><select value={organizationId} onChange={x => setOrganizationId(x.target.value)} className={inputCls} disabled={organizations.isLoading || organizations.isError} data-testid="select-entity-organization">
        <option value="">No organization</option>
        {organizations.data?.filter(o => o.type === 'organization' && o.id !== e.id && !o.redirectId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select><p className="text-xs text-muted-foreground">Organizational context only; this does not verify employment or role occupancy.</p>{organizations.isError && <button type="button" className={btnCls} onClick={() => organizations.refetch()}>Retry organizations</button>}</Lbl>}
      {rename && <Lbl t="New display name"><input required maxLength={200} value={name} onChange={x => setName(x.target.value)} className={inputCls} data-testid="input-rename-name" /></Lbl>}
      {needsState && <Lbl t="Monitoring state"><div className="flex gap-1">{(['Active', 'Watch'] as const).map(s => <button type="button" key={s} onClick={() => setState(s)} className={state === s ? primaryCls : btnCls} data-testid={`button-state-${s}`}>{s}</button>)}</div></Lbl>}
      {reassess && <div className="grid grid-cols-2 gap-2">
        <Lbl t="Classification"><select value={cls} onChange={x => setCls(x.target.value as typeof cls)} className={inputCls} data-testid="select-classification">{CLASSIFICATIONS.map(c => <option key={c} value={c} disabled={c === 'structural' && !structuralOk}>{c}</option>)}</select></Lbl>
        <Lbl t="Priority"><select value={priority} onChange={x => setPriority(x.target.value)} className={inputCls} data-testid="select-priority">{[1, 2, 3].map(p => <option key={p}>{p}</option>)}</select></Lbl>
        <div className="col-span-2 grid grid-cols-5 gap-1">{DIMENSIONS.map(d => <Lbl key={d} t={d}><input type="number" min={0} max={4} value={dims[d] ?? ''} onChange={x => setDims(p => ({ ...p, [d]: x.target.value }))} className={inputCls} data-testid={`input-dim-${d}`} /></Lbl>)}</div>
        <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={unresolved} onChange={x => setUnresolved(x.target.checked)} />Unresolved issue blocks automatic archival</label>
      </div>}
      {merge && <Lbl t="Merge into entity ID"><input value={targetId} onChange={x => setTargetId(x.target.value)} className={`${inputCls} font-mono`} data-testid="input-merge-target" /></Lbl>}
      {(monitor || merge || a === 'correct' || a === 'reactivate' || a === 'reassess') && <div><Mono>Supporting evidence</Mono>
        {detail.evidence.length ? <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">{detail.evidence.map(v => <li key={v.id}><label className="flex gap-2 text-xs">
          <input type="checkbox" checked={evidenceIds.includes(v.id)} onChange={x => setEvidenceIds(p => x.target.checked ? [...p, v.id].slice(0, 20) : p.filter(i => i !== v.id))} data-testid={`check-evidence-${v.id}`} />
          <span className="line-clamp-2">{v.excerpt}</span></label></li>)}</ul> : <p className="text-xs text-muted-foreground">No evidence yet. Add sourced evidence first.</p>}
      </div>}
      <Lbl t="Rationale"><textarea required minLength={5} maxLength={2000} rows={3} value={rationale} onChange={x => setRationale(x.target.value)} className={`${inputCls} h-auto py-1.5`} data-testid="input-action-rationale" /></Lbl>
      <ErrorLine error={err} />
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnCls}>Cancel</button><button type="submit" disabled={decide.isPending || a === 'organize' && !organizations.data} className={primaryCls} data-testid="button-action-submit">{decide.isPending ? 'Recording' : 'Record decision'}</button></div>
    </form>
  </DialogContent></Dialog>;
}

function CaptureText({ articleId, captureId, onSelect }: { articleId: string; captureId: string; onSelect: (start: number, end: number, text: string) => void }) {
  const params = { capture: captureId };
  const q = useGetArticleContent(articleId, params, { query: { queryKey: getGetArticleContentQueryKey(articleId, params), staleTime: 300_000 } });
  if (q.isLoading) return <div className="h-32 animate-pulse rounded bg-muted" />;
  if (q.isError || !q.data?.text) return <p className="text-xs text-muted-foreground">Capture text unavailable. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button></p>;
  const text = q.data.text;
  const pick = (ev: React.SyntheticEvent<HTMLTextAreaElement>) => { const t = ev.currentTarget; if (t.selectionEnd > t.selectionStart) onSelect(t.selectionStart, t.selectionEnd, text.slice(t.selectionStart, t.selectionEnd)); };
  return <textarea readOnly value={text} onSelect={pick} rows={8} className="w-full rounded-md border border-input bg-background p-2 font-serif text-[13px] leading-relaxed" aria-label="Capture text, select the exact passage" data-testid="text-capture-body" />;
}

const CAP_PAGE = 30;

export function EvidenceDialog({ open, onOpenChange, entity }: { open: boolean; onOpenChange: (o: boolean) => void; entity: RegistryEntity }) {
  const add = useAddEntityEvidence();
  const invalidate = useInvalidateEntities();
  const [capOffset, setCapOffset] = useState(0); const [capArticle, setCapArticle] = useState('');
  const capParams = { offset: capOffset, ...(capArticle.trim() && { articleId: capArticle.trim() }) };
  const caps = useListEntityCaptures(capParams, { query: { queryKey: getListEntityCapturesQueryKey(capParams), enabled: open, placeholderData: p => p } });
  const capTotal = caps.data?.total ?? 0;
  const [picked, setPicked] = useState<EntityCapture | null>(null);
  const blank = { captureId: '', excerpt: '', start: 0, end: 0, attribution: '', certainty: 'attributed', scope: '', predicate: 'occupies', relation: 'unknown', novelty: 'unknown', independentlyReported: false } as Partial<EvidenceInput>;
  const [f, setF] = useState<Partial<EvidenceInput>>(blank); const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF(blank); setErr(''); setPicked(null); setCapOffset(0); setCapArticle(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const capture = useMemo(() => caps.data?.items.find(c => c.id === f.captureId) ?? (picked?.id === f.captureId ? picked : undefined), [caps.data, f.captureId, picked]);
  const set = <K extends keyof EvidenceInput>(k: K, v: EvidenceInput[K] | undefined) => setF(p => ({ ...p, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.captureId) return setErr('Select a retained capture.');
    if ((f.excerpt ?? '').length < 20) return setErr('Select an exact passage of at least 20 characters.');
    if (!f.attribution?.trim() || !f.scope?.trim()) return setErr('Attribution and scope are required.');
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined)) as Partial<EvidenceInput>;
    add.mutate({ data: { ...clean, entityId: entity.id } as EvidenceInput }, { onSuccess: () => { invalidate(entity.id); onOpenChange(false); }, onError: x => setErr(errorText(x)) });
  };
  const txt = (k: keyof EvidenceInput, t: string, type = 'text') => <Lbl t={t}><input type={type} value={String(f[k] ?? '')} onChange={e => set(k, e.target.value as never)} className={inputCls} data-testid={`input-evidence-${k}`} /></Lbl>;
  const sel = (k: keyof EvidenceInput, t: string, opts: string[]) => <Lbl t={t}><select value={String(f[k] ?? '')} onChange={e => set(k, (e.target.value || undefined) as never)} className={inputCls} data-testid={`select-evidence-${k}`}>{opts.map(o => <option key={o} value={o}>{o || 'none'}</option>)}</select></Lbl>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle className="font-display text-2xl uppercase">Evidence · {entity.name}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-3">
      <Lbl t="Retained capture">
        {caps.isLoading ? <div className="h-8 animate-pulse rounded bg-muted" /> : caps.isError ? <ErrorLine error="Captures could not be loaded." /> :
          <div className="space-y-1"><div className="flex items-center gap-2">
            <input value={capArticle} onChange={e => { setCapArticle(e.target.value); setCapOffset(0); }} placeholder="Filter by article ID" className={inputCls} data-testid="input-capture-article" />
            <button type="button" disabled={capOffset === 0} onClick={() => setCapOffset(o => Math.max(0, o - CAP_PAGE))} className="p-1 disabled:opacity-30" aria-label="Newer captures" data-testid="button-captures-prev"><ChevronLeft className="h-4 w-4" /></button>
            <span className="whitespace-nowrap font-mono text-[10px]">{capTotal ? `${capOffset + 1}-${Math.min(capOffset + CAP_PAGE, capTotal)} / ${capTotal}` : '0'}</span>
            <button type="button" disabled={capOffset + CAP_PAGE >= capTotal} onClick={() => setCapOffset(o => o + CAP_PAGE)} className="p-1 disabled:opacity-30" aria-label="Older captures" data-testid="button-captures-next"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <select value={f.captureId} onChange={e => { const id = e.target.value; setPicked(caps.data?.items.find(c => c.id === id) ?? null); setF(p => ({ ...p, captureId: id, excerpt: '', start: 0, end: 0 })); }} className={inputCls} data-testid="select-evidence-capture">
            <option value="">Select capture</option>
            {picked && !caps.data?.items.some(c => c.id === picked.id) && <option value={picked.id}>{picked.publisher ?? picked.source} · {fmtWhen(picked.publishedAt ?? picked.capturedAt)} · {shortHash(picked.hash)}</option>}
            {caps.data?.items.map(c => <option key={c.id} value={c.id}>{c.publisher ?? c.source} · {fmtWhen(c.publishedAt ?? c.capturedAt)} · {shortHash(c.hash)}{c.complete ? '' : ' · partial'}</option>)}
          </select></div>}
      </Lbl>
      {capture && <>
        <Mono>{capture.byline ?? 'No byline'} · captured {fmtWhen(capture.capturedAt)} · {capture.authorized ? 'authorized' : 'not authorized'}</Mono>
        <CaptureText articleId={capture.articleId} captureId={capture.captureId} onSelect={(start, end, text) => setF(p => ({ ...p, start, end, excerpt: text }))} />
        <div className="rounded-md border border-border bg-muted/50 p-2 text-xs"><Mono>Selected passage · {f.start}-{f.end}</Mono><p className="mt-1 whitespace-pre-wrap font-serif" data-testid="text-evidence-excerpt">{f.excerpt || 'Select text above.'}</p></div>
      </>}
      <div className="grid gap-2 sm:grid-cols-3">
        {sel('predicate', 'Predicate', ['occupies', 'commands', 'advises', 'oversees', 'appointed', 'met-with', 'negotiated-with', 'criticized', 'investigated', 'supplies-capability', 'reportedly-discussed', 'involved-in', 'alias', 'identifier'])}
        {txt('objectId', 'Object entity ID')}{txt('value', 'Value')}
        {txt('attribution', 'Attribution')}{sel('certainty', 'Certainty', ['asserted', 'attributed', 'alleged', 'disputed', 'inferred', 'confirmed'])}{txt('scope', 'Scope')}
        {sel('tenure', 'Tenure', ['', 'current', 'acting', 'interim', 'former', 'concurrent', 'disputed', 'nominated'])}{txt('validFrom', 'Valid from', 'date')}{txt('validTo', 'Valid to', 'date')}
        {sel('relation', 'Source relation', ['unknown', 'original', 'citation', 'syndication', 'addition', 'commentary', 'authoritative-appointment'])}{txt('originKey', 'Origin key')}
        <Lbl t="Independently reported"><input type="checkbox" checked={!!f.independentlyReported} onChange={e => set('independentlyReported', e.target.checked)} data-testid="check-evidence-independent" /></Lbl>
        {txt('eventKey', 'Event key')}{txt('claimKey', 'Claim key')}{sel('novelty', 'Novelty', ['unknown', 'repetition', 'material', 'conflicting', 'correction'])}
        {txt('supersedesId', 'Supersedes assertion')}{txt('disputesId', 'Disputes assertion')}
        <Lbl t="Consequence 0-4"><input type="number" min={0} max={4} value={f.consequence ?? ''} onChange={e => set('consequence', e.target.value === '' ? undefined : Number(e.target.value))} className={inputCls} data-testid="input-evidence-consequence" /></Lbl>
      </div>
      <Lbl t="Sourcing assessment"><textarea rows={2} maxLength={2000} value={f.sourcingRationale ?? ''} onChange={e => set('sourcingRationale', e.target.value)} className={`${inputCls} h-auto py-1.5`} data-testid="input-evidence-sourcing" /></Lbl>
      <ErrorLine error={err} />
      <div className="flex justify-end"><button type="submit" disabled={add.isPending} className={primaryCls} data-testid="button-evidence-submit">{add.isPending ? 'Saving' : 'Add evidence'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
