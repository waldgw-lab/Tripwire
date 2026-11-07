import { useState } from 'react';
import { useCorrectClaimDirection, type ClaimDirectionInputDirection, type ReportingClaim } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { errText, useInvalidateClaims } from '@/lib/workspace';
import { ErrorLine, btnCls, inputCls, primaryCls } from '@/components/entities/ui';
import { Disclosure } from './provenance-panel';

const DIRECTIONS = ['positive', 'negative', 'neutral', 'mixed', 'unassessed'] as const;
const DIR_TONE: Record<string, string> = {
  positive: 'bg-[hsl(150_18%_92%)] text-[hsl(150_22%_28%)]',
  negative: 'bg-[hsl(20_28%_92%)] text-[hsl(18_30%_34%)]',
  neutral: 'bg-[hsl(212_20%_93%)] text-[hsl(212_24%_32%)]',
  mixed: 'bg-[hsl(42_26%_91%)] text-[hsl(38_30%_30%)]',
  unassessed: 'border border-dashed border-input text-muted-foreground',
};
const ORIGIN_LABEL: Record<string, string> = { automatic: 'Local rules (automatic)', analyst: 'Analyst correction', unassessed: 'Not assessed' };

/** Direction of this claim toward a subject. Quiet for unassessed records with no subject. */
export function ClaimDirection({ o, editable }: { o: ReportingClaim; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const dir = o.direction ?? 'unassessed';
  const subject = o.directionSubject?.trim();
  const quiet = dir === 'unassessed' && !subject;
  if (quiet && !editable) return null;
  return (
    <div className="mt-1" data-testid={`direction-${o.id}`}>
      {!quiet && <span className={cn('inline-flex min-h-5 max-w-full flex-wrap items-center gap-1 rounded-sm px-1.5 text-[10px]', DIR_TONE[dir])} data-testid={`badge-direction-${o.id}`}>
        <span className="font-mono uppercase tracking-wider">{dir === 'unassessed' ? 'Direction unclear' : dir}</span>{subject && <span className="min-w-0 break-words">toward {subject}</span>}
      </span>}
      {(!quiet || editable) && <Disclosure label={quiet ? 'Direction' : 'Direction details'} testId={`details-direction-${o.id}`}>
        {!quiet && <div className="space-y-0.5">
          <p className="text-muted-foreground">{ORIGIN_LABEL[o.directionOrigin ?? 'unassessed']}</p>
          {o.directionReason && <p>{o.directionReason}</p>}
          {o.directionCorrectionId && <p className="font-mono text-[10px] text-muted-foreground">correction {o.directionCorrectionId}</p>}
        </div>}
        {editable && !open && <button className="mt-1 text-[11px] underline" onClick={() => setOpen(true)} data-testid={`button-correct-direction-${o.id}`}>{quiet ? 'Record direction' : 'Correct direction'}</button>}
        {editable && open && <DirectionForm o={o} onDone={() => setOpen(false)} />}
      </Disclosure>}
    </div>
  );
}

function DirectionForm({ o, onDone }: { o: ReportingClaim; onDone: () => void }) {
  const [subject, setSubject] = useState(o.directionSubject ?? '');
  const [direction, setDirection] = useState<ClaimDirectionInputDirection>(o.direction ?? 'unassessed');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string>();
  const m = useCorrectClaimDirection();
  const invalidate = useInvalidateClaims();
  const submit = async () => {
    setError(undefined);
    if (!subject.trim()) return setError('Name the subject the direction is about.');
    if (rationale.trim().length < 5) return setError('Rationale must be at least 5 characters.');
    try {
      await m.mutateAsync({ data: { claimObservationId: o.id, subject: subject.trim(), direction, rationale: rationale.trim(), supersedesId: o.directionCorrectionId ?? null } });
      await invalidate();
      onDone();
    } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="mt-2 space-y-2" data-testid={`form-direction-${o.id}`}>
      <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject, e.g. the ministry" maxLength={200} className={cn(inputCls, 'text-xs')} data-testid="input-direction-subject" />
      <div className="flex flex-wrap gap-1">
        {DIRECTIONS.map(d => <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)}
          className={cn('h-7 rounded-md border px-2 text-[11px]', direction === d ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground')} data-testid={`button-direction-${d}`}>{d}</button>)}
      </div>
      <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2} placeholder="Why, citing the passage." className="w-full rounded-md border border-input bg-background p-2 text-sm" data-testid="input-direction-rationale" />
      <ErrorLine error={error} />
      <div className="flex justify-end gap-1.5">
        <button className={btnCls} onClick={onDone} data-testid="button-cancel-direction">Cancel</button>
        <button className={primaryCls} onClick={submit} disabled={m.isPending} data-testid="button-save-direction">{m.isPending ? 'Saving…' : 'Save correction'}</button>
      </div>
    </div>
  );
}
