import { useState } from 'react';
import { getListDevelopmentsQueryKey, useDecideDevelopment, useListDevelopments, type DevelopmentActionStatus, type EntityDevelopment, type ListDevelopmentsParams } from '@workspace/api-client-react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DISPOSITIONS, POLL_MS, errorText, fmtWhen, useInvalidateEntities } from '@/lib/entities';
import { ErrorLine, Mono, Tag, btnCls, inputCls, primaryCls } from '@/components/entities/ui';

/** Repeated observations collapse; material, conflicting and correction observations stay visible. */
function splitObservations(d: EntityDevelopment) {
  const seen = new Set<string>(); const visible = [] as EntityDevelopment['observations']; let repeats = 0;
  for (const o of d.observations) {
    const key = `${o.lineage?.originKey ?? 'unknown'}:${o.excerpt}`;
    if (seen.has(key)) repeats++; else { seen.add(key); visible.push(o); }
  }
  return { visible, repeats };
}

function DevelopmentItem({ d }: { d: EntityDevelopment }) {
  const decide = useDecideDevelopment(); const invalidate = useInvalidateEntities();
  const [open, setOpen] = useState(false); const [mode, setMode] = useState<DevelopmentActionStatus | null>(null);
  const [rationale, setRationale] = useState(''); const [disp, setDisp] = useState(d.disposition); const [err, setErr] = useState('');
  const { visible, repeats } = splitObservations(d);
  const submit = () => {
    if (!mode) return;
    if (rationale.trim().length < 5) return setErr('Rationale required (5+ characters).');
    decide.mutate({ id: d.id, data: { status: mode, rationale: rationale.trim(), ...(disp !== d.disposition && { disposition: disp }) } }, {
      onSuccess: () => { invalidate(); setMode(null); setRationale(''); setErr(''); }, onError: x => setErr(errorText(x)),
    });
  };
  return <li className={cn('tw-feed-item rounded-xl px-3 py-2.5', d.status !== 'open' && 'opacity-60')} data-testid={`row-development-${d.id}`}>
    <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
      <Tag value={d.disposition} />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-snug">{d.title}</span>
        <Mono>{fmtWhen(d.createdAt)} · {visible.length} observation{visible.length === 1 ? '' : 's'}{repeats ? ` · ${repeats} repeat${repeats === 1 ? '' : 's'} grouped` : ''}{d.status !== 'open' ? ` · ${d.status}` : ''}</Mono></span>
      {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
    </button>
    {open && <div className="mt-2 space-y-2 text-xs">
      <p className="text-muted-foreground">{d.explanation}</p>
      <ul className="space-y-1.5">{visible.map(o => <li key={o.id} className="border-l-2 border-foreground/70 pl-2">
        <p className="whitespace-pre-wrap font-serif">{o.excerpt}</p>
        <Mono>{o.capture?.publisher ?? o.capture?.source ?? 'capture'} · {o.attribution} · {o.certainty}{o.lineage ? ` · ${o.lineage.relation}` : ''}</Mono>
      </li>)}</ul>
      <Mono>Event {d.eventKey} · claim {d.claimKey} · p{d.policyVersion}</Mono>
      {mode ? <div className="space-y-1.5">
        <div className="flex gap-2"><select value={disp} onChange={e => setDisp(e.target.value as typeof disp)} className={cn(inputCls, 'w-auto text-xs')} aria-label="Triage" data-testid={`select-dev-disposition-${d.id}`}>{DISPOSITIONS.map(x => <option key={x}>{x}</option>)}</select>
          <input value={rationale} onChange={e => setRationale(e.target.value)} placeholder={`Rationale to ${mode === 'open' ? 'reopen' : mode.replace(/ed$/, '')}`} maxLength={2000} className={inputCls} data-testid={`input-dev-rationale-${d.id}`} /></div>
        <ErrorLine error={err} />
        <div className="flex gap-1.5"><button className={primaryCls} disabled={decide.isPending} onClick={submit} data-testid={`button-dev-submit-${d.id}`}>Confirm</button><button className={btnCls} onClick={() => { setMode(null); setErr(''); }}>Cancel</button></div>
      </div> : <div className="flex gap-1.5">
        {d.status === 'open' ? <>
          <button className={btnCls} onClick={() => setMode('acknowledged')} data-testid={`button-dev-ack-${d.id}`}>Acknowledge</button>
          <button className={btnCls} onClick={() => setMode('dismissed')} data-testid={`button-dev-dismiss-${d.id}`}>Dismiss</button>
        </> : <button className={btnCls} onClick={() => setMode('open')} data-testid={`button-dev-reopen-${d.id}`}>Reopen</button>}
      </div>}
    </div>}
  </li>;
}

const DEV_PAGE = 30;

export function DevelopmentsPanel({ articleId, compact }: { articleId?: string; compact?: boolean }) {
  const [disp, setDisp] = useState<ListDevelopmentsParams['disposition'] | ''>('');
  const [collapsed, setCollapsed] = useState(false); const [offset, setOffset] = useState(0);
  const params: ListDevelopmentsParams = { ...(articleId && { articleId }), ...(disp && { disposition: disp }), offset };
  const q = useListDevelopments(params, { query: { queryKey: getListDevelopmentsQueryKey(params), refetchInterval: POLL_MS, placeholderData: p => p } });
  const items = q.data?.items ?? []; const total = q.data?.total ?? 0;
  // These filter entity developments, not feed articles. Do not expose an
  // inactive empty control strip, but keep a selected empty category escapable.
  if (!disp && offset === 0 && !q.isError && (q.isLoading || !total)) return null;
  return <section className={compact ? 'mt-6' : 'px-3 pt-3 md:px-5'} data-testid={articleId ? 'panel-article-developments' : 'panel-developments'}>
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <button onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} className="mr-2 inline-flex items-center gap-1 font-display text-lg font-semibold uppercase tracking-wide" data-testid="button-toggle-developments">
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />} Developments <span className="font-mono text-xs text-muted-foreground">{q.data?.total ?? ''}</span>
      </button>
      {!compact && ['', ...DISPOSITIONS].map(x => <button key={x || 'all'} onClick={() => { setDisp(x as typeof disp); setOffset(0); }} className={cn('h-6 rounded-md px-2 font-mono text-[10px] uppercase tracking-wider', disp === x ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')} data-testid={`filter-dev-${x || 'all'}`}>{x || 'All'}</button>)}
    </div>
    {!collapsed && (q.isLoading ? <div className="h-14 animate-pulse rounded-xl bg-muted" /> : q.isError ? <p className="text-xs text-muted-foreground">Developments unavailable. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
      : !items.length ? <p className="pb-2 text-xs text-muted-foreground">No developments{disp ? ` in ${disp}` : ''}.</p>
      : <ul className={cn('space-y-2', !compact && 'max-h-[42dvh] overflow-y-auto pb-1')}>{items.map(d => <DevelopmentItem key={d.id} d={d} />)}</ul>)}
    {!collapsed && total > DEV_PAGE && <div className="flex items-center justify-end gap-2 pb-1">
      <Mono>{offset + 1}-{Math.min(offset + DEV_PAGE, total)} of {total}</Mono>
      <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - DEV_PAGE))} className="p-1 disabled:opacity-30" aria-label="Previous developments" data-testid="button-dev-prev"><ChevronLeft className="h-4 w-4" /></button>
      <button disabled={offset + DEV_PAGE >= total} onClick={() => setOffset(o => o + DEV_PAGE)} className="p-1 disabled:opacity-30" aria-label="Next developments" data-testid="button-dev-next"><ChevronRight className="h-4 w-4" /></button>
    </div>}
  </section>;
}
