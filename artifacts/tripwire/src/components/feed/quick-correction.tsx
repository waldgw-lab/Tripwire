import { useEffect, useRef, useState } from 'react';
import { ArticleCorrectionInputReason, type TrackedRecord } from '@workspace/api-client-react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errText, isConflict, newRequestId, useCorrect } from '@/lib/workspace';

const REASONS = Object.values(ArticleCorrectionInputReason);
const ctl = 'h-7 rounded-md border border-input bg-background px-2 text-xs';
type Field = 'impact' | 'topic';

const modeOf = (a: TrackedRecord, f: Field) => (f === 'impact' ? a.impactMode : a.topicMode) === 'manual' ? 'manual' : 'auto';
const current = (a: TrackedRecord, f: Field) => `${(f === 'impact' ? a.impact?.toUpperCase() : a.topic) || '—'} · ${modeOf(a, f)}`;

export function QuickCorrection({ article: a }: { article: TrackedRecord }) {
  const correct = useCorrect();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<Field>('impact');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(a.classificationRevision ?? 0);
  const [stale, setStale] = useState<string | null>(null);
  const requestId = useRef(newRequestId());

  const init = (f: Field) => {
    setField(f); const m = modeOf(a, f); setMode(m);
    setValue(m === 'manual' ? (f === 'impact' ? a.impact ?? '' : a.topic ?? '') : '');
  };
  const reset = () => {
    init('impact'); setReason(''); setNotes(''); setError(null); setStale(null);
    setBase(a.classificationRevision ?? 0); requestId.current = newRequestId();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(false); reset(); }, [a.id]);

  const revision = a.classificationRevision ?? 0;
  const needsNote = reason === 'Other' && !notes.trim();
  const canSubmit = !!reason && !needsNote && (mode === 'auto' || !!value.trim()) && !stale && !correct.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    correct.mutate({ id: a.id, data: {
      field, mode, value: mode === 'manual' ? value.trim() : undefined,
      reason: reason as ArticleCorrectionInputReason, notes: notes.trim() || undefined,
      requestId: requestId.current, expectedRevision: base,
    } }, {
      onSuccess: () => { setOpen(false); reset(); },
      onError: (e) => {
        if (isConflict(e)) setStale(`Classification changed since this form opened (revision ${base}). Review the current value, then decide again.`);
        else setError(errText(e));
      },
    });
  };
  const decideAgain = () => { setStale(null); setBase(revision); requestId.current = newRequestId(); };

  return (
    <div className="mt-1" data-testid="quick-correction">
      <button type="button" onClick={() => { if (!open) reset(); setOpen(v => !v); }} aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-toggle-correction">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Correct impact / topic
      </button>
      {open && (
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="mt-2 space-y-2 rounded-md border border-border bg-card/70 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Field" value={field} onChange={e => init(e.target.value as Field)} className={ctl} data-testid="select-correction-field">
              <option value="impact">Impact</option><option value="topic">Topic</option>
            </select>
            <div className="inline-flex overflow-hidden rounded-md border border-input text-xs" role="group" aria-label="Mode">
              {(['auto', 'manual'] as const).map(m => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                  className={cn('h-7 px-2.5', mode === m ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground')} data-testid={`button-correction-mode-${m}`}>
                  {m === 'auto' ? 'Auto' : 'Manual'}
                </button>
              ))}
            </div>
            {mode === 'manual' && (field === 'impact'
              ? <select aria-label="Impact value" value={value} onChange={e => setValue(e.target.value)} className={ctl} data-testid="select-correction-value">
                  <option value="" disabled>Value</option>
                  {['critical', 'high', 'low'].map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                </select>
              : <><input aria-label="Topic value" list={`correction-topics-${a.id}`} value={value} maxLength={120} onChange={e => setValue(e.target.value)} placeholder="Topic" className={cn(ctl, 'w-40')} data-testid="input-correction-value" />
                  <datalist id={`correction-topics-${a.id}`}>
                    {['Politics', 'Defense', 'Military Operations', 'Foreign Policy', 'Intelligence', 'Geopolitics', 'Unclassified'].map(topic => <option key={topic} value={topic} />)}
                  </datalist></>)}
            <select aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} className={cn(ctl, !reason && 'text-muted-foreground')} data-testid="select-correction-reason">
              <option value="" disabled>Reason (required)</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <input aria-label="Notes" value={notes} maxLength={4000} onChange={e => setNotes(e.target.value)} placeholder={reason === 'Other' ? 'Note (required for Other)' : 'Note (optional)'}
            className={cn(ctl, 'w-full', reason === 'Other' && !notes.trim() && 'border-foreground')} data-testid="input-correction-notes" />
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Current {current(a, field)} · rev {revision}</div>
          {stale && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/50 px-2 py-1.5 text-xs" role="alert" data-testid="text-correction-conflict">
              <span>{stale} Now: {current(a, field)} · rev {revision}.</span>
              <button type="button" onClick={decideAgain} className="underline underline-offset-4" data-testid="button-correction-decide-again">Decide again</button>
            </div>
          )}
          {error && <p className="text-xs text-destructive" role="alert" data-testid="text-correction-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); reset(); }} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" data-testid="button-correction-cancel">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="h-7 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50" data-testid="button-correction-submit">
              {correct.isPending ? 'Saving' : error ? 'Retry' : 'Apply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
