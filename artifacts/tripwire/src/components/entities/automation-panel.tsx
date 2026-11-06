import { useEffect, useState } from 'react';
import { useControlEntityAutomation, useGetEntityAutomation, getGetEntityAutomationQueryKey, type AutomationAction } from '@workspace/api-client-react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { POLL_MS, errorText, fmtWhen, micros, useInvalidateEntities } from '@/lib/entities';
import { ErrorLine, Mono, btnCls, inputCls, primaryCls } from './ui';

const JOB_PAGE = 30;
const ATTENTION = new Set(['deferred', 'unconfigured', 'dead']);

export function AutomationPanel() {
  const [offset, setOffset] = useState(0);
  const params = { offset };
  const q = useGetEntityAutomation(params, { query: { queryKey: getGetEntityAutomationQueryKey(params), refetchInterval: POLL_MS, placeholderData: p => p } });
  const control = useControlEntityAutomation();
  const invalidate = useInvalidateEntities();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [tokens, setTokens] = useState('');
  const [cost, setCost] = useState('');
  const [policy, setPolicy] = useState<Record<string, string>>({});
  const h = q.data;
  useEffect(() => {
    if (!h) return;
    setTokens(String(h.dailyTokens)); setCost((h.dailyMicros / 1_000_000).toFixed(2));
    setPolicy(Object.fromEntries(Object.entries(h.policy).map(([k, v]) => [k, String(v)])));
  }, [h?.policyVersion, h?.dailyTokens, h?.dailyMicros]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (data: AutomationAction) => { setErr(''); control.mutate({ data }, { onSuccess: () => invalidate(), onError: e => { setErr(errorText(e)); invalidate(); } }); };

  if (q.isLoading) return <div className="h-12 animate-pulse rounded-md bg-muted" />;
  if (q.isError || !h) return <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"><span className="text-muted-foreground">Automation status unavailable.</span><button onClick={() => q.refetch()} className="underline">Retry</button></div>;

  const jobs = h.jobs.filter(j => ATTENTION.has(j.status));
  const jobTotal = Object.values(h.counts).reduce((a, b) => a + b, 0);
  const pct = h.dailyTokens ? Math.min(100, (h.usedTokens / h.dailyTokens) * 100) : 0;
  return <div className="rounded-md border border-border bg-card/90" data-testid="panel-automation">
    <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left" data-testid="button-toggle-automation">
      <span className="font-display text-base font-semibold uppercase tracking-wide">Automation</span>
      <span className={cn('font-mono text-[11px] uppercase', h.mode === 'paused' ? 'text-muted-foreground' : h.mode === 'autonomous' ? 'text-red-700' : 'text-foreground')} data-testid="text-automation-mode">{h.mode}</span>
      <Mono>Provider {h.provider === 'configured' ? 'configured' : <span className="text-red-700">missing</span>}</Mono>
      <Mono>Last success {fmtWhen(h.lastSuccess)}</Mono>
      <Mono>Partial {h.captureCounts.incomplete ?? h.captureCounts.partial ?? 0} · Excluded {h.captureCounts.excluded ?? 0}</Mono>
      {jobs.length > 0 && <Mono className="text-red-700">{jobs.length} jobs need attention</Mono>}
      <span className="ml-auto">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
    </button>
    {open && <div className="space-y-4 border-t border-border px-3 py-3 text-xs">
      <ErrorLine error={err} />
      {h.activationBlockers.length > 0 && <div><Mono>Activation blocked by</Mono><ul className="mt-1 list-inside list-disc text-muted-foreground">{h.activationBlockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2">
        {h.mode === 'paused' ? <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'observe' })} data-testid="button-automation-observe">Resume observe</button>
          : <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'pause' })} data-testid="button-automation-pause">Pause</button>}
        {h.mode !== 'autonomous' && <button className={primaryCls} disabled={control.isPending} onClick={() => run({ action: 'activate' })} data-testid="button-automation-activate">Activate</button>}
        <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'backfill' })} data-testid="button-automation-backfill">Backfill</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Mono>Authorization</Mono>
          <p>{h.authorized ? 'Processing authorized' : 'Not authorized'}{h.privateMaterial ? ' · private material included' : ''}</p>
          <div className="flex flex-wrap gap-2">
            {h.authorized ? <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'revoke' })} data-testid="button-automation-revoke">Revoke</button>
              : <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'authorize', privateMaterial: false })} data-testid="button-automation-authorize">Authorize public</button>}
            <button className={btnCls} disabled={control.isPending} onClick={() => run({ action: 'authorize', privateMaterial: !h.privateMaterial })} data-testid="button-automation-private">{h.privateMaterial ? 'Exclude private material' : 'Opt in private material'}</button>
          </div>
          <p className="text-muted-foreground">These flags record processing consent only; they do not authenticate anyone.</p>
        </div>
        <div className="space-y-1">
          <Mono>Daily budget · used {h.usedTokens.toLocaleString()} tokens · {micros(h.usedMicros)}</Mono>
          <div className="h-1.5 rounded bg-muted"><div className="h-full rounded bg-foreground" style={{ width: `${pct}%` }} /></div>
          <div className="flex gap-2">
            <label className="flex-1"><Mono>Token cap</Mono><input type="number" min={0} max={1000000} value={tokens} onChange={e => setTokens(e.target.value)} className={inputCls} data-testid="input-budget-tokens" /></label>
            <label className="flex-1"><Mono>Cost cap USD</Mono><input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} className={inputCls} data-testid="input-budget-cost" /></label>
          </div>
        </div>
      </div>
      <div>
        <Mono>Policy v{h.policyVersion} · {h.scheduling}</Mono>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.keys(policy).map(k => <label key={k}><Mono>{k}</Mono><input type="number" value={policy[k]} onChange={e => setPolicy(p => ({ ...p, [k]: e.target.value }))} className={inputCls} data-testid={`input-policy-${k}`} /></label>)}
        </div>
        <button className={cn(primaryCls, 'mt-2')} disabled={control.isPending} data-testid="button-automation-configure"
          onClick={() => run({ action: 'configure', dailyTokens: Number(tokens), dailyMicros: Math.round(Number(cost) * 1_000_000), policy: Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, Number(v)])) })}>Save budget and policy</button>
      </div>
      <div>
        <Mono>Jobs {Object.entries(h.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</Mono>
        {h.jobs.length > 0 && <ul className="mt-1 divide-y divide-border rounded-md border border-border">
          {h.jobs.map(j => <li key={j.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid={`row-job-${j.id}`}>
            <span className={cn('font-mono uppercase', ATTENTION.has(j.status) && 'text-red-700')}>{j.status}</span><span className="text-muted-foreground">{j.attempts} att. · next {fmtWhen(j.nextRun)} · {j.tokens} tok · {micros(j.costMicros)}</span>
            {j.error && <span className="w-full truncate text-red-800" title={j.error}>{j.error}</span>}
            {ATTENTION.has(j.status) && <button className={cn(btnCls, 'ml-auto h-6')} disabled={control.isPending} onClick={() => run({ action: 'retry', jobId: j.id })} data-testid={`button-retry-job-${j.id}`}><RotateCw className="h-3 w-3" /> Retry</button>}
          </li>)}
        </ul>}
        {jobTotal > JOB_PAGE && <div className="mt-1 flex items-center justify-end gap-2">
          <Mono>{offset + 1}-{Math.min(offset + JOB_PAGE, jobTotal)} of {jobTotal}</Mono>
          <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - JOB_PAGE))} className="p-1 disabled:opacity-30" aria-label="Previous jobs" data-testid="button-jobs-prev"><ChevronLeft className="h-4 w-4" /></button>
          <button disabled={offset + JOB_PAGE >= jobTotal} onClick={() => setOffset(o => o + JOB_PAGE)} className="p-1 disabled:opacity-30" aria-label="Next jobs" data-testid="button-jobs-next"><ChevronRight className="h-4 w-4" /></button>
        </div>}
      </div>
    </div>}
  </div>;
}
